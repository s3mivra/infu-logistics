// The Purchases window renders, and shows what the user's permissions allow.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PurchasesImportModal from './PurchasesImportModal';

const apiFetch = async () => ({ ok: true, json: async () => ({ success: true, sheet: {} }) });
const render = (perms) => renderToStaticMarkup(
  <PurchasesImportModal apiFetch={apiFetch} can={(p) => perms.includes(p)} onClose={() => {}} />,
);

describe('Purchases window', () => {
  it('offers the template, Excel upload, Google Sheet and both switches', () => {
    const html = render(['inventory.manage', 'accounting.manage', 'sales.backdate']);
    for (const s of ['Template', 'Upload Excel', 'Google Sheet', 'Add to stock', 'Post to the books', 'Paid from']) expect(html).toContain(s);
    expect(html).not.toContain('Needs accounting or fund-spending rights');
  });

  it('greys out posting money without accounting or fund rights, and says why', () => {
    const html = render(['inventory.manage']);
    expect(html).toContain('Needs accounting or fund-spending rights.');
    expect(html).toContain('need the backdate permission');
  });
});
