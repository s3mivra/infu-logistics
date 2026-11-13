// The control panel is one HTML page with its script inline, so no build step
// ever parses it: a syntax error ships silently and the whole panel is dead
// ("Uncaught SyntaxError" in the browser, 2026-11). Parse every inline script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('every inline script in public/index.html parses', () => {
  const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0, 'expected an inline script');
  for (const [i, body] of scripts.entries()) {
    assert.doesNotThrow(() => new Function(body), `inline script ${i + 1} does not parse`);
  }
});
