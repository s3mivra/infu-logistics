import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { withPrintedBy, setPrintedBy } from './printedBy.js';

describe('printed by', () => {
  it('every page of a PDF report says who printed it', () => {
    setPrintedBy('Ana Cruz');
    const Doc = withPrintedBy(jsPDF);
    const doc = new Doc();
    doc.text('Sales report', 10, 10);
    doc.addPage();
    const raw = doc.output();
    expect(raw).toContain('Printed by Ana Cruz');
    expect(raw).toContain('Page 1 of 2');
    expect(raw).toContain('Page 2 of 2');
    // Saved twice, stamped once.
    expect(doc.output().split('Printed by Ana Cruz').length - 1).toBe(2);
  });
});
