#!/usr/bin/env bash
# Bring the local rehearsal platform (this repo's platform/ stack, run inside
# WSL2 — see DEPLOY_4TENANT_KVM2.md) up from a cold start: after a reboot, a
# Docker Desktop crash, or first-time setup. Idempotent — safe to re-run any
# time something looks wrong.
#
# Run from WSL2 (NOT PowerShell — `~` and paths mean different things there):
#   cd ~/semivra-rehearsal/platform && bash rehearsal-up.sh
set -euo pipefail
cd "$(dirname "$0")"

log() { echo "[rehearsal-up] $*"; }

# ── 1. Wait for the Docker daemon ───────────────────────────────────────────
log "waiting for Docker daemon..."
for i in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then break; fi
  if [ "$i" -eq 60 ]; then
    log "ERROR: Docker daemon not reachable after 5 minutes."
    log "  If Docker Desktop just crashed, killing every docker* process and"
    log "  restarting it (or rebooting Windows, if a socket/file stays locked"
    log "  even after that) is the known fix — see this repo's session notes."
    exit 1
  fi
  sleep 5
done
log "Docker daemon is up."

# ── 2. Platform layer: mongo, caddy, control-plane ──────────────────────────
if [ ! -f .env ]; then
  log "ERROR: platform/.env is missing. This holds CP_PASSWORD and generated"
  log "  tenant secrets — it is NOT in git (correctly). If it's really gone,"
  log "  you need to regenerate it and every tenants/<slug>/.env from the"
  log "  live containers' env (docker exec <slug>-api-1 node -e"
  log "  \"console.log(process.env.JWT_SECRET)\" etc.) rather than recreating"
  log "  tenants from scratch, which would orphan their databases."
  exit 1
fi

log "starting platform layer (mongo, caddy, control-plane)..."
docker compose up -d

log "waiting for mongo to report healthy..."
for i in $(seq 1 30); do
  status=$(docker inspect semivra-platform-mongo-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
  if [ "$status" = "healthy" ]; then break; fi
  if [ "$i" -eq 30 ]; then log "WARNING: mongo not healthy after 2.5 minutes (status: $status) — continuing anyway."; fi
  sleep 5
done

# Self-heal: Caddy's bind mount for /etc/caddy/tenants can get established
# before the tenant vhost files exist (e.g. right after `docker compose up`
# on a fresh volume, or after certain Docker-Desktop-on-WSL2 restarts), and a
# plain `caddy reload` does NOT fix this — the mount itself needs to be
# re-established. Detect it and force-recreate caddy if so, rather than
# leaving every tenant unreachable with a confusing "connection reset."
seen_by_caddy=$(docker exec semivra-platform-caddy-1 sh -c 'ls /etc/caddy/tenants/*.caddy 2>/dev/null | wc -l' 2>/dev/null || echo 0)
on_disk=$(ls tenants-caddy/*.caddy 2>/dev/null | wc -l | tr -d ' ')
if [ "$on_disk" -gt 0 ] && [ "$seen_by_caddy" != "$on_disk" ]; then
  log "Caddy's tenant-vhost mount looks stale ($seen_by_caddy seen vs $on_disk on disk) — recreating caddy..."
  docker compose up -d --force-recreate caddy
  sleep 2
fi

# ── 3. Every tenant stack ────────────────────────────────────────────────────
if [ -d tenants ]; then
  for dir in tenants/*/; do
    slug=$(basename "$dir")
    [ -f "$dir/.env" ] || continue
    log "starting tenant: $slug"
    docker compose -p "$slug" --env-file "$dir/.env" -f tenant-compose.yml up -d
  done
fi

# ── 4. Verify ─────────────────────────────────────────────────────────────
log ""
log "=== Status ==="
sleep 3
if [ -d tenants ]; then
  for dir in tenants/*/; do
    slug=$(basename "$dir")
    [ -f "$dir/.env" ] || continue
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${slug}.localhost" http://localhost/health 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
      log "  $slug: OK  →  http://${slug}.localhost"
    else
      log "  $slug: NOT READY (HTTP $code) — check: docker compose -p $slug --env-file $dir/.env -f tenant-compose.yml ps"
    fi
  done
fi
cp_health=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:9000/healthz 2>/dev/null || echo "000")
log "  control-plane: $([ "$cp_health" = "200" ] && echo OK || echo "NOT READY (HTTP $cp_health)")  →  http://localhost:9000"
log ""
log "Done."
