// Editing a permission list that has pages in it.
//
// A page permission (screen.<tab>.<page>, see server/lib/authz.js) only narrows
// the tab its parent permission opens, and a tab with no page named opens every
// page. That rule is what keeps every role written before pages existed working,
// but it means the list as stored is not the list as it acts: a role holding
// accounting.view and no ledger page can open all fourteen of them. The editor
// has to show the second, and change the first so that it becomes what was
// clicked. These two functions are that translation, with nothing else in them,
// so they can be tested on their own.

// Pages grouped by the tab they belong to, from the catalogue /api/permissions
// returns: { 'screen.ledger.': { parent: 'accounting.view', keys: [...] } }.
export function screenFamilies(catalog = []) {
  const fam = {};
  for (const p of catalog) {
    if (!p || !p.parent || !String(p.key).startsWith('screen.')) continue;
    const prefix = p.key.slice(0, p.key.lastIndexOf('.') + 1);
    (fam[prefix] = fam[prefix] || { parent: p.parent, keys: [] }).keys.push(p.key);
  }
  return fam;
}

// What a stored list actually grants - the server's withScreens, on the client.
export function effectivePermissions(list = [], catalog = []) {
  const set = new Set(list);
  for (const { parent, keys } of Object.values(screenFamilies(catalog))) {
    if (!set.has(parent)) { keys.forEach((k) => set.delete(k)); continue; }
    if (!keys.some((k) => set.has(k))) keys.forEach((k) => set.add(k));
  }
  return set;
}

// Whether a page checkbox can be changed at all: not while its tab is closed,
// and not the last page left open (a tab open on nothing is not a state - close
// the tab instead).
export function pageLocked(list = [], key, catalog = []) {
  const fam = Object.values(screenFamilies(catalog)).find((f) => f.keys.includes(key));
  if (!fam) return false;
  if (!list.includes(fam.parent)) return true;
  const eff = effectivePermissions(list, catalog);
  const open = fam.keys.filter((k) => eff.has(k));
  return open.length === 1 && open[0] === key;
}

// The stored list after one checkbox is clicked.
//   - a page: the tab's pages are written out as they currently act, then the
//     one clicked flips - so unticking one page leaves the other pages open;
//   - a tab's parent switched off: its pages go with it, so switching it back
//     on later opens every page again rather than resurrecting an old choice.
export function togglePermission(list = [], key, catalog = []) {
  const fams = Object.values(screenFamilies(catalog));
  const fam = fams.find((f) => f.keys.includes(key));
  if (fam) {
    if (pageLocked(list, key, catalog)) return list;
    const eff = effectivePermissions(list, catalog);
    const others = list.filter((k) => !fam.keys.includes(k));
    const pages = fam.keys.filter((k) => (k === key ? !eff.has(k) : eff.has(k)));
    // Every page open again is the same as naming none - store it that way,
    // so a tab left whole stays whole when a page is added to it later.
    return pages.length === fam.keys.length ? others : [...others, ...pages];
  }
  if (list.includes(key)) {
    const drop = new Set(fams.filter((f) => f.parent === key).flatMap((f) => f.keys));
    return list.filter((k) => k !== key && !drop.has(k));
  }
  return [...list, key];
}
