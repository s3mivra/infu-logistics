/* Keeping an installed app on the latest version.
 *
 * A till is opened in the morning and left open all day. Nothing ever reloads
 * it, so it went on running whatever version it started with - a fix deployed
 * at noon reached it the next morning, or whenever somebody happened to pull
 * down to refresh. This watches for a new deployment and moves to it, but only
 * at a moment when doing so cannot cost anyone anything:
 *
 *   - never while a sale is being rung or a form is open (the app tells us
 *     through setUpdateGuard, and any open dialog counts on its own);
 *   - only after the screen has been left alone for a minute, or when the app
 *     is brought back to the front;
 *   - and at once, whenever someone presses "Update now".
 *
 * A new deployment is spotted by the one thing that always changes when the
 * app does: the fingerprinted name of its main script, /assets/index-<hash>.js.
 * No build step and no server change are needed for that.
 */

const CHECK_EVERY_MS = 5 * 60 * 1000;
const IDLE_BEFORE_APPLY_MS = 60 * 1000;
const RELOADED_KEY = 'semivra.update.reloadedFor';

let guard = () => false;
let lastActivity = Date.now();
let pendingBuild = null;
let banner = null;
let applyTimer = null;

// The app says when it has work that a reload would lose - a cart with items
// in it, for one. Called at the moment of deciding, so it reads current state.
export function setUpdateGuard(fn) {
  guard = typeof fn === 'function' ? fn : () => false;
}

// The build this page is running, or null in development (Vite serves the
// source unbundled, so there is no fingerprinted entry to compare).
function runningBuild() {
  const s = document.querySelector('script[type="module"][src*="/assets/index-"]');
  const m = s && s.getAttribute('src').match(/\/assets\/index-[\w-]+\.js/);
  return m ? m[0] : null;
}

async function latestBuild() {
  // "__fresh" tells the service worker to go to the network: served from its
  // cache, the page would always look unchanged.
  const res = await fetch(`/?__fresh=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) return null;
  const m = (await res.text()).match(/\/assets\/index-[\w-]+\.js/);
  return m ? m[0] : null;
}

// Something a reload would throw away: an open dialog, something typed into
// the field that has the cursor, or whatever the app itself reports. An EMPTY
// focused field is not work: the login screen puts the cursor in Staff Name by
// itself, and counting that kept a till sitting at the login screen - the best
// moment there is to update - from ever updating.
function busy() {
  try { if (guard()) return true; } catch { return true; }
  const el = document.activeElement;
  if (el?.isContentEditable && el.textContent.trim()) return true;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && String(el.value || '').trim()) return true;
  // Only one that is actually shown: a hidden overlay kept in the page would
  // otherwise block every update for as long as it sat there. Decided by CSS,
  // never by size - a backgrounded or screen-off tablet can report a window of
  // 0 x 0, and measuring would then call an open sale "not on screen" and
  // reload straight through it.
  return [...document.querySelectorAll('[role="dialog"], .fixed.inset-0')].some(isShown);
}

function isShown(el) {
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  }
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  }
  return true;
}

function reload() {
  try { sessionStorage.setItem(RELOADED_KEY, pendingBuild || ''); } catch { /* private mode */ }
  window.location.reload();
}

function tryApply() {
  if (!pendingBuild) return;
  const hidden = document.visibilityState === 'hidden';
  const idle = Date.now() - lastActivity >= IDLE_BEFORE_APPLY_MS;
  if ((hidden || idle) && !busy()) reload();
}

function showBanner() {
  if (banner || !document.body) return;
  banner = document.createElement('div');
  banner.setAttribute('role', 'status');
  banner.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:16px', 'transform:translateX(-50%)', 'z-index:2147483000',
    'display:flex', 'align-items:center', 'gap:12px', 'max-width:calc(100vw - 32px)',
    'padding:10px 12px 10px 16px', 'border-radius:14px', 'background:#111827', 'color:#f9fafb',
    'box-shadow:0 10px 30px rgba(0,0,0,.35)', 'font:600 13px/1.3 system-ui,sans-serif',
  ].join(';');
  const text = document.createElement('span');
  text.textContent = 'A new version is ready. It installs itself when the till is idle.';
  const now = document.createElement('button');
  now.type = 'button';
  now.textContent = 'Update now';
  now.style.cssText = 'border:0;border-radius:10px;padding:8px 12px;background:#16a34a;color:#fff;font:700 12px system-ui,sans-serif;cursor:pointer;white-space:nowrap';
  now.onclick = reload;
  const later = document.createElement('button');
  later.type = 'button';
  later.setAttribute('aria-label', 'Hide');
  later.textContent = '×';
  later.style.cssText = 'border:0;background:transparent;color:#d1d5db;font:700 18px system-ui,sans-serif;cursor:pointer;padding:0 4px';
  later.onclick = () => { banner?.remove(); banner = null; };
  banner.append(text, now, later);
  document.body.appendChild(banner);
}

async function check() {
  const running = runningBuild();
  if (!running) return;
  try {
    const latest = await latestBuild();
    if (!latest || latest === running) return;
    // Reloaded for this very build already and still on the old one - the
    // new page is not being served yet (a cache in between). Do not loop.
    let already = '';
    try { already = sessionStorage.getItem(RELOADED_KEY) || ''; } catch { /* private mode */ }
    if (already === latest) return;
    pendingBuild = latest;
    showBanner();
    tryApply();
  } catch { /* offline or the server is restarting - try again next time */ }
}

export function startAutoUpdate() {
  if (!runningBuild()) return;   // development: nothing to compare against
  const touch = () => { lastActivity = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
    window.addEventListener(ev, touch, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
    else tryApply();
  });
  window.addEventListener('online', check);
  setInterval(check, CHECK_EVERY_MS);
  // Once a build is waiting, keep looking for the idle moment to take it.
  applyTimer = applyTimer || setInterval(tryApply, 15 * 1000);
  // The service worker too: an installed app never navigates, so the browser
  // otherwise only looks for a new one about once a day.
  if ('serviceWorker' in navigator) {
    setInterval(() => { navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {}); }, CHECK_EVERY_MS);
  }
  setTimeout(check, 30 * 1000);
}
