// What one counted unit of a PACKED item is called.
//
// An item with a pack size is counted in packs everywhere - receiving, the EOD
// count, thresholds, waste, the Hub, the stock card - and a pack used to be
// labelled "pcs". In logistics that is the right word: one piece IS one
// package, the thing on the shelf. In a cafe it is the wrong one. Cups bought
// in sleeves of fifty read "104 pcs" for 104 sleeves, and a stock card showed
// a single cup leaving as "-0.02 pcs", which looks like the till deducting a
// fiftieth of a cup when it had deducted exactly one.
//
// Only the word changes. What is counted, and every stored number, stays.
const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();

export const PACK_UNIT = BUSINESS_TYPE === 'log' ? 'pcs' : 'packs';
