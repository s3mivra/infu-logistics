# KVM2 Deploy Guide — start to finish

A complete, self-contained walkthrough for putting this platform on a **fresh
Hostinger KVM2** (Ubuntu VPS) and, afterwards, **pushing new code to it from
GitHub**. Follow it top to bottom the first time.

For the per-tenant pre-launch sign-off checklist, see
[DEPLOY_4TENANT_KVM2.md](DEPLOY_4TENANT_KVM2.md). For the single-tenant runbook
concepts, see [GO_LIVE.md](GO_LIVE.md) and [DEPLOY.md](DEPLOY.md).

---

## 0. Before you touch the server — what you need ready

- **The KVM2** with Ubuntu, and **root (or sudo) SSH access** to it. Note its
  public **IP address**.
- **A domain name** you control (e.g. `yourbrand.com`).
- **A wildcard DNS record**, added at your domain registrar/DNS host:
  - Type `A`, Name `*` , Value `<KVM2 IP>` — this makes `anything.yourbrand.com`
    resolve to the box, which is how each client gets their own subdomain and
    how Caddy proves domain ownership to issue HTTPS certificates.
  - (Optional but tidy) also an `A` record for the bare `@`/root if you want
    `yourbrand.com` itself to resolve.
  - DNS can take a few minutes to a few hours to propagate. Confirm with
    `ping tenanta.yourbrand.com` returning your KVM2 IP before going further.
- **Three secrets you invent** (write them down somewhere safe — a password
  manager):
  - `CP_PASSWORD` — logs you into the control-plane panel.
  - `CP_DANGER_PASSWORD` — a *second, different* password required for
    destructive actions (wipe/delete a client).
  - Each client's **superadmin password** (you'll set these in step 6; you can
    always re-read them later with the control panel's **Password** button).
- **An email address** for Let's Encrypt (`ACME_EMAIL`) — only used for
  expiry notices.

---

## 1. Install Docker on the KVM2

SSH in (`ssh root@<KVM2 IP>`), then:

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version   # confirm both print a version
```

---

## 2. Create the shared network

Every tenant stack and the platform join one Docker network:

```bash
docker network create semivra-net
```

(If it says it already exists, that's fine.)

---

## 3. Get the code onto the box

```bash
cd /root
git clone https://github.com/s3mivra/infu-logistics.git
cd infu-logistics
git checkout platform/multi-tenant
```

> **This checkout is now the single source of truth on the box.** Never edit
> files or commit here directly — it is a *pull-only mirror* of GitHub. That
> keeps the one-click "Update all apps" flow (section 8) working, because it
> uses `git pull --ff-only`, which refuses to run if the box has diverging
> local changes.

**Private repo?** If `github.com/s3mivra/infu-logistics` is private, the
`git clone` above will prompt for credentials. Use a GitHub **Personal Access
Token** (Settings → Developer settings → Fine-grained tokens, read-only on this
repo) as the password, or set up a **deploy key**. Whichever you pick, make sure
a plain `git pull` works non-interactively on the box before relying on the
update button — see section 8's note.

---

## 4. Write the platform config

Create `/root/infu-logistics/platform/.env` with **your real values**:

```bash
cat > /root/infu-logistics/platform/.env <<'EOF'
DOMAIN=yourbrand.com
LOCAL_MODE=0
CP_PASSWORD=your-strong-control-plane-password
CP_DANGER_PASSWORD=a-different-strong-password
ACME_EMAIL=you@yourbrand.com
STACK_ROOT=/root/infu-logistics
EOF
chmod 600 /root/infu-logistics/platform/.env
```

Notes:
- **`LOCAL_MODE=0`** is what turns on real HTTPS. It's checked as *exactly* `1`
  for local laptop mode, so any other value (`0`, unset) means **production**.
- **`STACK_ROOT`** must be the absolute path of the checkout from step 3, and it
  must be identical inside and outside the container — leave it as
  `/root/infu-logistics` if that's where you cloned.
- This file holds secrets and is **gitignored** — it never goes back to GitHub.

---

## 5. Bring up the platform layer

```bash
cd /root/infu-logistics/platform
docker compose up -d --build
```

This starts three shared services:
- **caddy** — the only thing on ports 80/443; it terminates HTTPS and routes
  each subdomain to the right client. It auto-provisions Let's Encrypt
  certificates on first request to each hostname (this is why the wildcard DNS
  in step 0 must resolve first).
- **mongo** — one database engine, one database per client. It **initialises its
  own replica set automatically** (required for the app's money/transaction
  paths) — no manual step.
- **control-plane** — the management panel. It is bound to **`127.0.0.1` only**
  and is *never* exposed to the internet.

Watch them become healthy:

```bash
docker compose ps
docker compose logs -f control-plane   # Ctrl-C to stop watching
```

Wait until `mongo` shows `healthy` (up to ~40s on first boot while it initialises
the replica set).

---

## 6. Open the control panel (over an SSH tunnel)

The panel holds the Docker socket (root-equivalent), so it is only reachable
through an SSH tunnel — never a public URL. **From your own laptop**, open a new
terminal:

```bash
ssh -L 9000:localhost:9000 root@<KVM2 IP>
```

Leave that running, then in your browser go to:

```
http://localhost:9000
```

Sign in with `CP_PASSWORD`.

---

## 7. Create your clients

For each real business, on the **Clients** page → **Add a client**:

- **Subdomain** — e.g. `acme` → the client lives at `https://acme.yourbrand.com`.
- **Business name**, **Business type** (`fb` food & beverage / `log` logistics),
  **Theme**.
- **Superadmin password** — the login you hand that client's owner/manager. You
  can re-read it any time later with the row's **Password** button.
- **Test tenant** — leave **unchecked** for real paying clients. (Only check it
  for a throwaway demo/staging client; it unlocks the heavy Test Lab tools.)
- **Memory / CPU** — start at the 1 GB default; adjust later with **Resources**.
- Optional: monthly fee (shows on the **Billing** page) and billing letterhead.

Creating a client takes a few minutes (it builds that client's app image). When
it finishes, its `https://<slug>.yourbrand.com` link appears with a valid
certificate. Repeat for all 4 clients.

---

## 8. Smoke test

For **each** client, run through [GO_LIVE.md](GO_LIVE.md) §2 (login, take a
sale, check the ledger, void, etc.) and the sign-off items in
[DEPLOY_4TENANT_KVM2.md](DEPLOY_4TENANT_KVM2.md). Do it for all four, not just
the first — copy-paste config slips show up on the last one.

You're live.

---

## 9. Getting new code from GitHub after you're deployed

This is the everyday flow once the box is running. The short version:
**you push to GitHub from your machine, then click one button on the panel.**

### On your machine (the developer side)
```bash
git push origin platform/multi-tenant
```

### On the panel (the operator side)
1. Open the control panel (the SSH tunnel from step 6).
2. On the **Clients** page, click **Update all apps** (top right).
3. A window walks through it automatically:
   - **Downloading update & building** — it runs `git pull` on the box to fetch
     your new commits, then builds the new version. **No downtime** here; every
     client keeps running the old version.
   - **Applying update** — each client restarts onto the new version. This is
     the only interruption, and it's brief (about a minute total).
   - **Done** — a health line per client confirms they came back up.
4. If the build step fails, **nothing is applied** — every client keeps running
   the version it already had. Fix the issue and click it again.

That's it — no SSH needed for a normal update.

### What the button actually does
The panel runs `git -C /root/infu-logistics pull --ff-only`, rebuilds the one
shared API image plus each client's web image, then recreates the containers
onto the fresh images. `--ff-only` is why the box must stay a clean pull-only
mirror (section 3): if someone edited files on the box, the pull refuses and the
update stops before changing anything.

### Private-repo note (important)
The `git pull` above runs **inside the control-plane container**. If your GitHub
repo is **public**, this just works. If it's **private**, the container may not
have credentials, and the button's pull will fail. The simplest, credential-free
workaround:

1. SSH to the box and pull on the **host** (where your token/deploy key lives):
   ```bash
   cd /root/infu-logistics && git pull --ff-only
   ```
2. *Then* click **Update all apps**. Its internal pull is now a no-op (already
   up to date), and it proceeds straight to building and applying.

Either way, the code only ever moves **GitHub → the box**; the box never pushes.

### Updating one client's branding only
If you only changed one client's name/theme/logo (not app code), use that
client's **Rebuild web** button instead — it rebuilds just that client's
appearance and doesn't touch anyone else or pull new code.

---

## 10. Good habits

- **Back up MongoDB** regularly. The data lives in the `mongo-data` Docker
  volume; snapshot it or `mongodump` into `platform/backups` (bind-mounted).
- **Keep `platform/.env` and every `platform/tenants/<slug>/.env` safe and off
  GitHub** — they hold each client's secrets and are already gitignored. If you
  ever rebuild the box, you restore these, you don't regenerate them (that would
  orphan the databases).
- **Never open port 9000 to the internet.** Always reach the panel via the SSH
  tunnel.
- After any update, glance at the **Errors** page to confirm nothing new is
  failing across the clients.
