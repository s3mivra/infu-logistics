// Barcode scanning at the till. A USB scanner is a keyboard that types the
// code and presses Enter (see shared/ScanBox.jsx); this is what happens next:
// ask the server which product carries the code, then ring it up.
//
// Pure logic - the fetch is passed in - so it can be tested without a DOM.

// What the lookup came back with:
//   { kind: 'found', product }        one product - ring it up
//   { kind: 'ambiguous', product, n } several share the code - a person picks
//   { kind: 'missing' }               no product has it
//   { kind: 'error', text }           offline or a server fault
export async function lookupBarcode(apiFetch, code) {
  const c = String(code || '').trim();
  if (!c) return { kind: 'missing' };
  let res;
  try {
    res = await apiFetch(`/api/products/by-barcode/${encodeURIComponent(c)}`);
  } catch {
    return { kind: 'error', text: 'Could not reach the server to look up that code.' };
  }
  if (res.status === 404) return { kind: 'missing' };
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data?.success || !data.product) {
    return { kind: 'error', text: data?.error || 'Barcode lookup failed.' };
  }
  if (data.ambiguous) return { kind: 'ambiguous', product: data.product, n: data.matchCount || 2 };
  return { kind: 'found', product: data.product };
}

// Can this product go straight into the cart, or does somebody have to choose
// a size or a required option first? A scan must never guess a variant.
export function needsChoice(product, modifierGroups = []) {
  if (!product) return true;
  if (Array.isArray(product.sizes) && product.sizes.length > 0) return true;
  return (product.modifierGroups || []).some(mg => {
    const g = typeof mg === 'object' ? mg : modifierGroups.find(x => x._id === mg);
    return !!g?.isRequired;
  });
}

// The cart line a scan adds. Same shape confirmPosItem builds; the server
// re-resolves prices and client rates at checkout regardless.
export function scannedLine(product, { department, discountPercent = 0 } = {}) {
  const price = product.activeSalePrice ?? product.basePrice ?? product.price ?? 0;
  return {
    productId: product._id,
    name: product.name,
    price,
    listPrice: product.activeSalePrice == null ? price : null,
    quantity: 1,
    department,
    selectedAddOns: [],
    discountPercent,
  };
}

// Scanning the same item twice means two of it: bump the plain line already
// in the cart rather than adding a second one. A line with add-ons or a size
// is a different thing and is left alone.
export function addScanned(cart, line) {
  const i = cart.findIndex(it => it.productId === line.productId && it.name === line.name
    && !(it.selectedAddOns || []).length && it.price === line.price);
  if (i === -1) return [...cart, line];
  return cart.map((it, j) => (j === i ? { ...it, quantity: (it.quantity || 0) + 1 } : it));
}
