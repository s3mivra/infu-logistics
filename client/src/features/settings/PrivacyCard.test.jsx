// The privacy card renders its search; exporting says when it is not allowed.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PrivacyCard from './PrivacyCard';

describe('PrivacyCard', () => {
  it('offers the search', () => {
    const html = renderToStaticMarkup(<PrivacyCard apiFetch={async () => ({ json: async () => ({}) })} can={() => true} />);
    expect(html).toContain("A person&#x27;s data");
    expect(html).toContain('Name, phone, e-mail or code');
  });
});
