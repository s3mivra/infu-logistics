// Which business this build is for, and the handful of things that follow
// from it - said once.
//
// Each screen used to work these out for itself: sixteen files read the
// setting, four named the default department, five listed the delivery
// methods. Copies drift. One read the setting without lowercasing it, and two
// of the delivery lists had no Lalamove, so a logistics business's Lalamove
// sales fell out of the payment breakdown on the Sales History export.
// Anything that is the same for a whole business type belongs here.
export const BUSINESS_TYPE = String(import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();
export const IS_LOG = BUSINESS_TYPE === 'log';
export const IS_FB = !IS_LOG;

// Where an order's lines are sent to be made or picked. The first is the
// default for a product that names none.
export const DEPARTMENTS = IS_LOG ? ['Logistics', 'Warehouse'] : ['Kitchen', 'Bar'];
export const DEFAULT_DEPARTMENT = DEPARTMENTS[0];

// Order types that are a delivery. The order's payment method carries the same
// name, which is how a sale is recognised as one afterwards. Both business
// types are listed: a name the other type never uses simply never matches.
export const DELIVERY_METHODS = ['Grab Delivery', 'Foodpanda', 'Manual Delivery', 'Lalamove'];
export const isDeliveryMethod = (name) => DELIVERY_METHODS.includes(name);

// The closing line on a receipt.
export const THANKS_LINE = IS_LOG ? 'Thank you for your business!' : 'Thank you for dining with us!';

// Does a customer sign in to this business? A logistics client has an account
// and orders through the client portal. A cafe's only online ordering is the
// table QR code, which needs no account - so a cafe has no client sign-in, no
// invitation links and no client passwords, anywhere.
export const HAS_CLIENT_LOGIN = IS_LOG;

// Reports whose name is a cafe's word for something a logistics business has
// under another name.
export const REPORT_NAMES = {
  menueng: IS_LOG ? 'Product Mix' : 'Menu Engineering',
};

// The name printed on documents this app writes itself (price lists, emails).
export const BUSINESS_NAME = String(import.meta.env.VITE_BUSINESS_NAME || '').trim();
