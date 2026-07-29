// Semivra control plane — provisions one app stack per client on a single VPS.
//
// SECURITY: this process holds the Docker socket, which is root-equivalent on
// the host. It binds to 127.0.0.1 in platform/docker-compose.yml and is meant to
// be reached over an SSH tunnel:
//     ssh -L 9000:localhost:9000 root@<vps>
// Never publish it on a public interface, even behind a login form.

import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 9000);
const DOMAIN = process.env.DOMAIN || 'example.com';
const STACK_ROOT = process.env.STACK_ROOT || '/opt/semivra';
const LOCAL_MODE = process.env.LOCAL_MODE === '1';
const CP_PASSWORD = process.env.CP_PASSWORD || '';
const CP_DANGER_PASSWORD = process.env.CP_DANGER_PASSWORD || '';

const PLATFORM_DIR = path.join(STACK_ROOT, 'platform');
const TENANTS_DIR = path.join(PLATFORM_DIR, 'tenants');
const CADDY_DIR = path.join(PLATFORM_DIR, 'tenants-caddy');
const TENANT_COMPOSE = path.join(PLATFORM_DIR, 'tenant-compose.yml');

if (!CP_PASSWORD || !CP_DANGER_PASSWORD) {
  console.error('CP_PASSWORD and CP_DANGER_PASSWORD must be set — refusing to start.');
  process.exit(1);
}
if (CP_PASSWORD === CP_DANGER_PASSWORD) {
  // The whole point of the second password is that knowing the first one isn't
  // enough to wipe a client's data.
  console.error('CP_PASSWORD and CP_DANGER_PASSWORD must differ — refusing to start.');
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Subdomains are DNS labels and also become docker compose project names, so the
// character set is the intersection of what both allow.
const SLUG_RE = /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/;
const RESERVED = new Set([
  'www', 'api', 'admin', 'app', 'mail', 'ftp', 'ns1', 'ns2', 'smtp', 'webmail',
  'control', 'platform', 'mongo', 'caddy', 'static', 'assets', 'cdn', 'test',
]);

function validateSlug(slug) {
  if (!SLUG_RE.test(slug)) {
    return 'Use 3-30 chars: lowercase letters, digits and dashes, starting with a letter.';
  }
  if (RESERVED.has(slug)) return `"${slug}" is reserved.`;
  return null;
}

// Writes KEY=value lines. Values are NOT quoted because docker compose's
// --env-file parser treats quotes literally in some versions; instead we reject
// newlines, which are the only character that could forge a second variable.
function toEnvFile(obj) {
  return Object.entries(obj)
    .map(([k, v]) => {
      const s = v === undefined || v === null ? '' : String(v);
      if (/[\r\n]/.test(s)) throw new Error(`Value for ${k} may not contain newlines.`);
      return `${k}=${s}`;
    })
    .join('\n') + '\n';
}

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

const tenantDir = (slug) => path.join(TENANTS_DIR, slug);
const tenantEnvPath = (slug) => path.join(tenantDir(slug), '.env');
const tenantMetaPath = (slug) => path.join(tenantDir(slug), 'tenant.json');
const caddyPath = (slug) => path.join(CADDY_DIR, `${slug}.caddy`);

async function listSlugs() {
  try {
    const entries = await fs.readdir(TENANTS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

async function readMeta(slug) {
  try {
    return JSON.parse(await fs.readFile(tenantMetaPath(slug), 'utf8'));
  } catch {
    return null;
  }
}

// docker compose for one tenant. --env-file supplies every ${...} in
// tenant-compose.yml, including STACK_ROOT and TENANT.
function composeArgs(slug) {
  return ['compose', '-p', slug, '--env-file', tenantEnvPath(slug), '-f', TENANT_COMPOSE];
}

async function docker(args, { timeout = 15 * 60_000 } = {}) {
  const { stdout, stderr } = await run('docker', args, { timeout, maxBuffer: 32 * 1024 * 1024 });
  return (stdout || '') + (stderr || '');
}

async function tenantStatus(slug) {
  try {
    const out = await docker([...composeArgs(slug), 'ps', '--format', 'json'], { timeout: 30_000 });
    const rows = out.trim().split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    const svc = (n) => rows.find((r) => r.Service === n);
    const state = (r) => (r ? (r.Health || r.State || 'unknown') : 'stopped');
    return { api: state(svc('api')), web: state(svc('web')) };
  } catch {
    return { api: 'stopped', web: 'stopped' };
  }
}

// ── auth ─────────────────────────────────────────────────────────────────────
// Tokens live in memory: a restart forces re-login, which is fine for a tool one
// person reaches through an SSH tunnel.
const sessions = new Map();
const TOKEN_TTL = 8 * 60 * 60 * 1000;

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

function requireAuth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Not signed in.' });
  }
  next();
}

// ── app ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.post('/api/login', (req, res) => {
  if (!safeEqual(req.body?.password || '', CP_PASSWORD)) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + TOKEN_TTL);
  res.json({ token, domain: DOMAIN, localMode: LOCAL_MODE });
});

app.get('/api/tenants', requireAuth, async (_req, res) => {
  const slugs = await listSlugs();
  const tenants = await Promise.all(slugs.map(async (slug) => ({
    slug,
    ...(await readMeta(slug)),
    url: `${LOCAL_MODE ? 'http' : 'https'}://${slug}.${DOMAIN}`,
    status: await tenantStatus(slug),
  })));
  res.json({ tenants });
});

app.post('/api/tenants', requireAuth, async (req, res) => {
  const b = req.body || {};
  const slug = String(b.slug || '').trim().toLowerCase();

  const slugErr = validateSlug(slug);
  if (slugErr) return res.status(400).json({ error: slugErr });
  if ((await listSlugs()).includes(slug)) {
    return res.status(409).json({ error: `Tenant "${slug}" already exists.` });
  }

  const businessType = b.businessType === 'fb' ? 'fb' : 'log';
  const businessName = String(b.businessName || '').trim();
  const adminPass = String(b.adminPass || '');
  if (!businessName) return res.status(400).json({ error: 'Business name is required.' });
  if (adminPass.length < 12) {
    return res.status(400).json({ error: 'Superadmin password must be at least 12 characters.' });
  }

  const host = `${slug}.${DOMAIN}`;
  const scheme = LOCAL_MODE ? 'http' : 'https';
  const env = {
    TENANT: slug,
    STACK_ROOT,
    // Each tenant gets its own database inside the one shared mongod.
    MONGO_URI: `mongodb://mongo:27017/semivra_${slug}?replicaSet=rs0`,
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_PASS: adminPass,
    ALLOWED_ORIGINS: `${scheme}://${host}`,
    LOG_LEVEL: 'info',
    VITE_BUSINESS_TYPE: businessType,
    VITE_BUSINESS_NAME: businessName,
    VITE_FRONTEND_URL: `${scheme}://${host}`,
    VITE_THEME: String(b.theme || 'default'),
    VITE_FB_LINK: String(b.fbLink || ''),
    VITE_BILLING_NAME: String(b.billingName || businessName),
    VITE_BILLING_ADDRESS1: String(b.billingAddress1 || ''),
    VITE_BILLING_ADDRESS2: String(b.billingAddress2 || ''),
    VITE_BILLING_PHONE: String(b.billingPhone || ''),
    VITE_BILLING_EMAIL: String(b.billingEmail || ''),
    VITE_BILLING_BANK: String(b.billingBank || ''),
    VITE_BILLING_ACCOUNT_NAME: String(b.billingAccountName || ''),
    VITE_BILLING_ACCOUNT_NO: String(b.billingAccountNo || ''),
  };

  try {
    await fs.mkdir(tenantDir(slug), { recursive: true });
    await fs.mkdir(CADDY_DIR, { recursive: true });
    await fs.writeFile(tenantEnvPath(slug), toEnvFile(env), { mode: 0o600 });
    await fs.writeFile(tenantMetaPath(slug), JSON.stringify({
      slug, businessName, businessType, host, createdAt: new Date().toISOString(),
    }, null, 2));

    // Caddy vhost. In LOCAL_MODE we bind plain http on :80 so the whole flow can
    // be rehearsed without public DNS or a real certificate.
    const vhost = LOCAL_MODE
      ? `http://${host} {\n\treverse_proxy ${slug}-web:80\n}\n`
      : `${host} {\n\treverse_proxy ${slug}-web:80\n}\n`;
    await fs.writeFile(caddyPath(slug), vhost);

    const buildLog = await docker([...composeArgs(slug), 'up', '-d', '--build']);
    await docker(['exec', 'semivra-platform-caddy-1', 'caddy', 'reload',
      '--config', '/etc/caddy/Caddyfile'], { timeout: 60_000 });

    res.json({ ok: true, slug, url: `${scheme}://${host}`, log: buildLog.slice(-4000) });
  } catch (err) {
    res.status(500).json({ error: String(err.stderr || err.message).slice(-4000) });
  }
});

for (const [action, args] of [['start', ['up', '-d']], ['stop', ['stop']], ['rebuild', ['up', '-d', '--build']]]) {
  app.post(`/api/tenants/:slug/${action}`, requireAuth, async (req, res) => {
    const slug = req.params.slug;
    if (!(await listSlugs()).includes(slug)) return res.status(404).json({ error: 'No such tenant.' });
    try {
      const log = await docker([...composeArgs(slug), ...args]);
      res.json({ ok: true, log: log.slice(-4000) });
    } catch (err) {
      res.status(500).json({ error: String(err.stderr || err.message).slice(-4000) });
    }
  });
}

app.get('/api/tenants/:slug/logs', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!(await listSlugs()).includes(slug)) return res.status(404).json({ error: 'No such tenant.' });
  try {
    const log = await docker([...composeArgs(slug), 'logs', '--tail', '200'], { timeout: 60_000 });
    res.json({ log });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// Destructive: drops the tenant's DATABASE and re-seeds its superadmin.
// .env is never read or written here, so business config survives by construction.
app.post('/api/tenants/:slug/wipe', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!(await listSlugs()).includes(slug)) return res.status(404).json({ error: 'No such tenant.' });
  if (!safeEqual(req.body?.dangerPassword || '', CP_DANGER_PASSWORD)) {
    return res.status(403).json({ error: 'Second password is wrong.' });
  }
  if (req.body?.confirmSlug !== slug) {
    return res.status(400).json({ error: `Type "${slug}" to confirm.` });
  }
  try {
    await docker(['exec', 'semivra-platform-mongo-1', 'mongosh', '--quiet', '--eval',
      `db.getSiblingDB(${JSON.stringify(`semivra_${slug}`)}).dropDatabase()`], { timeout: 120_000 });
    // The API seeds the superadmin from ADMIN_PASS on boot when no user exists,
    // so a restart is what makes the tenant usable again.
    await docker([...composeArgs(slug), 'restart', 'api'], { timeout: 180_000 });
    res.json({ ok: true, message: `Database semivra_${slug} dropped and superadmin re-seeded.` });
  } catch (err) {
    res.status(500).json({ error: String(err.stderr || err.message).slice(-4000) });
  }
});

app.delete('/api/tenants/:slug', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!(await listSlugs()).includes(slug)) return res.status(404).json({ error: 'No such tenant.' });
  if (!safeEqual(req.get('x-danger-password') || '', CP_DANGER_PASSWORD)) {
    return res.status(403).json({ error: 'Second password is wrong.' });
  }
  if (req.get('x-confirm-slug') !== slug) return res.status(400).json({ error: `Type "${slug}" to confirm.` });
  try {
    await docker([...composeArgs(slug), 'down', '-v'], { timeout: 180_000 });
    await docker(['exec', 'semivra-platform-mongo-1', 'mongosh', '--quiet', '--eval',
      `db.getSiblingDB(${JSON.stringify(`semivra_${slug}`)}).dropDatabase()`], { timeout: 120_000 });
    await fs.rm(caddyPath(slug), { force: true });
    await fs.rm(tenantDir(slug), { recursive: true, force: true });
    await docker(['exec', 'semivra-platform-caddy-1', 'caddy', 'reload',
      '--config', '/etc/caddy/Caddyfile'], { timeout: 60_000 });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.stderr || err.message).slice(-4000) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[control-plane] listening on ${PORT} · domain=${DOMAIN} · localMode=${LOCAL_MODE}`);
  console.log(`[control-plane] stack root: ${STACK_ROOT}`);
});
