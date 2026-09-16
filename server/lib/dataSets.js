// One registry describing every exportable dataset, instead of a bespoke
// endpoint per screen.
//
// An export and an import template are NOT the same list, and treating them as
// one was a real defect. An export carries what the system knows: codes it
// assigned, balances it derived, statuses it computed. An import template has
// to carry what a person must supply - which leaves some of those out and adds
// fields the export never shows.
//
// The bills case made it obvious. The export reads
//   Bill No | Supplier | Description | Amount | Paid | Outstanding | Status | Due Date
// but the importer needs an ACCOUNT to charge the bill to, and cannot use Bill
// No, Paid, Outstanding or Status at all. Handed that sheet, an operator fills
// in four columns nothing reads, never sees the one column that is required,
// and every row is rejected.
//
// So an importable dataset also declares `importSpec`: the columns its
// importer actually reads, which are required, what each one means, and an
// example row. That is what `?template=1` returns.
//
// Each entry is pure description: which columns, and how to turn one document
// into a row. Fetching lives in the route (it needs models and request scope);
// everything here is testable without a database.

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 1e4) / 1e4;
const round6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
// "1kg", "377g", "2L", "750ml", "100pcs" - the size as it is written on the
// pack and in the product sheet. packSize is held in display units, so a
// fraction of a kg or L reads back in g or ml the way it is sold.
// One recipe line resolved against live stock. Same rules a sale uses: a
// non-stock line (filtered water) is never stock and never costed; otherwise
// match by stock link, then by name. A line whose stock item no longer exists
// falls back to the cost it carried when added, and says so - a silent zero
// would make the drink look cheaper than it is.
const resolveLine = (line, inv) => {
  if (line?.nonStock) {
    return { link: 'Not from inventory', item: null, perBase: 0, packBase: Number(line.packBase) > 0 ? Number(line.packBase) : null };
  }
  const item = inv
    ? ((line?.invId && inv.byId.get(String(line.invId))) || (line?.name && inv.byName.get(String(line.name).toUpperCase())) || null)
    : null;
  const mult = item && Number(item.unitMultiplier) > 0 ? Number(item.unitMultiplier) : 1;
  const packBase = Number(line?.packBase) > 0
    ? Number(line.packBase)
    : (item && Number(item.packSize) > 0 ? Number(item.packSize) * mult : null);
  return {
    link: item ? 'Linked' : 'Missing - cost from when it was added',
    item,
    perBase: item ? (Number(item.unitCost) || 0) : (Number(line?.cost) || 0),
    packBase,
  };
};
// Same exclusion as Menu Setup's calcRecipeCost: non-stock lines cost nothing.
const recipeCost = (recipe, inv) => (recipe || [])
  .filter(l => !l?.nonStock)
  .reduce((sum, l) => sum + (Number(l.qty) || 0) * resolveLine(l, inv).perBase, 0);

const packLabel = (pack, disp) => {
  if (!(pack > 0)) return '';
  const u = String(disp || '');
  const trim = (x) => String(Math.round(x * 1000) / 1000);
  if (u === 'kg' && pack < 1) return `${trim(pack * 1000)}g`;
  if (u === 'L' && pack < 1) return `${trim(pack * 1000)}ml`;
  return `${trim(pack)}${u}`;
};
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const yes = (b) => (b ? 'Yes' : 'No');

// `key` is what the client asks for; `label` names the file and the button.
// `importable` marks the datasets an import actually exists for - the rest are
// export-only on purpose. Importing posted ledger rows would let someone
// rewrite history through a spreadsheet, so those are deliberately one-way.
// ── Inventory export, in the import sheet's own shape ──────────────────────
export const INVENTORY_IMPORT_COLUMNS = ['Code', 'Product', 'Qty Unit', 'SRP', 'Unit Cost', 'Expiry date', 'Production date'];
const CATEGORY_INFO_COLUMNS = ['Category', 'Category Source'];
const INVENTORY_INFO_COLUMNS = [
  'Category', 'Category Source', 'Pack', 'Display Unit', 'Qty (display unit)', 'Cost per Display Unit',
  'Total Value', 'Low Stock At', 'Location', 'Base Unit', 'Qty (base)', 'Cost per Base Unit',
];
// The same trailing-size pattern the importer uses (PACK_SIZE_RE in
// AdminDashboard's inventory parser). A name that already ends in a size is
// left alone rather than given a second one.
const IMPORT_PACK_RE = /\s+([0-9]+(?:\.[0-9]+)?)\s*(kg|g|L|l|ml|pcs|pc|piece)\b(\s*\([^)]*\))?\s*$/i;
const round9 = (n) => Math.round((Number(n) || 0) * 1e9) / 1e9;
const isoDay = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
};
// Pack size written from BASE units, not the stored display unit, so it
// parses back identically however the item was set up: 1000 g -> "1kg",
// 377 g -> "377g", 2500 ml -> "2.5L", 100 pcs -> "100pcs". The importer turns
// "377g" into 0.377 kg, and kg is always 1000 g, so the pack round-trips.
const basePackLabel = (packBase, base) => {
  const t = (x) => String(Math.round(x * 1000) / 1000);
  if (base === 'g') return packBase >= 1000 ? `${t(packBase / 1000)}kg` : `${t(packBase)}g`;
  if (base === 'ml') return packBase >= 1000 ? `${t(packBase / 1000)}L` : `${t(packBase)}ml`;
  return `${t(packBase)}pcs`;
};
// One sheet row per stock lot, or one row for the item when its lots do not
// account for all of it. Repeating a code in one import is how the importer
// adds a second expiry lot, so writing each lot separately keeps every expiry
// date instead of collapsing them to the soonest.
const inventorySheetRows = (i, category, categorySource) => {
  const base = i.unit || 'pcs';
  // Without a pack size, quantity and cost go out in the importer's canonical
  // display unit - kg, L or pcs - with the unit written into Qty Unit.
  const canonFactor = base === 'g' || base === 'ml' ? 1000 : 1;
  const canonUnit = base === 'g' ? 'kg' : base === 'ml' ? 'L' : 'pcs';
  const mult = Number(i.unitMultiplier) > 0 ? Number(i.unitMultiplier) : 1;
  const pack = Number(i.packSize) > 0 ? Number(i.packSize) : null;
  const packBase = pack ? pack * mult : null;
  const perBase = Number(i.unitCost) || 0;
  const qtyBase = Number(i.stockQty) || 0;
  const name = String(i.itemName || '');
  const label = packBase ? basePackLabel(packBase, base) : '';
  const product = label && !IMPORT_PACK_RE.test(name) ? `${name} ${label}` : name;

  const batches = (i.expiryBatches || []).filter(b => Number(b.qty) > 0);
  const batchTotal = batches.reduce((sum, b) => sum + Number(b.qty), 0);
  // stockQty is the source of truth; batches are the audit trail of it. Only
  // split into lots when they add up, or a re-import would change the count.
  const lots = batches.length > 1 && Math.abs(batchTotal - qtyBase) < 1e-6
    ? batches.map(b => ({
        qty: Number(b.qty),
        expiry: b.expiryDate,
        production: b.productionDate,
        cost: Number(b.unitCost) > 0 ? Number(b.unitCost) : perBase,
      }))
    : [{
        qty: qtyBase,
        expiry: i.expiryDate || batches[0]?.expiryDate,
        production: batches[0]?.productionDate,
        cost: perBase,
      }];

  return lots.map(lot => {
    const expiry = isoDay(lot.expiry);
    return [
      i.itemCode || '',
      product,
      // With a pack in the name, Qty Unit is a plain count of packs and Unit
      // Cost is per pack - the importer multiplies and divides by the pack
      // size itself. Without one, the unit is written in and cost is per unit.
      packBase ? round9(lot.qty / packBase) : `${round9(lot.qty / canonFactor)} ${canonUnit}`,
      Number(i.srp) > 0 ? money(i.srp) : '',
      // Six decimals, not two: a cost blended across deliveries (P65.8734 a
      // can) must re-import to the same stored cost, not a rounded one.
      packBase ? round6(lot.cost * packBase) : round6(lot.cost * canonFactor),
      expiry,
      // The importer only uses a production date when there is no expiry.
      expiry ? '' : isoDay(lot.production),
      // ── reference only; not read on import ──
      category, categorySource, label, i.displayUnit || canonUnit,
      round4(lot.qty / mult), money(perBase * mult),
      money(lot.qty * lot.cost), money(i.lowStockThreshold), i.stockLocation || '',
      base, round4(lot.qty), round6(perBase),
    ];
  });
};

export const DATASETS = {
  // ── Master data ──────────────────────────────────────────────────────────
  inventory: {
    label: 'Inventory', model: 'Inventory', importable: true, withStockCategories: true,
    sort: { itemName: 1 },
    importSpec: {
      endpoint: '/api/inventory/import',
      intro: 'One row per stock item. Cost matters as much as quantity: an item at zero cost posts zero cost of sale, and every drink built on it reads as 100% margin.',
      columns: [
        { name: 'itemName', required: true, note: 'Stored in capitals, however you type it.', example: 'Full Milk' },
        { name: 'itemCode', note: 'Yours, if you use one. Left blank, the system assigns one.', example: 'RM-MILK' },
        { name: 'unit', required: true, note: 'kg, L or pcs. Grams and millilitres are promoted to kg / L.', example: 'L' },
        { name: 'qty', required: true, note: 'How much you hold now, in the unit above.', example: '20' },
        { name: 'unitCost', required: true, note: 'Cost of ONE unit. Zero here means zero cost of sale later.', example: '82' },
        { name: 'lowStockThreshold', note: 'Warn below this. Blank for no warning.', example: '5' },
        { name: 'expiryDate', note: 'YYYY-MM-DD.', example: '2026-12-31' },
        { name: 'stockLocation', note: 'Where it is kept.', example: 'Main bar' },
      ],
    },
    // Written in the SAME shape the Inventory tab's Import reads, so an export
    // can be imported straight back - into this system or a new one - and land
    // on the same stored figures. The first seven columns are exactly the
    // import sheet: Code, Product (with the pack size written into the name,
    // e.g. "BEANS PROFILE(2) 1kg"), Qty Unit, SRP, Unit Cost, Expiry date,
    // Production date. Everything after them is reference only; the importer
    // does not read those columns.
    //
    // Categories are carried the way the import sheet carries them: a header
    // row with the category name in Code and everything else blank, before
    // each group. The importer has no Category column - a header row is the
    // only thing it reads a category from.
    //
    // Stock is STORED in base units (g / ml / pcs) with cost per base unit.
    // This export used to print those storage values straight out: BEANS 1kg
    // bought at P386 came out as "g, 0.39" - a unit nobody buys in, rounded
    // until P386 read as P390, and a sheet no importer could take back.
    columns: [...INVENTORY_IMPORT_COLUMNS, ...INVENTORY_INFO_COLUMNS],
    // Category columns only where stock has categories - logistics. In fb the
    // categories belong to menu products, and a stock sheet with a Category
    // column that is always blank only suggests something is missing.
    columnsFor: (ctx) => (ctx?.useCategories
      ? [...INVENTORY_IMPORT_COLUMNS, ...INVENTORY_INFO_COLUMNS]
      : [...INVENTORY_IMPORT_COLUMNS, ...INVENTORY_INFO_COLUMNS.filter(c => !CATEGORY_INFO_COLUMNS.includes(c))]),
    buildRows: (docs, ctx) => {
      const useCats = !!ctx?.useCategories;
      const width = INVENTORY_IMPORT_COLUMNS.length + INVENTORY_INFO_COLUMNS.length - (useCats ? 0 : CATEGORY_INFO_COLUMNS.length);
      const groups = new Map();
      for (const i of docs) {
        // fb: no categories at all, so every item lands in one group and no
        // header row is written.
        const fromCode = useCats && !i.stockCategory && ctx?.categoryForCode ? ctx.categoryForCode(i.itemCode) : '';
        const category = useCats ? (i.stockCategory || fromCode || '') : '';
        const source = !useCats ? '' : (i.stockCategory ? 'Item' : (fromCode ? 'Code prefix' : ''));
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push({ i, category, source });
      }
      // Uncategorised items FIRST. The importer applies the last header it saw
      // to every row after it, so an uncategorised item placed after a header
      // would silently be filed under that header's category on re-import.
      const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
      const byCode = (x, y) => {
        const a = String(x.i.itemCode || ''), b = String(y.i.itemCode || '');
        if (!a && b) return 1;
        if (a && !b) return -1;
        return a.localeCompare(b) || String(x.i.itemName || '').localeCompare(String(y.i.itemName || ''));
      };
      const out = [];
      for (const k of keys) {
        if (k) {
          const header = new Array(width).fill('');
          header[0] = k;
          out.push(header);
        }
        for (const x of groups.get(k).sort(byCode)) {
          for (const row of inventorySheetRows(x.i, x.category, x.source)) {
            // Category and Category Source are the first two reference columns.
            if (!useCats) row.splice(INVENTORY_IMPORT_COLUMNS.length, CATEGORY_INFO_COLUMNS.length);
            out.push(row);
          }
        }
      }
      return out;
    },
  },

  // This used to report that a drink had "3" recipe lines and nothing else -
  // not what they were, how much, or what they cost. Recipe cost and margin
  // are now included, priced on ingredient costs as they are today (see
  // withInventory in data-export.js). New columns are appended, so anything
  // reading the existing ones by position is undisturbed. The line-by-line
  // view is the separate Recipes dataset below.
  products: {
    label: 'Products', model: 'Product', importable: true, withInventory: true,
    sort: { category: 1, name: 1 },
    columns: [
      'Product Code', 'Name', 'Category', 'Base Price', 'Base Size', 'Barcode', 'Available', 'Archived', 'Recipe Lines', 'Sizes',
      'Recipe Cost', 'Margin %', 'Cost Override', 'Size Prices',
    ],
    toRow: (p, inv) => {
      const cost = recipeCost(p.baseRecipe, inv);
      const price = Number(p.basePrice) || 0;
      return [
        p.productCode || '', p.name || '', p.category || '', money(p.basePrice),
        p.baseSize || '', p.barcode || '', yes(p.isAvailable !== false), yes(p.isArchived),
        (p.baseRecipe || []).length, (p.sizes || []).length,
        money(cost),
        price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : '',
        Number(p.costOverride) > 0 ? money(p.costOverride) : '',
        (p.sizes || []).map(sz => `${sz.name || ''} ${money(sz.price)}`.trim()).join('; '),
      ];
    },
  },

  // Every recipe line, one row each - written in Menu Setup's own import shape,
  // so the sheet can be imported straight back to move a menu or restore one.
  // The leading columns are exactly the menu import sheet (Category, Product,
  // SRP, Size, Ingredient, Qty, Unit) plus Stock Link, which marks a non-stock
  // ingredient (filtered water) so it comes back as one. Qty is in storage
  // units (g / ml / pcs), which the importer converts exactly. Everything after
  // Stock Link is reference only.
  //
  // Add-on recipes are listed for reference with Recipe "Add-on: ...". The menu
  // importer skips those rows: the sheet has no add-on column, and taking them
  // in would fold every add-on ingredient into the drink's base recipe.
  recipes: {
    label: 'Recipes', model: 'Product', withInventory: true,
    sort: { category: 1, name: 1 },
    columns: [
      'Category', 'Product', 'SRP', 'Size', 'Ingredient', 'Qty', 'Unit', 'Stock Link',
      'Product Code', 'Recipe', 'Qty (packs)', 'Pack', 'Cost per Base Unit', 'Line Cost',
    ],
    expand: (p, inv) => {
      if (p.isArchived) return [];            // not on sale; only noise here
      const out = [];
      const priceCell = (price) => (price === undefined || price === null || price === '' ? '' : money(price));
      // A drink, or a size, with no recipe lines still needs a row - without
      // it the importer would never see that name or its price.
      const bare = (recipeLabel, size, price) => [
        p.category || '', p.name || '', priceCell(price), size, '', '', '', '',
        p.productCode || '', recipeLabel, '', '', '', '',
      ];
      const lineRow = (recipeLabel, size, price, l) => {
        const r = resolveLine(l, inv);
        const qty = Number(l.qty) || 0;
        // Storage unit for stock (g / ml / pcs) - the unit the importer
        // converts from. A non-stock line keeps the unit it was written in.
        const unit = l.nonStock ? (l.unit || 'ml') : (r.item ? (r.item.unit || '') : '');
        return [
          p.category || '', p.name || '', priceCell(price), size,
          l.name || '', round6(qty), unit, r.link,
          p.productCode || '', recipeLabel,
          r.packBase ? round4(qty / r.packBase) : '',
          r.item ? packLabel(Number(r.item.packSize) || null, r.item.displayUnit || r.item.unit) : '',
          round6(r.perBase),
          money(l.nonStock ? 0 : qty * r.perBase),
        ];
      };
      const add = (recipeLabel, size, price, lines) => {
        if (!(lines || []).length) { out.push(bare(recipeLabel, size, price)); return; }
        for (const l of lines) out.push(lineRow(recipeLabel, size, price, l));
      };
      add('Base', '', p.basePrice, p.baseRecipe);
      for (const sz of p.sizes || []) add(`Size: ${sz.name || ''}`, sz.name || '', sz.price, sz.recipe);
      for (const a of p.addOns || []) {
        for (const l of a.recipe || []) out.push(lineRow(`Add-on: ${a.name || ''}`, '', '', l));
      }
      return out;
    },
  },

  clients: {
    label: 'Clients', model: 'ClientAccount', importable: true,
    sort: { name: 1 },
    importSpec: {
      endpoint: '/api/client-accounts/import',
      intro: 'One row per client. There is deliberately NO username or password column: each client gets a 7-day onboarding link and chooses their own. A spreadsheet does not get to decide who can sign in.',
      columns: [
        { name: 'name', required: true, note: 'Must be unique.', example: 'Kasa Lokal' },
        { name: 'phone', example: '0917 555 0101' },
        { name: 'email', note: 'Checked; a malformed address is rejected with the row.', example: 'ar@kasalokal.ph' },
        { name: 'paymentMethod', note: 'How they usually pay. Defaults to Cash.', example: 'Account' },
        { name: 'creditLimit', note: 'Pesos they may owe at once. Blank = no client limit; 0 = no credit at all.', example: '50000' },
        { name: 'creditTermsDays', note: 'Days to pay. Blank uses the shop default.', example: '30' },
        { name: 'segments', note: 'Comma-separated. Used for pricing tiers and filters.', example: 'wholesale, cafe' },
        { name: 'contactNotes', example: 'Invoice to accounts@, not to the branch' },
      ],
    },
    columns: ['Client Code', 'Name', 'Username', 'Payment Method', 'Credit Limit', 'Credit Terms (days)', 'Credit Balance', 'Segments', 'Active'],
    toRow: (c) => [
      c.clientCode || '', c.name || '', c.username || '', c.paymentMethod || '',
      c.creditLimit ?? '', c.creditTermsDays ?? '', money(c.creditBalance),
      (c.segments || []).join(', '), yes(c.isActive !== false),
    ],
  },

  suppliers: {
    label: 'Suppliers', model: 'Supplier', importable: true,
    sort: { name: 1 },
    importSpec: {
      endpoint: '/api/suppliers/import',
      intro: 'One row per supplier. A name that already exists is left alone rather than overwritten, so a corrected sheet can be re-imported safely.',
      columns: [
        { name: 'name', required: true, note: 'Must be unique. Case and spacing are normalised before the duplicate check.', example: 'Metro Beans' },
        { name: 'contactPerson', note: 'Who you deal with.', example: 'Joy Cruz' },
        { name: 'phone', example: '0917 555 0100' },
        { name: 'email', example: 'joy@metrobeans.ph' },
        { name: 'address', example: '12 Bonifacio St, Quezon City' },
        { name: 'paymentTerms', note: 'What their invoices say, in their words.', example: '30 days' },
        { name: 'notes', note: 'Anything worth remembering.', example: 'Delivers Tuesdays only' },
      ],
    },
    columns: ['Name', 'Contact', 'Phone', 'Email', 'Address', 'Terms', 'Credit Balance', 'Active'],
    toRow: (s) => [
      s.name || '', s.contactPerson || '', s.phone || '', s.email || '',
      s.address || '', s.paymentTerms || '', money(s.creditBalance), yes(s.isActive !== false),
    ],
  },

  // ── Payables / receivables ───────────────────────────────────────────────
  bills: {
    label: 'Bills', model: 'Bill', importable: true,
    sort: { createdAt: -1 },
    importSpec: {
      endpoint: '/api/bills/import',
      intro: 'One row per unpaid supplier invoice you already hold. Every row arrives as PENDING and posts nothing - approve each bill afterwards to book the payable. Import the supplier list first; bills are matched to suppliers by name.',
      columns: [
        { name: 'supplier', required: true, note: 'Must already exist, spelled as it is in Suppliers.', example: 'Metro Beans' },
        { name: 'description', required: true, note: 'What the invoice is for.', example: 'March coffee beans' },
        { name: 'amount', required: true, note: 'The invoice total, in pesos.', example: '12000' },
        { name: 'expenseAccountCode', required: true, note: 'Which account this is charged to when approved. Without it the bill can never be approved - see the Accounts sheet.', example: '510000' },
        { name: 'dueDate', note: 'YYYY-MM-DD. When the supplier expects payment.', example: '2026-04-15' },
      ],
    },
    columns: ['Bill No', 'Supplier', 'Description', 'Amount', 'Paid', 'Outstanding', 'Status', 'Due Date', 'Source'],
    toRow: (b) => [
      b.billNumber || '', b.supplierName || '', b.description || '',
      money(b.amount), money(b.paidAmount), money((b.amount || 0) - (b.paidAmount || 0)),
      b.status || '', day(b.dueDate), b.source || '',
    ],
  },

  purchaseOrders: {
    label: 'Purchase Orders', model: 'PurchaseOrder',
    sort: { createdAt: -1 },
    columns: ['PO No', 'Supplier', 'Status', 'Total', 'Lines', 'Ordered', 'Expected'],
    toRow: (p) => [
      p.poNumber || '', p.supplierName || '', p.status || '',
      money(p.totalAmount), (p.lines || []).length, day(p.createdAt), day(p.expectedDate),
    ],
  },

  advances: {
    label: 'Advances', model: 'Advance',
    sort: { date: -1 },
    columns: ['Advance No', 'Branch', 'Type', 'Payee', 'Amount', 'Liquidated', 'Outstanding', 'Status', 'Purpose', 'Date'],
    toRow: (a) => [
      a.advanceNumber || '', a.branchCode || '', a.type || '', a.payeeName || '',
      money(a.amount), money(a.liquidatedAmount), money((a.amount || 0) - (a.liquidatedAmount || 0)),
      a.status || '', a.purpose || '', day(a.date),
    ],
  },

  // Stock held for a client is a real commitment against the stock figure -
  // an export of inventory without it overstates what is actually sellable.
  reservations: {
    label: 'Reserved Stock', model: 'Reservation',
    sort: { createdAt: -1 },
    columns: ['Reservation No', 'Branch', 'Held For', 'Order', 'Items', 'Held Qty', 'Status', 'Held Until', 'Note', 'Created'],
    toRow: (r) => [
      r.reservationNumber || '', r.branchCode || '', r.clientName || '', r.orderNumber || '',
      (r.items || []).map(i => i.itemName).join('; '),
      (r.items || []).reduce((s, i) => s + ((i.qty || 0) - (i.releasedQty || 0)), 0),
      r.status || '', day(r.expiresAt), r.note || '', day(r.createdAt),
    ],
  },

  checkVouchers: {
    label: 'Check Vouchers', model: 'CheckVoucher',
    sort: { date: -1 },
    columns: ['Voucher No', 'Branch', 'Date', 'Payee Type', 'Payee', 'Amount', 'Purpose', 'Paid From', 'Reference', 'Status'],
    toRow: (v) => [
      v.voucherNumber || '', v.branchCode || '', day(v.date), v.payeeType || '',
      v.payeeName || '', money(v.amount), v.purpose || '',
      v.sourceAccountName || v.sourceAccount || '', v.referenceNumber || '', v.status || '',
    ],
  },

  revolvingFunds: {
    label: 'Revolving Funds', model: 'RevolvingFund',
    sort: { createdAt: -1 },
    columns: ['Fund Name', 'Custodian', 'Float', 'Balance', 'Spent', 'Status', 'Opened'],
    toRow: (f) => [
      f.name || '', f.custodian || '', money(f.floatAmount),
      money(f.currentBalance), money((f.floatAmount || 0) - (f.currentBalance || 0)),
      f.status || '', day(f.createdAt),
    ],
  },

  fixedAssets: {
    label: 'Fixed Assets', model: 'FixedAsset', importable: true,
    sort: { acquisitionDate: -1 },
    importSpec: {
      endpoint: '/api/fixed-assets/import',
      intro: 'One row per asset the business owns. Each row posts its own acquisition entry against cash. An asset already part-worn keeps its accumulated depreciation - otherwise everything imports looking brand new and the balance sheet overstates what you own.',
      columns: [
        { name: 'name', required: true, example: 'La Marzocco espresso machine' },
        { name: 'class', required: true, note: 'The name or the code from the Accounts sheet.', example: 'Machinery & Equipment' },
        { name: 'acquisitionCost', required: true, note: 'What was paid, before any depreciation.', example: '60000' },
        { name: 'usefulLifeMonths', required: true, note: '60 months = 5 years.', example: '60' },
        { name: 'salvageValue', note: 'What it will still be worth at the end. Depreciation stops there.', example: '6000' },
        { name: 'acquisitionDate', note: 'YYYY-MM-DD. Defaults to today. A closed month is refused.', example: '2026-01-15' },
        { name: 'accumulatedDepreciation', note: 'Already worn off, if you are carrying it in part-used.', example: '2700' },
        { name: 'serialNumber', example: 'LM-77120' },
        { name: 'location', example: 'Main bar' },
        { name: 'supplierName', example: 'Espresso Supply Co' },
        { name: 'referenceNumber', note: 'Their invoice number.', example: 'SI-004821' },
      ],
    },
    columns: ['Asset Code', 'Name', 'Class', 'Acquired', 'Cost', 'Salvage', 'Life (months)', 'Accum. Depreciation', 'Net Book Value', 'Status', 'Serial', 'Location'],
    toRow: (a) => [
      a.assetCode || '', a.name || '', a.accountCode || '', day(a.acquisitionDate),
      money(a.acquisitionCost), money(a.salvageValue), a.usefulLifeMonths ?? '',
      money(a.accumulatedDepreciation),
      money((a.acquisitionCost || 0) - (a.accumulatedDepreciation || 0)),
      a.status || '', a.serialNumber || '', a.location || '',
    ],
  },

  // ── Ledger. Export only: importing posted rows would let a spreadsheet
  //    rewrite history, and the balanced-entry guard exists precisely to stop
  //    that happening by accident.
  journal: {
    label: 'Journal Entries', model: 'JournalEntry', dateField: 'date',
    sort: { date: -1 },
    // One row per LINE, not per entry - a journal export that hides the lines
    // cannot be reconciled against anything.
    expand: (e) => (e.lines || []).map(l => [
      day(e.date), e.reference || '', e.description || '',
      l.accountCode || '', l.accountName || '',
      money(l.debit), money(l.credit),
    ]),
    columns: ['Date', 'Reference', 'Description', 'Account Code', 'Account Name', 'Debit', 'Credit'],
  },

  stockCards: {
    label: 'Stock Movements', model: 'StockCard', dateField: 'date',
    sort: { date: -1 },
    columns: ['Date', 'Item', 'Type', 'Reference', 'Qty Change', 'Balance After', 'Unit Cost', 'Remarks'],
    toRow: (c) => [
      day(c.date), c.itemName || '', c.type || '', c.reference || '',
      c.qtyChange ?? '', c.balanceAfter ?? '', money(c.unitCost), c.remarks || '',
    ],
  },

  orders: {
    label: 'Orders', model: 'Order', dateField: 'createdAt',
    sort: { createdAt: -1 },
    columns: ['Order No', 'Date', 'Customer', 'Status', 'Payment', 'Subtotal', 'Discount', 'Total', 'Items'],
    toRow: (o) => [
      o.orderNumber || '', day(o.createdAt), o.customerName || '', o.status || '',
      o.paymentMethod || '', money(o.subtotal), money(o.discount), money(o.total),
      (o.items || []).length,
    ],
  },

  expenses: {
    label: 'Expenses', model: 'JournalEntry', dateField: 'date', importable: true,
    importSpec: {
      endpoint: '/api/expenses/import',
      intro: 'One row per expense. Each posts its own balanced entry immediately - unlike bills there is no approval step, so check the sheet before importing. A date inside a closed month is refused.',
      columns: [
        { name: 'amount', required: true, note: 'The full amount, before any tax withheld.', example: '3500' },
        { name: 'categoryCode', required: true, note: 'Which expense account. See the Accounts sheet.', example: '610000' },
        { name: 'description', required: true, example: 'March electricity' },
        { name: 'paymentMethod', required: true, note: 'What it was paid from. See the Valid Values sheet.', example: 'Cash on Hand' },
        { name: 'date', note: 'YYYY-MM-DD. Defaults to today.', example: '2026-03-31' },
        { name: 'vendor', note: 'Who was paid.', example: 'Meralco' },
        { name: 'refNo', note: 'Their invoice or OR number.', example: 'OR-99120' },
        { name: 'withholdingRate', note: 'Percent withheld, if you withhold. Only read when the Withholding Tax module is on. Rent is usually 5, professional fees 10.', example: '5' },
      ],
    },
    sort: { date: -1 },
    // Expenses are journal entries whose debit side is an expense account, so
    // the export is filtered and flattened in the route rather than mapped 1:1.
    columns: ['Date', 'Reference', 'Category Code', 'Category', 'Amount', 'Paid From', 'Description'],
  },
};

// Build the value table for a chart-of-accounts export: every account with its
// balance, on the side that account naturally carries. Kept here so it can be
// tested without a database - the caller supplies the aggregated debit/credit
// totals it already has.
export function accountBalanceRows(totalsByCode, acctMeta) {
  const rows = [];
  for (const [code, t] of Object.entries(totalsByCode || {})) {
    const meta = acctMeta(code);
    if (!meta) continue;
    const debit = Number(t.debit) || 0;
    const credit = Number(t.credit) || 0;
    // Assets and expenses carry debit balances; everything else credit. Showing
    // a raw debit-minus-credit for a liability would render every payable
    // negative, which reads as an error to anyone holding the printout.
    const debitNatured = meta.type === 'asset' || meta.type === 'expense';
    const balance = debitNatured ? debit - credit : credit - debit;
    rows.push({
      code, name: meta.name, type: meta.type,
      debit: money(debit), credit: money(credit),
      balance: money(balance),
      side: debitNatured ? 'Debit' : 'Credit',
    });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export const ACCOUNT_BALANCE_COLUMNS =
  ['Account Code', 'Account Name', 'Type', 'Total Debit', 'Total Credit', 'Balance', 'Normal Side'];

// ── VALID VALUES ─────────────────────────────────────────────────────────────
// The reference sheet that ships WITH a template: for each column that only
// accepts certain values, what those values actually are.
//
// This exists because the alternative is guesswork. Filling a template with a
// plausible-looking label ("Rent", "Miscellaneous Expense") and having every
// row rejected because the importer wanted a code is the single most common way
// a bulk import wastes someone's afternoon - and the error arrives only after
// they have typed a hundred rows.
//
// `sourced` values come from live data (categories an operator created, payment
// methods they configured) and are filled in by the route; the static ones are
// enumerations the code itself defines.
export function buildValidValues({ expenseCategories = [], paymentMethods = [], stockCategories = [], suppliers = [], units = [], statuses = {} } = {}) {
  const table = [];
  const add = (dataset, column, values, note = '') => {
    if (!values || values.length === 0) return;
    table.push({ dataset, column, values: values.map(String), note });
  };

  add('fixedAssets', 'Class', statuses.assetClasses,
      'Either the code (140200) or the name (Machinery & Equipment).');
  add('fixedAssets', 'Status', statuses.assetStatus, 'Derived from the numbers; not settable on import.');
  add('inventory', 'Unit', units, 'Base units. kg and L are accepted and stored as g and ml.');
  add('inventory', 'Category', stockCategories, 'An unrecognised name creates a new stock category.');
  add('expenses', 'Category Code', expenseCategories.map(c => `${c.code} - ${c.label}`),
      'Use the CODE (the six digits), not the label.');
  add('expenses', 'Paid From', paymentMethods, 'Must match a configured payment method exactly.');
  add('products', 'Category', [], '');
  add('bills', 'Status', statuses.bill, '');
  add('purchaseOrders', 'Status', statuses.po, '');
  add('advances', 'Status', statuses.advance, 'Derived from the amounts; not settable on import.');
  add('advances', 'Type', statuses.advanceType, '');
  add('checkVouchers', 'Status', statuses.voucher, '');
  add('bills', 'Supplier', suppliers, 'Must match an existing supplier name.');
  add('purchaseOrders', 'Supplier', suppliers, 'Must match an existing supplier name.');

  return table;
}

export const VALID_VALUE_COLUMNS = ['Dataset', 'Column', 'Accepted Values', 'Notes'];

export const datasetKeys = () => Object.keys(DATASETS);
export const isImportable = (key) => !!DATASETS[key]?.importable;
