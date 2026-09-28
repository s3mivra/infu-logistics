#!/bin/bash
# One-time preparation for MONGO_AUTH=on on an EXISTING platform deployment.
# Run while auth is still OFF. It only ADDS users and rewrites tenant URIs;
# it does not switch auth on and does not touch any data. Safe to re-run.
#
#   1. creates the root user (MONGO_ROOT_USER / MONGO_ROOT_PASSWORD)
#   2. for every tenant in tenants/: creates app_<slug> with readWrite on
#      semivra_<slug> ONLY, and rewrites that tenant's MONGO_URI to use it
#      (the old .env is kept as .env.pre-auth)
#
# Then follow platform/MONGO_AUTH.md to switch auth on.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
set -a; . ./.env; set +a

: "${MONGO_ROOT_PASSWORD:?set MONGO_ROOT_PASSWORD in platform/.env (24+ chars)}"
[ "${#MONGO_ROOT_PASSWORD}" -ge 24 ] || { echo "MONGO_ROOT_PASSWORD must be 24+ characters."; exit 1; }
[ "${MONGO_AUTH:-off}" != "on" ] || { echo "Run this with MONGO_AUTH still off."; exit 1; }
USER_ROOT="${MONGO_ROOT_USER:-root}"
MONGO=semivra-platform-mongo-1

sh_js() { docker exec "$MONGO" mongosh --quiet --eval "$1"; }

echo "Root user..."
sh_js "
  const a = db.getSiblingDB('admin');
  if (a.getUser('$USER_ROOT')) a.updateUser('$USER_ROOT', { pwd: '$MONGO_ROOT_PASSWORD', roles: ['root'] });
  else a.createUser({ user: '$USER_ROOT', pwd: '$MONGO_ROOT_PASSWORD', roles: ['root'] });
  print('root ready');"

for dir in tenants/*/; do
  slug="$(basename "$dir")"
  envf="$dir.env"
  [ -f "$envf" ] || continue
  pwd="$(openssl rand -hex 24)"
  echo "Tenant $slug..."
  sh_js "
    const d = db.getSiblingDB('semivra_$slug');
    const roles = [{ role: 'readWrite', db: 'semivra_$slug' }];
    if (d.getUser('app_$slug')) d.updateUser('app_$slug', { pwd: '$pwd', roles });
    else d.createUser({ user: 'app_$slug', pwd: '$pwd', roles });
    print('user ready');"
  [ -f "$envf.pre-auth" ] || cp "$envf" "$envf.pre-auth"
  uri="mongodb://app_$slug:$pwd@mongo:27017/semivra_$slug?replicaSet=rs0\&authSource=semivra_$slug"
  sed -i "s|^MONGO_URI=.*|MONGO_URI=$uri|" "$envf"
  chmod 600 "$envf"
done

echo
echo "Users created. Nothing is enforced yet. Next: platform/MONGO_AUTH.md step 3."
