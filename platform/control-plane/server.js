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
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
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
const LOGS_DIR = path.join(PLATFORM_DIR, 'caddy-logs');
const TENANT_COMPOSE = path.join(PLATFORM_DIR, 'tenant-compose.yml');

// Resource envelope per tenant. Memory is a hard cgroup ceiling; CPU shares are
// a relative weight under contention. On the 8 GB box, budget roughly:
// mongod 2 GB cache + ~1 GB overhead, Caddy + control plane + OS ~1 GB, leaving
// ~4 GB — four tenants at the 1 GB default.
const MEM_MB_DEFAULT = 1024;
const MEM_MB_MIN = 256;
const MEM_MB_MAX = 4096;
const CPU_SHARES_DEFAULT = 1024;
const CPU_SHARES_MIN = 256;
const CPU_SHARES_MAX = 4096;

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : fallback;
};

// The cgroup limit alone isn't enough: V8 sizes its heap from the HOST's total
// RAM, not the container's, so Node happily grows past mem_limit and gets
// OOM-killed instead of collecting garbage. Pinning the old-space to ~75% of the
// limit leaves room for the non-heap side (buffers, native, stack).
function resourceEnv(memMb, cpuShares) {
  return {
    MEM_LIMIT: `${memMb}m`,
    WEB_MEM_LIMIT: '128m',
    NODE_OPTIONS: `--max-old-space-size=${Math.floor(memMb * 0.75)}`,
    CPU_SHARES: String(cpuShares),
  };
}

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
const accessLogPath = (slug) => path.join(LOGS_DIR, `${slug}.log`);

function renderVhost(slug, host) {
  // The access log is what makes per-tenant bandwidth measurable at all —
  // Docker cannot attribute traffic to a container, but Caddy knows which vhost
  // served each response. roll_size bounds disk use, which means egress is
  // counted over the CURRENT file only: a busy tenant rolls sooner and its
  // window is shorter. Treat the number as a trend, not an invoice.
  const body =
    `\tlog {\n` +
    `\t\toutput file /var/log/caddy/${slug}.log {\n` +
    `\t\t\troll_size 20MiB\n` +
    `\t\t\troll_keep 3\n` +
    `\t\t}\n` +
    `\t\tformat json\n` +
    `\t}\n` +
    `\treverse_proxy ${slug}-web:80\n`;
  return LOCAL_MODE
    ? `http://${host}, http://${slug}.localhost {\n${body}}\n`
    : `${host} {\n${body}}\n`;
}

// Sums response bytes from the tenant's Caddy access log. Streamed line by line:
// these files reach 20 MiB, and four of them read into memory at once on an
// 8 GB box shared with mongod is not a trade worth making for a dashboard.
async function readEgress(slug, sinceMs) {
  let bytes = 0;
  let requests = 0;
  try {
    const rl = readline.createInterface({
      input: createReadStream(accessLogPath(slug), { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      // Caddy writes ts as float seconds.
      if (typeof e.ts === 'number' && e.ts * 1000 < sinceMs) continue;
      bytes += Number(e.size) || 0;
      requests += 1;
    }
  } catch {
    // No log file yet — a tenant that has never been hit.
  }
  return { bytes, requests };
}

// Live memory per container, from the Docker API. Returns bytes keyed by
// container name (`<slug>-api-1` under compose project `<slug>`).
async function readMemUsage() {
  const out = {};
  try {
    const raw = await docker(
      ['stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}'],
      { timeout: 30_000 },
    );
    for (const line of raw.trim().split('\n')) {
      const [name, usage, perc] = line.split('\t');
      if (!name || !usage) continue;
      out[name.trim()] = { usage: usage.trim(), perc: (perc || '').trim() };
    }
  } catch {
    // Docker busy or stats unavailable; the dashboard degrades to "—".
  }
  return out;
}

// Per-tenant database size, straight from dbStats. This is the disk number:
// MongoDB has no per-database quota, so it can be reported but not enforced.
async function readDbSizes(slugs) {
  if (!slugs.length) return {};
  const script = `
    const out = {};
    for (const slug of ${JSON.stringify(slugs)}) {
      try {
        const s = db.getSiblingDB('semivra_' + slug).stats();
        out[slug] = { dataSize: s.dataSize, storageSize: s.storageSize,
                      indexSize: s.indexSize, objects: s.objects };
      } catch (e) { out[slug] = null; }
    }
    print(JSON.stringify(out));
  `;
  try {
    const raw = await docker(
      ['exec', 'semivra-platform-mongo-1', 'mongosh', '--quiet', '--eval', script],
      { timeout: 60_000 },
    );
    const line = raw.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop() || '{}';
    return JSON.parse(line);
  } catch {
    return {};
  }
}

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
  // Every hostname the app is served on must also be an allowed origin, or
  // Socket.IO rejects the websocket handshake with a bare 400 — REST keeps
  // working, so it looks like a proxy fault rather than a CORS one. In local
  // mode that means the .localhost alias too.
  const origins = LOCAL_MODE
    ? `${scheme}://${host},http://${slug}.localhost`
    : `${scheme}://${host}`;
  const memMb = clampInt(b.memMb, MEM_MB_MIN, MEM_MB_MAX, MEM_MB_DEFAULT);
  const cpuShares = clampInt(b.cpuShares, CPU_SHARES_MIN, CPU_SHARES_MAX, CPU_SHARES_DEFAULT);

  const env = {
    TENANT: slug,
    STACK_ROOT,
    ...resourceEnv(memMb, cpuShares),
    // Each tenant gets its own database inside the one shared mongod.
    MONGO_URI: `mongodb://mongo:27017/semivra_${slug}?replicaSet=rs0`,
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_PASS: adminPass,
    ALLOWED_ORIGINS: origins,
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
    await fs.mkdir(LOGS_DIR, { recursive: true });
    await fs.writeFile(tenantEnvPath(slug), toEnvFile(env), { mode: 0o600 });
    await fs.writeFile(tenantMetaPath(slug), JSON.stringify({
      slug, businessName, businessType, host, memMb, cpuShares,
      createdAt: new Date().toISOString(),
    }, null, 2));

    // Caddy vhost. In LOCAL_MODE we bind plain http on :80 so the whole flow can
    // be rehearsed without public DNS or a real certificate, and we ALSO answer
    // on <slug>.localhost — browsers resolve anything under .localhost to
    // loopback (RFC 6761), so the rehearsal is reachable with no hosts-file edit.
    const vhost = renderVhost(slug, host);
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

// Adjust a tenant's resource envelope. Rewrites only the resource keys in its
// .env — every other value (secrets, billing, business type) is read back and
// preserved, so this can never clobber configuration.
app.patch('/api/tenants/:slug/resources', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!(await listSlugs()).includes(slug)) return res.status(404).json({ error: 'No such tenant.' });

  const memMb = clampInt(req.body?.memMb, MEM_MB_MIN, MEM_MB_MAX, MEM_MB_DEFAULT);
  const cpuShares = clampInt(req.body?.cpuShares, CPU_SHARES_MIN, CPU_SHARES_MAX, CPU_SHARES_DEFAULT);

  try {
    const current = parseEnvFile(await fs.readFile(tenantEnvPath(slug), 'utf8'));
    const next = { ...current, ...resourceEnv(memMb, cpuShares) };
    await fs.writeFile(tenantEnvPath(slug), toEnvFile(next), { mode: 0o600 });

    const meta = (await readMeta(slug)) || {};
    await fs.writeFile(tenantMetaPath(slug), JSON.stringify({
      ...meta, memMb, cpuShares, resourcesUpdatedAt: new Date().toISOString(),
    }, null, 2));

    // `up -d` (not `restart`) — a cgroup limit is set at container creation, so
    // the container must be recreated for the new value to take effect. No
    // --build: the images are unchanged, and rebuilding would be a slow surprise.
    const log = await docker([...composeArgs(slug), 'up', '-d'], { timeout: 5 * 60_000 });
    res.json({ ok: true, memMb, cpuShares, log: log.slice(-2000) });
  } catch (err) {
    res.status(500).json({ error: String(err.stderr || err.message).slice(-4000) });
  }
});

// Usage meters. Memory is a live reading against an enforced ceiling; disk and
// bandwidth are observed only — see readDbSizes and readEgress for why neither
// can be capped on this architecture.
app.get('/api/usage', requireAuth, async (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 720);
  const sinceMs = Date.now() - hours * 3600_000;
  const slugs = await listSlugs();

  try {
    const [mem, dbs, egressList] = await Promise.all([
      readMemUsage(),
      readDbSizes(slugs),
      Promise.all(slugs.map((s) => readEgress(s, sinceMs))),
    ]);

    const tenants = slugs.map((slug, i) => {
      const meta = dbs[slug];
      return {
        slug,
        memLimitMb: null, // filled from tenant.json by the caller-side merge below
        memApi: mem[`${slug}-api-1`] || null,
        memWeb: mem[`${slug}-web-1`] || null,
        dbBytes: meta ? (meta.storageSize || 0) + (meta.indexSize || 0) : null,
        dbObjects: meta ? meta.objects : null,
        egressBytes: egressList[i].bytes,
        requests: egressList[i].requests,
      };
    });

    const merged = await Promise.all(tenants.map(async (t) => {
      const m = await readMeta(t.slug);
      return { ...t, memLimitMb: m?.memMb ?? MEM_MB_DEFAULT, cpuShares: m?.cpuShares ?? CPU_SHARES_DEFAULT };
    }));

    res.json({ hours, tenants: merged });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(-2000) });
  }
});

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

// ── error analytics ──────────────────────────────────────────────────────────
// Each tenant's API writes 5xx events to a capped `errorevents` collection in
// its OWN database. We aggregate them here for a cross-client view. Queried via
// mongosh over docker exec so the control plane needs no database driver and no
// credentials of its own.
app.get('/api/errors', requireAuth, async (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 720);
  const only = String(req.query.tenant || '').trim();
  const slugs = (await listSlugs()).filter((s) => !only || s === only);

  const script = `
    const since = new Date(Date.now() - ${hours} * 3600000);
    const out = [];
    for (const slug of ${JSON.stringify(slugs)}) {
      const d = db.getSiblingDB('semivra_' + slug);
      if (!d.getCollectionNames().includes('errorevents')) continue;
      d.errorevents.aggregate([
        { $match: { at: { $gte: since } } },
        { $group: { _id: '$signature', count: { $sum: 1 },
            lastSeen: { $max: '$at' }, firstSeen: { $min: '$at' },
            method: { $first: '$method' }, route: { $first: '$route' },
            message: { $first: '$message' }, status: { $first: '$status' },
            kind: { $first: '$kind' }, stack: { $first: '$stack' } } },
        { $sort: { count: -1 } }, { $limit: 40 },
      ]).forEach(r => { r.tenant = slug; out.push(r); });
    }
    out.sort((a, b) => b.count - a.count);
    print(JSON.stringify(out.slice(0, 100)));
  `;

  try {
    const raw = await docker(['exec', 'semivra-platform-mongo-1', 'mongosh', '--quiet', '--eval', script],
      { timeout: 60_000 });
    const line = raw.trim().split('\n').filter((l) => l.trim().startsWith('[')).pop() || '[]';
    res.json({ groups: JSON.parse(line), hours, tenants: slugs });
  } catch (err) {
    res.status(500).json({ error: String(err.stderr || err.message).slice(-2000) });
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
