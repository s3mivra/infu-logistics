// Raw-material -> finished-good conversion (e.g. green coffee beans roasted
// into coffee beans). Log-business concept: it turns one or more Inventory
// items into a different Inventory item, rolling the consumed cost into the
// output's unit cost. Pure Inventory Asset reclassification (no other account
// touched), so unlike restock/purchase it never posts a journal entry - total
// Inventory Asset value doesn't change, it just moves between SKUs.
// Mass/volume/count never mix - a conversion can't change what's physically
// being measured, so pcs raw materials must produce a pcs output and g/ml raw
// materials must produce a g/ml output (client mirrors this in ProductionTab.jsx).
const unitKind = (u) => (u === 'g' ? 'mass' : u === 'ml' ? 'volume' : 'count');

export default function registerProduction(ctx) {
  const {
    app, BUSINESS_TYPE, mongoose,
    Inventory, StockCard, ProductionOrder,
    verifyToken, requireStaff, tenantScope, mkSeqRef, emitToMgr,
  } = ctx;

  app.get('/api/production', verifyToken, requireStaff, async (req, res) => {
    try {
      const rows = await ProductionOrder.find({ businessType: BUSINESS_TYPE, ...tenantScope(req) })
        .sort({ createdAt: -1 }).limit(200).lean();
      res.json({ success: true, orders: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/production', verifyToken, requireStaff, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { inputs, outputInvId, outputNew, outputQty, note } = req.body || {};
      const qtyOut = parseFloat(outputQty);

      if (!Array.isArray(inputs) || inputs.length === 0) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ success: false, error: 'At least one raw material input is required.' });
      }
      if (!(qtyOut > 0)) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ success: false, error: 'Output quantity must be greater than 0.' });
      }
      if (!outputInvId && !outputNew?.itemName?.trim()) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ success: false, error: 'Provide an output item (existing or new).' });
      }

      const reference = await mkSeqRef('PROD');
      let totalRawCost = 0;
      const inputLines = [];

      for (const line of inputs) {
        const qty = parseFloat(line.qty);
        if (!line.invId || !(qty > 0)) {
          await session.abortTransaction(); session.endSession();
          return res.status(400).json({ success: false, error: 'Each input needs an item and a qty > 0.' });
        }
        const item = await Inventory.findOne({ _id: line.invId, businessType: BUSINESS_TYPE }).session(session);
        if (!item) {
          await session.abortTransaction(); session.endSession();
          return res.status(404).json({ success: false, error: `Input item not found.` });
        }
        if (item.stockQty < qty) {
          await session.abortTransaction(); session.endSession();
          return res.status(400).json({ success: false, error: `Insufficient stock for ${item.itemName}. On hand: ${item.stockQty} ${item.unit}.` });
        }
        const lineCost = qty * (item.unitCost || 0);
        totalRawCost += lineCost;

        item.stockQty -= qty;
        await item.save({ session });

        await StockCard.create([{
          inventoryId: item._id,
          itemName: item.itemName,
          type: 'Production Out',
          reference,
          qtyChange: -qty,
          balanceAfter: item.stockQty,
          unitCost: item.unitCost,
          remarks: `Consumed for production (${reference})`,
        }], { session });

        inputLines.push({ invId: item._id, itemName: item.itemName, qtyBase: qty, unitCost: item.unitCost || 0, unit: item.unit });
      }

      const rawKinds = [...new Set(inputLines.map(l => unitKind(l.unit)))];

      const newUnitCost = totalRawCost / qtyOut;
      let outputItem;

      if (outputInvId) {
        outputItem = await Inventory.findOne({ _id: outputInvId, businessType: BUSINESS_TYPE }).session(session);
        if (!outputItem) {
          await session.abortTransaction(); session.endSession();
          return res.status(404).json({ success: false, error: 'Output item not found.' });
        }
        if (rawKinds.length === 1 && unitKind(outputItem.unit) !== rawKinds[0]) {
          await session.abortTransaction(); session.endSession();
          return res.status(400).json({ success: false, error: `${outputItem.itemName} is tracked in ${outputItem.unit}, which doesn't match the raw materials' unit. A conversion can't change what's being measured (weight/volume/count).` });
        }
        const currentTotalValue = outputItem.stockQty * (outputItem.unitCost || 0);
        const newStockQty = outputItem.stockQty + qtyOut;
        outputItem.unitCost = newStockQty > 0 ? (currentTotalValue + totalRawCost) / newStockQty : 0;
        outputItem.stockQty = newStockQty;
        await outputItem.save({ session });
      } else {
        const newOutputUnit = outputNew.unit || 'pcs';
        if (rawKinds.length === 1 && unitKind(newOutputUnit) !== rawKinds[0]) {
          await session.abortTransaction(); session.endSession();
          return res.status(400).json({ success: false, error: `Output unit "${newOutputUnit}" doesn't match the raw materials' unit. A conversion can't change what's being measured (weight/volume/count).` });
        }
        const created = await Inventory.create([{
          businessType: BUSINESS_TYPE,
          itemName: outputNew.itemName.trim(),
          unit: newOutputUnit,
          displayUnit: outputNew.displayUnit || '',
          unitMultiplier: outputNew.unitMultiplier || 1,
          packSize: outputNew.packSize || null,
          stockQty: qtyOut,
          unitCost: newUnitCost,
        }], { session });
        outputItem = created[0];
      }

      await StockCard.create([{
        inventoryId: outputItem._id,
        itemName: outputItem.itemName,
        type: 'Production In',
        reference,
        qtyChange: qtyOut,
        balanceAfter: outputItem.stockQty,
        unitCost: outputItem.unitCost,
        remarks: `Produced from ${inputLines.map(l => l.itemName).join(', ')} (${reference})`,
      }], { session });

      const order = await ProductionOrder.create([{
        businessType: BUSINESS_TYPE,
        reference,
        inputs: inputLines,
        outputInvId: outputItem._id,
        outputItemName: outputItem.itemName,
        outputQtyBase: qtyOut,
        outputUnitCost: newUnitCost,
        note: String(note || '').trim(),
      }], { session });

      await session.commitTransaction();
      session.endSession();
      emitToMgr('erpUpdated');
      res.json({ success: true, order: order[0] });
    } catch (err) {
      await session.abortTransaction().catch(() => {});
      session.endSession();
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
