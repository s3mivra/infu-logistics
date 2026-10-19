import { describe, it, expect } from 'vitest';
import { guideSteps } from './PortalGuide';

const titles = (o) => guideSteps(o).map((s) => s.title);
const text = (o, title) => guideSteps(o).find((s) => s.title === title).text;

describe('portal guide', () => {
  it('walks an ordering client from finding a product to tracking it', () => {
    expect(titles({})).toEqual(['Find it', 'Add it', 'Check your order', 'Pay and send', 'Track it']);
  });

  it('tells a quote-only client they request a quote and are not charged', () => {
    expect(titles({ quoteOnly: true })).toContain('Request a quote');
    expect(titles({ quoteOnly: true })).not.toContain('Pay and send');
    expect(text({ quoteOnly: true }, 'Request a quote')).toMatch(/Nothing is charged/);
  });

  it('mentions the QR reference only when the shop has a payment QR', () => {
    expect(text({ hasQr: true }, 'Pay and send')).toMatch(/Pay Now/);
    expect(text({ hasQr: false }, 'Pay and send')).not.toMatch(/QR/);
  });

  it('mentions the estimated total only when prices are shown', () => {
    expect(text({ showPrices: true }, 'Check your order')).toMatch(/estimated total/);
    expect(text({ showPrices: false }, 'Check your order')).not.toMatch(/total/);
  });
});
