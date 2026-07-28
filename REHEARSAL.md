# Semivra POS — Local VPS Rehearsal Runbook

Rehearse the full production deployment on your own PC **before** paying for a VPS,
so day-1 on the real box is a replay of something that already worked.

Target being simulated: **Hostinger KVM 2** — 2 vCPU, 8 GB RAM, 100 GB NVMe, Ubuntu 24.04.
If your provider differs, only the two numbers in Step 2 change.

Allow ~60 minutes for the first pass, ~10 minutes for every pass after that.

---

## ⚠️ Read this first

Your `server/.env` points at the **LIVE Atlas database**. If you copy it into the
rehearsal, every test order, product, and journal entry lands in production.

**The rehearsal must use its own database.** Step 5 sets up a throwaway MongoDB
container for exactly this reason. Never shortcut it by reusing the live `MONGO_URI`.

---

## What this catches (and what it doesn't)

| Catches | Does NOT catch |
|---|---|
| Linux case-sensitive filenames | `ufw` / firewall rules |
| Missing files in Docker images | TLS / certificate issues |
| Missing build-time `VITE_*` vars | DNS propagation |
| Container boot crashes | SSH hardening |
| Behaviour under 2 vCPU / 8 GB | Real network latency to Atlas |
| Compose wiring + healthchecks | Provider-specific disk/IO limits |

For the right-hand column you need a real Ubuntu VM (Hyper-V or Multipass) rather
than WSL2 — see [Appendix B](#appendix-b--higher-fidelity-vm-optional).

---

## Step 0 — Pre-flight

Run in **PowerShell** on Windows:

```bash
wsl -l -v
```

Expect `Ubuntu` at `VERSION 2`. Then:

```bash
docker compose version
```

Expect `v2.x`. If Docker Desktop isn't running, start it from the Start menu and
wait for the whale icon to go steady.

In Docker Desktop → **Settings → Resources → WSL Integration**, confirm the
`Ubuntu` distro toggle is **on**. Without it, `docker` won't exist inside Ubuntu.

| # | Check | Done |
|---|-------|------|
| 1 | WSL2 `Ubuntu` distro present | ☐ |
| 2 | Docker Desktop running | ☐ |
| 3 | WSL integration enabled for `Ubuntu` | ☐ |
| 4 | ≥ 15 GB free on `C:` | ☐ |

---

## Step 1 — Free up disk if needed

You have ~27 GB free. The rehearsal needs about 8–10 GB (base images, two built
images, a Mongo volume). If you're tighter than 15 GB, reclaim some first:

```bash
docker system prune -a --volumes
```

> Deletes all unused images, containers and volumes. Safe here — everything in
> this runbook is rebuilt from source. Do not run it while other projects have
> containers you care about.

---

## Step 2 — Cap WSL2 to KVM 2's shape

This is what makes it a *simulation* rather than just "running it on Linux".
Create `C:\Users\Invic2s\.wslconfig` (Notepad is fine):

```ini
[wsl2]
processors=2
memory=8GB
swap=2GB
```

Apply it — this shuts down every distro **and** Docker Desktop's engine:

```bash
wsl --shutdown
```

Restart Docker Desktop, then verify from inside Ubuntu:

```bash
nproc && free -h
```

Expect `2` and roughly `7.7Gi` total. **If you see 12 and 16 GB, the cap didn't
take** — check the file is at `C:\Users\Invic2s\.wslconfig` exactly (not
`.wslconfig.txt`; Notepad appends `.txt` unless you quote the filename).

> Remove or comment out `.wslconfig` when you go back to normal development —
> two cores makes everyday work noticeably slower.

---

## Step 3 — Fix the three deploy blockers

These are real defects in the current Docker setup. On a fresh VPS all three fire
on the first `make deploy`. Fix them before rehearsing, or you'll just be
rehearsing the failures.

### 3a. API container is missing `features/`

`server/Dockerfile` never copies the `features/` directory, but `server.js`
imports 18 modules from it. The container crashes on boot with
`ERR_MODULE_NOT_FOUND`.

In `server/Dockerfile`, after the `COPY lib ./lib` line, add:

```dockerfile
COPY features ./features
```

### 3b. Client is built with no `VITE_*` vars

`.dockerignore` excludes `**/.env*` and Compose passes no build args, so Vite
bakes in its fallbacks: `VITE_API_URL` becomes the hardcoded
`http://192.168.100.2:5002` and `VITE_BUSINESS_TYPE` becomes `fb` when you run
`log`. Your own `ModeMismatchBanner` will throw a red banner across the app.

In `client/Dockerfile`, add the ARG/ENV block **above** `RUN npm run build`:

```dockerfile
ARG VITE_API_URL
ARG VITE_BUSINESS_TYPE
ARG VITE_BUSINESS_NAME
ARG VITE_FRONTEND_URL
ARG VITE_THEME
ARG VITE_FB_LINK
ARG VITE_BILLING_NAME
ARG VITE_BILLING_ADDRESS1
ARG VITE_BILLING_ADDRESS2
ARG VITE_BILLING_PHONE
ARG VITE_BILLING_EMAIL
ARG VITE_BILLING_BANK
ARG VITE_BILLING_ACCOUNT_NAME
ARG VITE_BILLING_ACCOUNT_NO
ENV VITE_API_URL=$VITE_API_URL \
    VITE_BUSINESS_TYPE=$VITE_BUSINESS_TYPE \
    VITE_BUSINESS_NAME=$VITE_BUSINESS_NAME \
    VITE_FRONTEND_URL=$VITE_FRONTEND_URL \
    VITE_THEME=$VITE_THEME \
    VITE_FB_LINK=$VITE_FB_LINK \
    VITE_BILLING_NAME=$VITE_BILLING_NAME \
    VITE_BILLING_ADDRESS1=$VITE_BILLING_ADDRESS1 \
    VITE_BILLING_ADDRESS2=$VITE_BILLING_ADDRESS2 \
    VITE_BILLING_PHONE=$VITE_BILLING_PHONE \
    VITE_BILLING_EMAIL=$VITE_BILLING_EMAIL \
    VITE_BILLING_BANK=$VITE_BILLING_BANK \
    VITE_BILLING_ACCOUNT_NAME=$VITE_BILLING_ACCOUNT_NAME \
    VITE_BILLING_ACCOUNT_NO=$VITE_BILLING_ACCOUNT_NO
RUN npm run build
```

Then in `docker-compose.yml`, change the `web` service's `build:` to pass them:

```yaml
  web:
    build:
      context: ./client
      args:
        VITE_API_URL: ${VITE_API_URL}
        VITE_BUSINESS_TYPE: ${VITE_BUSINESS_TYPE}
        VITE_BUSINESS_NAME: ${VITE_BUSINESS_NAME}
        VITE_FRONTEND_URL: ${VITE_FRONTEND_URL}
        VITE_THEME: ${VITE_THEME}
        VITE_FB_LINK: ${VITE_FB_LINK}
        VITE_BILLING_NAME: ${VITE_BILLING_NAME}
        VITE_BILLING_ADDRESS1: ${VITE_BILLING_ADDRESS1}
        VITE_BILLING_ADDRESS2: ${VITE_BILLING_ADDRESS2}
        VITE_BILLING_PHONE: ${VITE_BILLING_PHONE}
        VITE_BILLING_EMAIL: ${VITE_BILLING_EMAIL}
        VITE_BILLING_BANK: ${VITE_BILLING_BANK}
        VITE_BILLING_ACCOUNT_NAME: ${VITE_BILLING_ACCOUNT_NAME}
        VITE_BILLING_ACCOUNT_NO: ${VITE_BILLING_ACCOUNT_NO}
```

Compose reads `${...}` from the **repo-root `.env`**, which is where you'll put
these in Step 5.

### 3c. No `/api` proxy in nginx *(decide before the real deploy)*

`client/nginx.conf` serves the SPA on `:80` but doesn't proxy the API, so browsers
talk cross-origin to `:5002` and you must keep that port publicly open and keep
`ALLOWED_ORIGINS` exactly right. Since you use websockets, proxying is cleaner:

```nginx
  location /api/ {
    proxy_pass http://api:5002;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /socket.io/ {
    proxy_pass http://api:5002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
```

With this in place you set `VITE_API_URL=` (empty) so the client uses same-origin
paths, drop the `ports:` mapping on `api` so `:5002` is never public, and CORS
stops mattering entirely.

**This one is a design change, not just a bug fix.** Rehearse it deliberately —
it's the difference between users seeing `yourdomain.com` and `yourdomain.com:5002`.

---

## Step 4 — Clean-room clone

Do **not** rehearse against your working directory — it has `node_modules`,
`dist/`, and a live `.env` that would mask exactly the problems you're hunting.

Open Ubuntu (`wsl -d Ubuntu`) and clone into the **Linux** filesystem:

```bash
mkdir -p ~/rehearsal && cd ~/rehearsal
git clone /mnt/c/Users/Invic2s/Documents/My-Repo-Projects/business\ shit/first_projects/semivra\ libellus\ logistics\ type semivra
cd semivra
```

> Cloning from your local repo picks up committed code only — the same thing the
> VPS would get from GitHub. Uncommitted work will **not** appear; commit first if
> you want it included.
>
> Never work under `/mnt/c/...` — that's the Windows filesystem with Windows
> semantics, which defeats the case-sensitivity check.

Confirm you're on real Linux with a case-sensitive filesystem:

```bash
touch A a && ls A a && rm A a
```

Two separate files means you're in the right place.

---

## Step 5 — Environment + a throwaway database

### 5a. Server secrets

```bash
make setup
```

**Record the `ADMIN_PASS` it prints** — it's the only way to log in the first time.

### 5b. Point at a disposable Mongo, not production

The app uses multi-document transactions, so a standalone `mongod` will fail every
money path. You need a single-node **replica set**. Create
`docker-compose.rehearsal.yml` in the repo root:

```yaml
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]
    volumes:
      - rehearsal-mongo:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "try { rs.status().ok } catch (e) { rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]}).ok }"]
      interval: 5s
      start_period: 20s
      retries: 20

  api:
    depends_on:
      mongo:
        condition: service_healthy

volumes:
  rehearsal-mongo:
```

Now edit `server/.env` and set:

```bash
MONGO_URI=mongodb://mongo:27017/semivra_rehearsal?replicaSet=rs0
```

Double-check it does **not** contain `mongodb+srv://` — that would be Atlas:

```bash
grep MONGO_URI server/.env
```

### 5c. Client build vars (repo-root `.env`)

Create `.env` in the repo root — this feeds the Compose `${...}` substitutions:

```bash
# consumed at BUILD time and baked into the client bundle
VITE_API_URL=http://localhost:5002
VITE_BUSINESS_TYPE=log
VITE_BUSINESS_NAME=Infusions
VITE_FRONTEND_URL=http://localhost
VITE_THEME=default
VITE_FB_LINK=
VITE_BILLING_NAME=INFUSIONS CAFE & TRADING
VITE_BILLING_ADDRESS1=THE HOOD, STO. ROSARIO ST.
VITE_BILLING_ADDRESS2=BRGY. STO DOMINGO, ANGELES CITY PAMPANGA
VITE_BILLING_PHONE=09616769634
VITE_BILLING_EMAIL=infusions.logistics@gmail.com
VITE_BILLING_BANK=Metrobank
VITE_BILLING_ACCOUNT_NAME=Infusions Cafe And Trading
VITE_BILLING_ACCOUNT_NO=425-7-42591143-7

# consumed at RUN time by the api service
ALLOWED_ORIGINS=http://localhost
LOG_LEVEL=info
```

`VITE_BUSINESS_TYPE` **must** match the server's `BUSINESS_TYPE`. Mismatch is the
single most common misdeploy and is exactly what the red banner guards against.

> If you adopted the nginx proxy (3c): set `VITE_API_URL=` empty and
> `ALLOWED_ORIGINS=http://localhost`.

---

## Step 6 — Build and start

Tell Compose to use both files for the rest of this session, so you can't
accidentally run a command that skips the override and reaches for Atlas:

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.rehearsal.yml
```

> Add that line to `~/.bashrc` if you don't want to retype it after each reboot.
> Every `docker compose` command below assumes it's set.

```bash
docker compose up -d --build
```

First build takes 3–6 minutes under the 2-core cap — that's realistic; the VPS
will feel the same. Watch it live:

```bash
docker compose logs -f
```

Then:

```bash
docker compose ps
```

All three services (`mongo`, `api`, `web`) should read `healthy`. `api` starting
before `mongo` is healthy means the override file wasn't picked up.

---

## Step 7 — Verify

```bash
curl -s http://localhost:5002/health
```

Expect `{"status":"ok","db":"connected","businessType":"log",...}`.
**`businessType` must say `log`.** If it says `fb`, Step 3b didn't take.

Now confirm the client bundle got the right vars — this is the check that catches
3b, and the one people skip:

```bash
docker compose exec web grep -ro "192.168.100.2" /usr/share/nginx/html | head
```

**Any output is a failure** — the hardcoded LAN fallback got baked in, meaning the
build args didn't reach Vite. Silence means you're good.

Open `http://localhost` in Windows (WSL2 forwards localhost automatically):

| # | Smoke test | Done |
|---|---|---|
| 1 | No red configuration-mismatch banner | ☐ |
| 2 | Login as `Super Admin` with the Step 5a password | ☐ |
| 3 | Add 1 category + 1 product with an image | ☐ |
| 4 | Add 1 inventory item with stock | ☐ |
| 5 | Manual POS order → pay cash → complete | ☐ |
| 6 | Ledger → Journal shows the entry *(proves transactions work)* | ☐ |
| 7 | P&L for today shows revenue + COGS | ☐ |
| 8 | Client portal: sign in, place an order, open the slip, download the PDF | ☐ |
| 9 | Refresh mid-order — cart survives, no bounce to login | ☐ |
| 10 | End Shift → reconciliation completes | ☐ |

Step 6 is the important one. If the journal entry is missing, your Mongo isn't
running as a replica set and transactions are silently failing.

---

## Step 8 — Resilience

A VPS reboots. Prove the stack comes back unattended:

```bash
wsl --shutdown
```

Restart Docker Desktop, wait ~60 seconds, then from Ubuntu:

```bash
docker compose ps && curl -s http://localhost:5002/health
```

Everything should be `healthy` with no manual intervention — that's
`restart: unless-stopped` doing its job. If not, the real VPS won't survive a
reboot either.

Also rehearse a backup, since it's worthless untested:

```bash
make backup && ls -la backups/
```

---

## Step 9 — Iterate, then tear down

Found a problem? Fix it **in your Windows working copy**, commit, then in Ubuntu:

```bash
cd ~/rehearsal/semivra && git pull && docker compose up -d --build
```

Repeat Step 7 until it's clean twice in a row. Then:

```bash
docker compose down -v
```

Remove `C:\Users\Invic2s\.wslconfig` to get your 6 cores back.

---

## Step 10 — Going to the real VPS

Once the rehearsal is green, the real deploy is `DEPLOY.md` with three deltas:

1. **`MONGO_URI` goes back to Atlas** — and whitelist the VPS's IP in Atlas
   Network Access first, or the API boots with `db: disconnected`.
2. **Drop `docker-compose.rehearsal.yml`** — production uses Atlas, not the
   throwaway Mongo container.
3. **`VITE_API_URL` / `VITE_FRONTEND_URL` / `ALLOWED_ORIGINS` become your real
   domain**, over `https://`. Rebuild the client after changing them — they're
   baked in at build time, so editing `.env` on a running container does nothing.

Then work `DEPLOY.md` top to bottom. Everything in it should now feel like a
repeat.

---

## Appendix A — Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `nproc` says 12 | `.wslconfig` not applied | Check the path/extension; `wsl --shutdown` again |
| `docker: command not found` in Ubuntu | WSL integration off | Docker Desktop → Settings → Resources → WSL Integration |
| `ERR_MODULE_NOT_FOUND ./features/...` | Step 3a not applied | Add `COPY features ./features` |
| Red mismatch banner | `VITE_BUSINESS_TYPE` ≠ server `BUSINESS_TYPE` | Fix root `.env`, rebuild with `--build` |
| `192.168.100.2` found in bundle | Build args not reaching Vite | Re-check Step 3b in **both** files |
| `db: disconnected` | Mongo not up, or bad URI | `docker compose logs mongo` |
| Journal entries missing after a sale | Mongo not a replica set | Confirm `--replSet rs0` and `?replicaSet=rs0` |
| Build OOM-killed | 8 GB cap + other apps | Close Chrome, or raise `memory=` temporarily |
| Port 80 in use | Windows IIS or another container | `docker compose down`, or remap to `8080:80` |

## Appendix B — Higher-fidelity VM (optional)

WSL2 won't catch firewall, TLS, SSH or systemd issues. When you have ~30 GB free,
run the same runbook inside a real Ubuntu VM instead:

```bash
winget install Canonical.Multipass
multipass launch 24.04 --name kvm2 --cpus 2 --memory 8G --disk 100G
multipass shell kvm2
```

Inside it, install Docker via `get.docker.com`, then start from Step 4. This gives
you a genuine Ubuntu Server that behaves like the VPS — including `ufw`, `systemd`,
and a real `:80`/`:443` — so you can rehearse Caddy/Traefik TLS too.
