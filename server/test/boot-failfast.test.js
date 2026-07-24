// Boot fail-fast: server.js must refuse to start (exit 1) when required env is missing.
// Spawned as a real subprocess because it's a process-level exit, not a route. We point
// DOTENV_CONFIG_PATH at a non-existent file so dotenv can't backfill MONGO_URI from .env.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('boot fail-fast (required env)', () => {
  it('exits 1 with a clear message when MONGO_URI / JWT_SECRET are missing', () => {
    let status = 0;
    let output = '';
    try {
      execFileSync(process.execPath, ['server.js'], {
        cwd: process.cwd(), // vitest runs in the server/ dir
        env: { ...process.env, MONGO_URI: '', JWT_SECRET: '', DOTENV_CONFIG_PATH: 'no-such-file.env', NODE_ENV: 'test' },
        timeout: 45000, // generous — the subprocess loads the whole module before exiting
        stdio: 'pipe',
      });
    } catch (e) {
      status = e.status ?? 1;
      output = `${e.stdout || ''}${e.stderr || ''}`;
    }
    expect(status).toBe(1);
    expect(output).toMatch(/MONGO_URI and JWT_SECRET/);
  }, 60000);
});
