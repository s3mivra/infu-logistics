#!/bin/bash
# Starts the shared mongod. With MONGO_AUTH=on it requires a login (and a
# replica-set keyfile, which MongoDB demands once access control is on).
# With it off - the default - it starts exactly as it always has.
#
# Do NOT switch an existing deployment to on by editing .env alone: the users
# must exist first, or every tenant is locked out. Follow platform/MONGO_AUTH.md.
set -euo pipefail

ARGS=(--replSet rs0 --bind_ip_all --wiredTigerCacheSizeGB 2)

if [ "${MONGO_AUTH:-off}" = "on" ]; then
  if [ -z "${MONGO_KEYFILE_CONTENT:-}" ]; then
    echo "MONGO_AUTH=on needs MONGO_KEYFILE_CONTENT (openssl rand -base64 756)." >&2
    exit 1
  fi
  KEYFILE=/etc/mongo-keyfile
  printf '%s' "$MONGO_KEYFILE_CONTENT" > "$KEYFILE"
  chmod 400 "$KEYFILE"
  chown 999:999 "$KEYFILE"          # the image's mongodb user
  ARGS+=(--auth --keyFile "$KEYFILE")
fi

exec docker-entrypoint.sh mongod "${ARGS[@]}"
