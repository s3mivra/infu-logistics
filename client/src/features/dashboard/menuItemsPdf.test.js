// The catalog / menu items PDF: how many are left of each, and what is out of stock.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/ui', () => ({ alert: () => {}, confirm: async () => true }));

describe('the catalog PDF', () => {
  it('lists the stock left and marks what is out of stock', async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    let saved;
    const CapturingPDF = function CapturingPDF(...args) {
      const doc = new jsPDF(...args);
      doc.save = (name) => { saved = { name, doc }; };
      return doc;
    };
    const products = [
      { name: 'ALASAKA CONDENSED MILK', category: 'MILK/JUICE', productCode: 'MJ-1', basePrice: 81, baseSize: 'kg', baseRecipe: [{ invId: 'a', qty: 1 }] },
      { name: 'ALASKA BARISTA MILK 1L', category: 'MILK/JUICE', productCode: 'MJ-2', basePrice: 95, baseSize: 'pcs', baseRecipe: [{ invId: 'b', qty: 1 }] },
      { name: 'VANILLA SYRUP', category: 'SYRUPS', productCode: 'SY-1', basePrice: 350, baseSize: 'pcs', baseRecipe: [{ invId: 'c', qty: 1 }] },
      { name: 'DELIVERY BAG', category: 'OTHERS', productCode: 'OT-1', basePrice: 5, baseSize: 'pcs', baseRecipe: [] },
    ];
    const left = { a: 0, b: 240, c: 3 };
    const { default: makeReportExports } = await import('./makeReportExports.js');
    const { exportMenuItemsPDF } = makeReportExports({
      products, BUSINESS_TYPE: 'log', BIZ_NAME: 'Test Shop',
      loadPdfLibs: async () => ({ jsPDF: CapturingPDF, autoTable }), addLogoToPDF: async () => {},
      pdfMoney: (n) => Number(n).toFixed(2),
      getEstimatedStock: (recipe) => (recipe?.length ? left[recipe[0].invId] : null),
    });
    await exportMenuItemsPDF();
    expect(saved?.name).toMatch(/^Menu-Items-/);
    const text = new TextDecoder('latin1').decode(saved.doc.output('arraybuffer'));
    for (const s of ['Stock', 'Out of stock', '240', '1 out of stock', '1 low']) expect(text, s).toContain(s);
  }, 20000);
});
