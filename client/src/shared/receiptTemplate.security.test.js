// 2026-11 audit, M09 / M10: what customers and branding settings put on a
// printed slip must never become markup.
import { describe, it, expect } from 'vitest';
import { buildReceiptHTML, safeHref } from './receiptTemplate.js';
import { buildBillingDocHTML } from './billingDocument.js';

const PAYLOAD = '<img src=x onerror=alert(1)>';

describe('order slip', () => {
  it('escapes customer-supplied meta values', () => {
    const html = buildReceiptHTML({ metaRows: [{ label: 'Address', value: PAYLOAD }, { label: 'Phone', value: '"><script>alert(1)</script>' }] });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;img src=x');
  });
  it('drops branding values that are not a size, colour or image', () => {
    const html = buildReceiptHTML({ settings: {
      businessLogo: 'x" onerror="alert(1)', logoColor: 'red;}</style><script>alert(1)</script>', logoRadius: '1px;}</style><script>alert(2)</script>',
    } });
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script>alert');
  });
  it('keeps real branding', () => {
    const html = buildReceiptHTML({ settings: { businessLogo: 'data:image/png;base64,iVBORw0KGgo=', logoColor: '#ffc107', logoRadius: '12px' } });
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(html).toContain('background:#ffc107');
    expect(html).toContain('border-radius: 12px');
  });
  it('allows only http(s) and mailto links', () => {
    expect(safeHref('javascript:alert(1)')).toBe('');
    expect(safeHref('https://m.me/shop')).toBe('https://m.me/shop');
  });
});

describe('billing document', () => {
  it('escapes terms and drops unsafe branding', () => {
    const html = buildBillingDocHTML({ terms: [PAYLOAD], settings: { businessLogo: 'javascript:alert(1)', logoRadius: 'x;}</style><script>alert(1)</script>' } });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script>alert');
  });
});
