// Network transfers as shipments, and their slips.
import { describe, it, expect } from 'vitest';
import { groupShipments, displayQty, exportTransferSlip, exportAllTransfers } from './transferSlips.js';

const line = (ref, itemName, extra = {}) => ({
  _id: ref, reference: ref, shipmentRef: ref.replace(/-L\d+$/, ''), direction: 'outbound', partnerSlug: 'infu-main-bar', partnerName: 'infu-main-bar',
  itemName, status: 'Released', createdAt: '2026-11-16T03:00:00Z', unitCost: 0.08, qtyBase: 24000, unit: 'ml', displayUnit: 'L', unitMultiplier: 1000, ...extra,
});
const transfers = [
  line('HT-A-L1', 'ALASKA BARISTA MILK', { itemCode: 'MJ-2' }),
  line('HT-A-L2', 'UJI MATCHABURI 1KG', { qtyBase: 1000, unit: 'g', displayUnit: 'kg', unitCost: 1.5 }),
  line('HT-A-L3', 'UBE PASTE', { qtyBase: 3, unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1, unitCost: 250, status: 'Pending' }),
  line('HT-B-L1', 'OAT MILK', { direction: 'inbound', createdAt: '2026-11-17T03:00:00Z', qtyBase: 6000, unitCost: 0.1 }),
];

describe('shipments', () => {
  it('puts the lines of one send together, newest shipment first', () => {
    const s = groupShipments(transfers);
    expect(s.map((x) => [x.ref, x.lines.length])).toEqual([['HT-B', 1], ['HT-A', 3]]);
    expect(s[1].value).toBe(1920 + 1500 + 750);
    expect(s[1].status).toEqual({ label: '2 Released, 1 Pending', mixed: true });
    expect(s[0].status).toEqual({ label: 'Released', mixed: false });
  });

  it('a line with no shipmentRef is grouped by its reference', () => {
    const s = groupShipments([{ ...transfers[0], shipmentRef: undefined }, { ...transfers[1], shipmentRef: undefined }]);
    expect(s).toHaveLength(1);
  });

  it('shows quantities the way they are counted', () => {
    expect(displayQty(transfers[0])).toBe('24 L');
    expect(displayQty(transfers[2])).toBe('3 pcs');
  });
});

describe('the PDFs', () => {
  const deps = async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const saved = {};
    const CapturingPDF = function CapturingPDF(...args) { const doc = new jsPDF(...args); doc.save = (name) => { saved.name = name; }; return doc; };
    return { saved, d: { loadPdfLibs: async () => ({ jsPDF: CapturingPDF, autoTable }), addLogoToPDF: async () => {}, bizName: 'infu-main-log' } };
  };
  const textOf = (doc) => new TextDecoder('latin1').decode(doc.output('arraybuffer'));

  it("prints one shipment's slip with every line and the total", async () => {
    const { saved, d } = await deps();
    const s = groupShipments(transfers)[1];
    const doc = await exportTransferSlip(s, d);
    expect(saved.name).toBe('Transfer-HT-A.pdf');
    const t = textOf(doc);
    for (const x of ['STOCK TRANSFER SLIP', 'ALASKA BARISTA MILK', 'UBE PASTE', '24 L', '4,170.00', 'Received by']) expect(t, x).toContain(x);
  }, 20000);

  it('exports every shipment: a list, then each slip', async () => {
    const { saved, d } = await deps();
    const doc = await exportAllTransfers(groupShipments(transfers), d);
    expect(saved.name).toMatch(/^Stock-Transfers-/);
    expect(doc.getNumberOfPages()).toBe(3);
    expect(textOf(doc)).toContain('2 shipment');
  }, 20000);
});
