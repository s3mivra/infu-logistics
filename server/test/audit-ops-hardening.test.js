// 2026-11 audit: production mode fails closed (M42) and the API does not serve
// requests before its database and startup migrations are ready (M45).
// These boot the real server as a child process, because both behaviours live
// in module start-up code that the in-process harness (NODE_ENV=test) skips.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// Nothing listens here, so the driver keeps trying until its 10 s selection timeout.
const UNREACHABLE_DB = 'mongodb://127.0.0.1:9/never';

const boot = (env) => {
  const childEnv = { ...process.env, ...env };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete childEnv[k];
  delete childEnv.VITEST;   // the child is a real server, not a test run
  const child = spawn(process.execPath, [SERVER], { env: childEnv, cwd: path.dirname(SERVER) });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, exited, output: () => output };
};

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('timeout'), ms))]);

describe('production mode fails closed (M42)', () => {
  it('refuses a weak config when NODE_ENV is not set at all', async () => {
    const run = boot({ NODE_ENV: undefined, MONGO_URI: UNREACHABLE_DB, JWT_SECRET: 'short', ADMIN_PASS: undefined, PORT: String(await freePort()) });
    expect(await withTimeout(run.exited, 20000)).toBe(1);
    expect(run.output()).toMatch(/NODE_ENV is not set/);
    expect(run.output()).toMatch(/JWT_SECRET must be at least 32 chars/);
  }, 30000);

  it('treats a typo such as "prod" as production too', async () => {
    const run = boot({ NODE_ENV: 'prod', MONGO_URI: UNREACHABLE_DB, JWT_SECRET: 'short', ADMIN_PASS: undefined, PORT: String(await freePort()) });
    expect(await withTimeout(run.exited, 20000)).toBe(1);
    expect(run.output()).toMatch(/Insecure production config/);
  }, 30000);
});

describe('not ready until the database and startup tasks are (M45)', () => {
  it('answers 503 "starting" with Retry-After, and /health says starting', async () => {
    const port = await freePort();
    const run = boot({ NODE_ENV: 'development', MONGO_URI: UNREACHABLE_DB, JWT_SECRET: 'dev-secret', PORT: String(port) });
    try {
      const base = `http://127.0.0.1:${port}`;
      let api;
      for (let i = 0; i < 40 && !api; i += 1) {
        try { api = await fetch(`${base}/api/products`); } catch { await new Promise((r) => setTimeout(r, 250)); }
      }
      expect(api, run.output()).toBeTruthy();
      expect(api.status).toBe(503);
      expect(api.headers.get('retry-after')).toBe('5');
      expect((await api.json()).error).toMatch(/starting/i);

      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(503);
      expect((await health.json()).startup).toBe('starting');
    } finally {
      run.child.kill();
      await withTimeout(run.exited, 5000);
    }
  }, 30000);
});
