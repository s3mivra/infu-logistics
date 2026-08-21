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
const testlabDir = (slug) => path.join(tenantDir(slug), 'testlab-runs');

// One JSON file per Test Lab run (seed / loadtest / security-scan), newest
// first. Small-scale by design — a human reviewing recent runs, not a metrics
// pipeline — so "read every file in the directory" is the right amount of
// engineering here.
async function saveTestlabRun(slug, kind, record) {
  const dir = testlabDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const id = `${Date.now()}-${kind}`;
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ id, kind, ...record }, null, 2));
  return id;
}
async function listTestlabRuns(slug, limit = 50) {
  let files;
  try {
    files = (await fs.readdir(testlabDir(slug))).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  files.sort().reverse();
  return Promise.all(files.slice(0, limit).map(async (f) => {
    try {
      return JSON.parse(await fs.readFile(path.join(testlabDir(slug), f), 'utf8'));
    } catch {
      return null;
    }
  })).then((rows) => rows.filter(Boolean));
}

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

// The human-facing link: in LOCAL_MODE, `<slug>.<DOMAIN>` (e.g.
// tenanta.semivra.localtest) is served by Caddy (see renderVhost above) but
// does NOT auto-resolve in a browser — only a bare `*.localhost` suffix does
// that without a hosts-file edit (RFC 6761), and DOMAIN here is a fake
// `.localtest` TLD, not `.localhost`. Surface the link that actually works.
function publicUrl(slug, host) {
  return LOCAL_MODE ? `http://${slug}.localhost` : `https://${host}`;
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

// DOCKER_BUILDKIT=1 enables BuildKit for all build commands: parallel layer
// resolution, better caching, and significantly faster image builds.
const BUILD_ENV = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };

async function docker(args, { timeout = 15 * 60_000, build = false } = {}) {
  const { stdout, stderr } = await run('docker', args, {
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    ...(build ? { env: BUILD_ENV } : {}),
  });
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

// Hard gate for every /testlab/* route: those routes seed thousands of fake
// orders, hammer the tenant with load, and probe it for vulnerabilities — all
// things you never want pointed at a tenant with real customer data by
// accident. Chain this after requireAuth on every testlab route; it 404s a
// nonexistent slug and 403s anything not explicitly flagged testTenant at
// creation time (see POST /api/tenants above).
async function requireTestTenant(req, res, next) {
  const slug = req.params.slug;
  if (!(await listSlugs()).includes(slug)) return res.status(404).json({ error: 'No such tenant.' });
  const meta = await readMeta(slug);
  if (!meta?.testTenant) {
    return res.status(403).json({
      error: `"${slug}" is not a test tenant. Test Lab actions (seeding, load testing, security scanning) only run against tenants created with the test-tenant flag on, so they can never accidentally target a live client.`,
    });
  }
  req.tenantMeta = meta;
  next();
}

// This process holds the Docker socket (root-equivalent) and is meant to be
// reachable only over an SSH tunnel — safeEqual() alone has no defense-in-
// depth if that assumption is ever violated. No express-rate-limit dependency
// here (this package intentionally has none but express, see package.json);
// a small in-memory sliding window is enough for a tool one person reaches
// through a tunnel, mirrors the main app's loginLimiter (server/server.js).
const attempts = new Map(); // key -> array of attempt timestamps (ms)
function rateLimited(key, { max, windowMs }) {
  const now = Date.now();
  const hits = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  attempts.set(key, hits);
  return hits.length > max;
}
function passwordAttemptLimiter(req, res, next) {
  if (rateLimited(`pw:${req.ip}`, { max: 5, windowMs: 15 * 60 * 1000 })) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  next();
}

// ── app ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.post('/api/login', passwordAttemptLimiter, (req, res) => {
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
    url: publicUrl(slug, `${slug}.${DOMAIN}`),
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
    DOMAIN,
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
    // testTenant: marks this tenant safe for Test Lab actions (data seeding,
    // load testing, security scanning — see the testlab/* routes below). It's
    // a hard server-side gate, not a UI convenience: those routes 403 for any
    // tenant created without it, so a misclick can't seed 8,000 fake orders
    // into a real client's live database or point a load test at it.
    const testTenant = b.testTenant === true;
    await fs.writeFile(tenantMetaPath(slug), JSON.stringify({
      slug, businessName, businessType, host, memMb, cpuShares, testTenant,
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

    res.json({ ok: true, slug, url: publicUrl(slug, host), log: buildLog.slice(-4000) });
  } catch (err) {
    res.status(500).json({ error: String(err.stderr || err.message).slice(-4000) });
  }
});

// `rebuild` only builds+recreates `web` — `api` runs the SHARED semivra-api:shared
// image (see tenant-compose.yml), so rebuilding it from a single tenant's build
// context would silently move that tag for every other tenant too, outside the
// deliberate two-phase "Update all apps" flow below. A per-tenant rebuild should
// only ever touch what's actually per-tenant: the web image (branding/theme).
// To pick up a server code change, use "Update all apps".
for (const [action, args] of [['start', ['up', '-d']], ['stop', ['stop']], ['rebuild', ['up', '-d', '--build', 'web']]]) {
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

// ── UPDATE ALL APPS ───────────────────────────────────────────────────────────
// Two-phase, so the UI can show "downloading" then a brief "applying" window:
//   /prepare  — git pull (if STACK_ROOT is a git repo; else build from disk),
//               build the ONE shared API image, then each tenant's web image.
//               No downtime — running containers are untouched while this runs.
//   /apply    — recreate every tenant's containers onto the freshly built
//               images. THIS is the ~1-minute window where apps briefly restart.
// Splitting the slow build (no downtime) from the fast recreate (brief
// downtime) keeps the actual outage as short as possible.

// Is STACK_ROOT a git checkout we can pull? Local rehearsal (rsync'd, no .git)
// is not — there we skip the pull and just rebuild whatever is on disk.
async function tryGitPull() {
  try {
    await fs.access(path.join(STACK_ROOT, '.git'));
  } catch {
    return { pulled: false, reason: 'not-a-git-repo', detail: 'STACK_ROOT has no .git — building from the code currently on disk.' };
  }
  try {
    const out = await run('git', ['-C', STACK_ROOT, 'pull', '--ff-only'], { timeout: 120_000 });
    return { pulled: true, detail: ((out.stdout || '') + (out.stderr || '')).slice(-2000) };
  } catch (err) {
    // A failed pull (dirty tree, conflict, no upstream) must NOT half-update —
    // surface it and let the operator resolve it before applying anything.
    throw Object.assign(new Error(`git pull failed: ${String(err.stderr || err.message).slice(-1500)}`), { phase: 'download' });
  }
}

app.post('/api/update/prepare', requireAuth, async (req, res) => {
  const slugs = await listSlugs();
  if (slugs.length === 0) return res.status(400).json({ error: 'No tenants to update.' });
  try {
    const git = await tryGitPull();

    // Build the shared API image ONCE (any tenant's compose produces the same
    // `semivra-api:shared` tag, since it's no longer templated by TENANT).
    // BuildKit is enabled via BUILD_ENV for faster layer resolution.
    const apiLog = await docker([...composeArgs(slugs[0]), 'build', 'api'], { timeout: 20 * 60_000, build: true });

    // Build all tenant web images IN PARALLEL. Each bakes in its own
    // VITE_BUSINESS_NAME/theme, but all share the same npm-install and
    // vite-build Docker layers (already cached after the first build),
    // so running them concurrently cuts total time to ~1 build instead of N.
    const webResults = await Promise.all(
      slugs.map(async (slug) => {
        try {
          await docker([...composeArgs(slug), 'build', 'web'], { timeout: 15 * 60_000, build: true });
          return { slug, built: true };
        } catch (err) {
          return { slug, built: false, error: String(err.stderr || err.message).slice(-1000) };
        }
      }),
    );
    res.json({ ok: true, git, apiBuilt: true, web: webResults, apiLog: apiLog.slice(-1500) });
  } catch (err) {
    res.status(500).json({ phase: err.phase || 'build', error: String(err.stderr || err.message).slice(-4000) });
  }
});

app.post('/api/update/apply', requireAuth, async (req, res) => {
  const slugs = await listSlugs();
  if (slugs.length === 0) return res.status(400).json({ error: 'No tenants to update.' });
  // Recreate all tenants IN PARALLEL. `up -d` (no --build) just swaps
  // containers onto the images built in /prepare — it's fast, so running
  // them concurrently is safe and cuts the restart window significantly.
  const results = await Promise.all(
    slugs.map(async (slug) => {
      try {
        await docker([...composeArgs(slug), 'up', '-d'], { timeout: 5 * 60_000 });
        return { slug, status: await tenantStatus(slug) };
      } catch (err) {
        return { slug, error: String(err.stderr || err.message).slice(-1500) };
      }
    }),
  );
  res.json({ ok: true, tenants: results });
});

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

// ── Billing ──────────────────────────────────────────────────────────────────
// Manual, operator-marked payment tracking. This platform deliberately has no
// payment gateway integration — "paid" here means the operator confirmed
// payment through whatever channel (bank transfer, GCash, cash) actually
// happened and is recording it here, not that money moved through this
// system. meta.billing = { monthlyFee: number|null, paidMonths: ['YYYY-MM',...] }.
const currentYearMonth = () => new Date().toISOString().slice(0, 7);
const monthRe = /^\d{4}-\d{2}$/;

app.patch('/api/tenants/:slug/billing', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!(await listSlugs()).includes(slug)) return res.status(404).json({ error: 'No such tenant.' });
  try {
    const meta = (await readMeta(slug)) || {};
    const billing = meta.billing || { monthlyFee: null, paidMonths: [] };
    if (req.body?.monthlyFee !== undefined) {
      const raw = req.body.monthlyFee;
      const fee = raw === null || raw === '' ? null : Number(raw);
      if (fee !== null && (!Number.isFinite(fee) || fee < 0)) {
        return res.status(400).json({ error: 'monthlyFee must be a non-negative number.' });
      }
      billing.monthlyFee = fee;
    }
    await fs.writeFile(tenantMetaPath(slug), JSON.stringify({ ...meta, billing }, null, 2));
    res.json({ ok: true, billing });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(-2000) });
  }
});

app.post('/api/tenants/:slug/billing/mark-paid', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!(await listSlugs()).includes(slug)) return res.status(404).json({ error: 'No such tenant.' });
  try {
    const month = monthRe.test(req.body?.month || '') ? req.body.month : currentYearMonth();
    const meta = (await readMeta(slug)) || {};
    const billing = meta.billing || { monthlyFee: null, paidMonths: [] };
    billing.paidMonths = [...new Set([...(billing.paidMonths || []), month])].sort();
    await fs.writeFile(tenantMetaPath(slug), JSON.stringify({ ...meta, billing }, null, 2));
    res.json({ ok: true, billing });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(-2000) });
  }
});

app.post('/api/tenants/:slug/billing/unmark-paid', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!(await listSlugs()).includes(slug)) return res.status(404).json({ error: 'No such tenant.' });
  try {
    const month = monthRe.test(req.body?.month || '') ? req.body.month : currentYearMonth();
    const meta = (await readMeta(slug)) || {};
    const billing = meta.billing || { monthlyFee: null, paidMonths: [] };
    billing.paidMonths = (billing.paidMonths || []).filter((m) => m !== month);
    await fs.writeFile(tenantMetaPath(slug), JSON.stringify({ ...meta, billing }, null, 2));
    res.json({ ok: true, billing });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(-2000) });
  }
});

// ── Test Lab — stress/load testing and security scanning, built in ─────────
// Every route here is gated by requireTestTenant: it only ever runs against
// tenants explicitly created with the test-tenant flag on (see POST
// /api/tenants above). Results are saved as JSON under
// platform/tenants/<slug>/testlab-runs/ and listed via GET .../testlab/runs.

app.get('/api/tenants/:slug/testlab/runs', requireAuth, requireTestTenant, async (req, res) => {
  res.json({ runs: await listTestlabRuns(req.params.slug) });
});

// Wraps server/scripts/seed-load-test-data.mjs + backfill-stats.mjs — the same
// two scripts from the pre-launch load-test spec, run inside the tenant's own
// api container (its node_modules already has mongoose etc; the scripts
// aren't baked into the image, so they're docker-cp'd in first).
app.post('/api/tenants/:slug/testlab/seed', requireAuth, requireTestTenant, async (req, res) => {
  const slug = req.params.slug;
  const orders = clampInt(req.body?.orders, 100, 50000, 8000);
  const months = clampInt(req.body?.months, 1, 12, 6);
  const container = `${slug}-api-1`;
  const startedAt = new Date().toISOString();
  try {
    await docker(['cp', path.join(STACK_ROOT, 'server/scripts/seed-load-test-data.mjs'), `${container}:/app/seed-load-test-data.mjs`]);
    await docker(['cp', path.join(STACK_ROOT, 'server/scripts/backfill-stats.mjs'), `${container}:/app/backfill-stats.mjs`]);
    // The image runs as a non-root `app` user (server/Dockerfile); docker cp
    // writes as root, so the copied scripts need read permission fixed up
    // before `node` (running as `app`) can execute them.
    await docker(['exec', '-u', 'root', container, 'chmod', '644', '/app/seed-load-test-data.mjs', '/app/backfill-stats.mjs']);

    const seedLog = await docker(['exec', container, 'node', 'seed-load-test-data.mjs', `--orders=${orders}`, `--months=${months}`], { timeout: 10 * 60_000 });
    const backfillLog = await docker(['exec', container, 'node', 'backfill-stats.mjs'], { timeout: 5 * 60_000 });
    const verifyLog = await docker(['exec', container, 'node', 'backfill-stats.mjs', '--verify'], { timeout: 5 * 60_000 });
    const verified = /OK — counters match the aggregation exactly/.test(verifyLog);

    const id = await saveTestlabRun(slug, 'seed', {
      startedAt, finishedAt: new Date().toISOString(), orders, months, verified,
      seedLog: seedLog.slice(-4000), backfillLog: backfillLog.slice(-2000), verifyLog: verifyLog.slice(-2000),
    });
    res.json({ ok: true, id, verified, log: `${seedLog}\n${backfillLog}\n${verifyLog}`.slice(-6000) });
  } catch (err) {
    const msg = String(err.stderr || err.message).slice(-4000);
    await saveTestlabRun(slug, 'seed', { startedAt, finishedAt: new Date().toISOString(), orders, months, error: msg }).catch(() => {});
    res.status(500).json({ error: msg });
  }
});

// One scenario from scripts/k6/ per run, executed as a one-off grafana/k6
// container on semivra-net so it can reach the tenant's api service by its
// internal DNS alias — no Caddy hop, no k6 binary baked into this image.
// 02-concurrent-tenant-peak.js is deliberately not here: it's a multi-tenant
// scenario by nature (see its own header comment) and doesn't fit a
// single-tenant trigger — run it by hand per scripts/k6/README.md instead.
const K6_SCENARIOS = {
  baseline: '01-single-tenant-baseline.js',
  reports: '03-report-data-volume.js',
  websocket: '04-websocket-stress.js',
  soak: '05-soak-test.js',
  spike: '06-spike-test.js',
  inventory: '07-inventory-stress.js',
};
app.post('/api/tenants/:slug/testlab/loadtest', requireAuth, requireTestTenant, async (req, res) => {
  const slug = req.params.slug;
  const scenario = String(req.body?.scenario || 'baseline');
  const file = K6_SCENARIOS[scenario];
  if (!file) return res.status(400).json({ error: `Unknown scenario "${scenario}". Choose one of: ${Object.keys(K6_SCENARIOS).join(', ')}.` });

  const startedAt = new Date().toISOString();
  try {
    const env = parseEnvFile(await fs.readFile(tenantEnvPath(slug), 'utf8'));
    const resultsDir = testlabDir(slug);
    await fs.mkdir(resultsDir, { recursive: true });
    // This process runs as root (control-plane's own Dockerfile has no USER
    // directive), so directories it creates on the STACK_ROOT bind mount are
    // root-owned — but the official grafana/k6 image runs as a non-root user,
    // and needs write access here for --summary-export.
    await fs.chmod(resultsDir, 0o777);
    const runId = `${Date.now()}-loadtest-${scenario}`;
    const summaryFile = `${runId}.summary.json`;

    const args = [
      'run', '--rm', '--network', 'semivra-net',
      '-v', `${path.join(STACK_ROOT, 'scripts/k6')}:/scripts:ro`,
      '-v', `${resultsDir}:/results`,
      '-e', `BASE_URL=http://${slug}-api:5002`,
      '-e', `WS_URL=ws://${slug}-api:5002`,
      // The tenant's own seeded superadmin (server.js seeds 'Super Admin' from
      // ADMIN_PASS on first boot) — Test Lab already knows this credential
      // since it created the tenant, so the operator never has to supply it.
      '-e', 'STAFF_NAME=Super Admin',
      '-e', `STAFF_PASSWORD=${env.ADMIN_PASS || ''}`,
      ...(scenario === 'soak' ? ['-e', 'DURATION=2m', '-e', 'VUS=10'] : []),
      'grafana/k6:latest',
      'run', `/scripts/${file}`,
      `--summary-export=/results/${summaryFile}`,
    ];

    // k6 exits non-zero both when a scenario's own thresholds fail (a real,
    // reportable result — the load test RAN, it just didn't pass) and when it
    // genuinely couldn't run at all (bad script, unreachable target). Only the
    // second case is an actual route failure, so always try to read the
    // summary afterward instead of treating a non-zero exit as fatal.
    let output = '';
    let execFailed = false;
    try {
      output = await docker(args, { timeout: 20 * 60_000 });
    } catch (err) {
      execFailed = true;
      output = (err.stdout || '') + (err.stderr || '') || String(err.message || '');
    }

    let summary = null;
    try { summary = JSON.parse(await fs.readFile(path.join(resultsDir, summaryFile), 'utf8')); } catch { /* k6 didn't get far enough to write one */ }

    if (!summary && execFailed) {
      const msg = output.slice(-4000) || 'k6 run failed with no output captured.';
      await saveTestlabRun(slug, 'loadtest', { startedAt, finishedAt: new Date().toISOString(), scenario, error: msg }).catch(() => {});
      return res.status(500).json({ error: msg });
    }

    // Getting this from the --summary-export JSON's metrics.<name>.thresholds
    // field turned out wrong twice (tried {ok:bool}, then a plain bool — the
    // real meaning of that field is still unclear and unreliable). k6's own
    // CLI text summary is unambiguous: a ✓ or ✗ per threshold under the
    // "THRESHOLDS" section, matching exactly what k6 itself considers
    // pass/fail. Parse that instead of guessing at the JSON schema again.
    const thresholdsPassed = output.includes('THRESHOLDS') ? !output.includes('✗') : null;
    const id = await saveTestlabRun(slug, 'loadtest', {
      startedAt, finishedAt: new Date().toISOString(), scenario, summary, thresholdsPassed, output: output.slice(-8000),
    });
    res.json({ ok: true, id, scenario, summary, thresholdsPassed, log: output.slice(-4000) });
  } catch (err) {
    const msg = String(err.stderr || err.message).slice(-4000);
    await saveTestlabRun(slug, 'loadtest', { startedAt, finishedAt: new Date().toISOString(), scenario, error: msg }).catch(() => {});
    res.status(500).json({ error: msg });
  }
});

// Three checks: (1) rate limiting actually returns 429s under a burst, not a
// crash or an unlimited pass-through; (2) another test tenant's JWT is
// rejected here (the real cross-tenant boundary — see SECURITY_REVIEW.md:
// app-level tenant scoping is a documented no-op, isolation is per-tenant
// JWT_SECRET + separate DB + Caddy vhost); (3) an OWASP ZAP baseline scan,
// opt-in only — it pulls a ~1.5GB image on first run and takes several
// minutes, too heavy to run by default on every click.
app.post('/api/tenants/:slug/testlab/security-scan', requireAuth, requireTestTenant, async (req, res) => {
  const slug = req.params.slug;
  const runZap = req.body?.runZap === true;
  const startedAt = new Date().toISOString();
  const findings = [];

  try {
    // (1) Rate limiting — burst 20 login attempts with a wrong password and
    // confirm the app degrades to 429s rather than accepting unlimited tries.
    const loginUrl = `http://${slug}-api:5002/api/users/login`;
    const rateLimitProbe = await docker([
      'run', '--rm', '--network', 'semivra-net', 'curlimages/curl:latest', 'sh', '-c',
      `for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\\n" -X POST "${loginUrl}" -H "Content-Type: application/json" -d '{"name":"Super Admin","password":"wrong"}'; done`,
    ], { timeout: 60_000 });
    const codes = rateLimitProbe.trim().split('\n').filter(Boolean);
    const got429 = codes.includes('429');
    findings.push({
      check: 'rate-limit', severity: got429 ? 'pass' : 'high',
      detail: got429
        ? `Login endpoint returned 429 after repeated failures (codes seen: ${[...new Set(codes)].join(', ')}).`
        : `No 429 seen across 20 rapid attempts (codes: ${[...new Set(codes)].join(', ')}) — loginLimiter may not be active for this tenant.`,
    });

    // (2) Cross-tenant isolation — only meaningful with a second test tenant.
    const allSlugs = await listSlugs();
    const otherTestSlug = (await Promise.all(allSlugs.filter((s) => s !== slug).map(async (s) => ({ s, meta: await readMeta(s) }))))
      .find((x) => x.meta?.testTenant)?.s;
    if (otherTestSlug) {
      const env = parseEnvFile(await fs.readFile(tenantEnvPath(slug), 'utf8'));
      // ADMIN_PASS is passed in via -e and read with $ADMIN_PASS inside the
      // container's shell, never string-interpolated into the command itself —
      // a password containing a quote must not be able to break out of the
      // curl -d payload and inject shell commands.
      const loginResp = await docker([
        'run', '--rm', '--network', 'semivra-net', '-e', `ADMIN_PASS=${env.ADMIN_PASS || ''}`,
        'curlimages/curl:latest', 'sh', '-c',
        `curl -s -X POST "http://${slug}-api:5002/api/users/login" -H "Content-Type: application/json" -d "{\\"name\\":\\"Super Admin\\",\\"password\\":\\"$ADMIN_PASS\\"}"`,
      ], { timeout: 30_000 });
      const tokenMatch = loginResp.match(/"token":"([^"]+)"/);
      if (tokenMatch) {
        const crossResp = await docker([
          'run', '--rm', '--network', 'semivra-net', 'curlimages/curl:latest', 'sh', '-c',
          `curl -s -o /dev/null -w "%{http_code}" "http://${otherTestSlug}-api:5002/api/analytics/dashboard" -H "Authorization: Bearer ${tokenMatch[1]}"`,
        ], { timeout: 30_000 });
        const rejected = crossResp.trim() === '401' || crossResp.trim() === '403';
        findings.push({
          check: 'cross-tenant-isolation', severity: rejected ? 'pass' : 'critical',
          detail: rejected
            ? `"${slug}"'s token was correctly rejected (HTTP ${crossResp.trim()}) against "${otherTestSlug}" — different JWT_SECRET per tenant is enforcing the boundary.`
            : `"${slug}"'s token got HTTP ${crossResp.trim()} against "${otherTestSlug}" — expected 401/403. Cross-tenant isolation may be broken.`,
        });
      } else {
        findings.push({ check: 'cross-tenant-isolation', severity: 'skipped', detail: 'Could not log in to obtain a token to test with.' });
      }
    } else {
      findings.push({ check: 'cross-tenant-isolation', severity: 'skipped', detail: 'Needs a second test tenant to check against — create one more with the test-tenant flag on.' });
    }

    // (3) OWASP ZAP baseline scan — opt-in, slow.
    let zapSummary = null;
    if (runZap) {
      const resultsDir = testlabDir(slug);
      await fs.mkdir(resultsDir, { recursive: true });
      const zapRunId = `${Date.now()}-zap`;
      try {
        await docker([
          'run', '--rm', '--network', 'semivra-net',
          '-v', `${resultsDir}:/zap/wrk:rw`,
          'owasp/zap2docker-stable', 'zap-baseline.py',
          '-t', `http://${slug}-api:5002`,
          '-J', `${zapRunId}.json`,
        ], { timeout: 15 * 60_000 });
      } catch (zapErr) {
        // zap-baseline.py exits non-zero when it finds ANY alert (even Low) —
        // that is not a tooling failure, so don't let it fail the whole scan.
        findings.push({ check: 'zap-baseline', severity: 'info', detail: `ZAP exited non-zero (this is normal when it finds alerts): ${String(zapErr.message).slice(-500)}` });
      }
      try {
        zapSummary = JSON.parse(await fs.readFile(path.join(resultsDir, `${zapRunId}.json`), 'utf8'));
        const bySeverity = {};
        for (const site of zapSummary.site || []) {
          for (const alert of site.alerts || []) {
            bySeverity[alert.riskdesc] = (bySeverity[alert.riskdesc] || 0) + 1;
          }
        }
        findings.push({ check: 'zap-baseline', severity: 'info', detail: `ZAP baseline complete: ${JSON.stringify(bySeverity)}` });
      } catch {
        findings.push({ check: 'zap-baseline', severity: 'skipped', detail: 'ZAP report not found — the scan likely failed to start (check the image pulled successfully).' });
      }
    } else {
      findings.push({ check: 'zap-baseline', severity: 'skipped', detail: 'Not requested (runZap=false). Opt in for a full OWASP Top 10 baseline scan — slow, pulls a large image on first run.' });
    }

    const id = await saveTestlabRun(slug, 'security-scan', {
      startedAt, finishedAt: new Date().toISOString(), findings, zapSummary,
    });
    res.json({ ok: true, id, findings });
  } catch (err) {
    const msg = String(err.stderr || err.message).slice(-4000);
    await saveTestlabRun(slug, 'security-scan', { startedAt, finishedAt: new Date().toISOString(), findings, error: msg }).catch(() => {});
    res.status(500).json({ error: msg });
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
  // ?tail=N lets the UI page through more history than the 200-line default —
  // still a single `docker logs --tail` call, just for a bigger N, since that's
  // the simplest cursor Docker actually exposes.
  const tail = clampInt(req.query.tail, 50, 5000, 200);
  try {
    const log = await docker([...composeArgs(slug), 'logs', '--tail', String(tail)], { timeout: 60_000 });
    res.json({ log, tail });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// Reveal a tenant's superadmin password. It was set by the operator at creation
// and lives in the tenant's .env (ADMIN_PASS) — this hands it back so it can be
// re-shared with the client without resetting anything. Only reachable through
// the same SSH-tunnel'd, password-gated control plane as everything else here.
app.get('/api/tenants/:slug/admin-password', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!(await listSlugs()).includes(slug)) return res.status(404).json({ error: 'No such tenant.' });
  try {
    const env = parseEnvFile(await fs.readFile(tenantEnvPath(slug), 'utf8'));
    res.json({ slug, adminPass: env.ADMIN_PASS || '' });
  } catch (err) {
    res.status(500).json({ error: String(err.message).slice(-2000) });
  }
});

// Destructive: drops the tenant's DATABASE and re-seeds its superadmin.
// .env is never read or written here, so business config survives by construction.
app.post('/api/tenants/:slug/wipe', requireAuth, passwordAttemptLimiter, async (req, res) => {
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

app.delete('/api/tenants/:slug', requireAuth, passwordAttemptLimiter, async (req, res) => {
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
