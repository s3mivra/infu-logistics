// The Daily Inventory & Movement Report: purchases and transfers in their own
// columns and sections, and a beginning balance that adds up.
import { describe, it, expect, vi } from 'vitest';
import { tallyMovements, movementLines } from './inventoryMovement.js';

// The export reports failures through ui.alert; surface them in the test.
const alerts = [];
vi.mock('./ui', () => ({ alert: (m) => { alerts.push(String(m)); }, confirm: async () => true }));

const day = '2026-11-13T';
const history = [
  { inventoryId: 'a', itemName: 'Rice', type: 'Restock', qtyChange: 50, unitCost: 40, reference: 'RCV-1', remarks: 'PO-7 from Mill Co', date: `${day}01:00:00Z` },
  { inventoryId: 'a', itemName: 'Rice', type: 'Transfer In', qtyChange: 10, reference: 'HUB-3', remarks: 'Hub transfer in from Main', date: `${day}02:00:00Z` },
  { inventoryId: 'a', itemName: 'Rice', type: 'Transfer Out', qtyChange: -5, reference: 'TRF-2', remarks: 'Transfer to Branch B (TRF-2)', date: `${day}03:00:00Z` },
  { inventoryId: 'a', itemName: 'Rice', type: 'Sale', qtyChange: -20, date: `${day}04:00:00Z` },
  { inventoryId: 'a', itemName: 'Rice', type: 'Spoilage', qtyChange: -2, date: `${day}05:00:00Z` },
];

describe('tallyMovements', () => {
  it('puts purchases and transfers in their own buckets', () => {
    const t = tallyMovements(history, 133);
    expect(t).toMatchObject({ purchases: 50, transfersIn: 10, transfersOut: 5, sales: 20, other: -2, ending: 133 });
  });

  it('works the beginning balance back through every movement', () => {
    const t = tallyMovements(history, 133);
    // 133 - 50 - 10 + 5 + 20 + 2
    expect(t.beginning).toBe(100);
    expect(t.beginning + t.purchases + t.transfersIn - t.transfersOut - t.sales + t.other).toBe(t.ending);
  });

  it('a sale returned to stock reduces sales', () => {
    expect(tallyMovements([{ type: 'Sale', qtyChange: -5 }, { type: 'Sale', qtyChange: 2 }], 0).sales).toBe(3);
  });
});

describe('movementLines', () => {
  it('lists the purchase and transfer lines in time order', () => {
    const l = movementLines([...history].reverse());
    expect(l.purchases.map((h) => h.reference)).toEqual(['RCV-1']);
    expect(l.transfers.map((h) => h.type)).toEqual(['Transfer In', 'Transfer Out']);
  });
});

describe('the PDF', () => {
  it('has the new columns and the purchases and transfers sections', async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    let saved;
    // jsPDF puts save() on each document, so wrap the constructor.
    const CapturingPDF = function CapturingPDF(...args) {
      const doc = new jsPDF(...args);
      doc.save = (name) => { saved = { name, doc }; };
      return doc;
    };
    const { default: makePdfExports } = await import('../features/dashboard/makePdfExports.js');
    const { exportInventoryToPDF } = makePdfExports({
      inventory: [{ _id: 'a', itemName: 'Rice', stockQty: 133, unit: 'kg', displayUnit: 'kg', unitMultiplier: 1 }],
      apiFetch: vi.fn(async () => ({ json: async () => ({ success: true, history: history.map((h) => ({ ...h, date: new Date().toISOString() })) }) })),
      loadPdfLibs: async () => ({ jsPDF: CapturingPDF, autoTable }),
      BIZ_NAME: 'Test Shop', systemSettings: {},
      itemDisplay: () => ({ packBase: 1 }), effectiveDisplay: () => ({ mult: 1, unit: 'kg' }),
      pdfMoney: (n) => `P${Number(n).toFixed(2)}`,
      onceAtATime: (fn) => fn,
    });
    await exportInventoryToPDF();
    expect(alerts).toEqual([]);
    expect(saved?.name).toMatch(/^Inventory_Movement_/);
    const text = new TextDecoder('latin1').decode(saved.doc.output('arraybuffer'));
    for (const s of ['Transfers In', 'Transfers Out', 'Adjustments & Other', 'Purchases', 'Transfers', 'RCV-1', 'HUB-3', 'TRF-2', 'Total purchases received: P2000.00']) {
      expect(text, s).toContain(s);
    }  });
});
