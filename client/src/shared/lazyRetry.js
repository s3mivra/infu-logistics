import { lazy } from 'react';

// React.lazy that survives a deploy (2026-11 audit, M111).
//
// Every build renames its chunks. A till that loaded the app before a deploy
// still asks for the old names, the server answers 404 (or the network is
// briefly gone), and lazy() throws - which used to replace the whole dashboard
// with the crash screen and lose the open cart.
//
// So: try again once after a moment (a dropped connection), and if the chunk
// is still missing, reload the page once so the new index.html brings the new
// names. A session flag stops a broken build from reloading forever; the error
// then reaches the nearest error boundary as before.
const RELOAD_FLAG = 'semivra.chunkReloadAt';
const RELOAD_WINDOW_MS = 60 * 1000;

const isChunkError = (err) => /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|Loading chunk/i
  .test(String(err?.message || err));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function importWithRetry(factory, { retryDelayMs = 1500, storage = globalThis.sessionStorage, reload = () => window.location.reload() } = {}) {
  try {
    return await factory();
  } catch (first) {
    if (!isChunkError(first)) throw first;
    await wait(retryDelayMs);
    try {
      return await factory();
    } catch (second) {
      let last = 0;
      try { last = Number(storage?.getItem(RELOAD_FLAG)) || 0; } catch { /* private mode */ }
      if (Date.now() - last > RELOAD_WINDOW_MS) {
        try { storage?.setItem(RELOAD_FLAG, String(Date.now())); } catch { /* private mode */ }
        reload();
        return new Promise(() => {});   // the page is going away; never settle
      }
      throw second;
    }
  }
}

export const lazyRetry = (factory) => lazy(() => importWithRetry(factory));
