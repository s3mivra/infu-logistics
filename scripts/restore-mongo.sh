#!/usr/bin/env bash
# Restore a Semivra POS MongoDB backup created by backup-mongo.sh.
#
# Usage:
#   bash scripts/restore-mongo.sh backups/2026-05-29_020000.tar.gz
#   bash scripts/restore-mongo.sh                # interactive: lists backups

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/server/.env"
BACKUP_DIR="$ROOT/backups"

[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE not found."; exit 1; }
set -a; . "$ENV_FILE"; set +a
[[ -z "${MONGO_URI:-}" ]] && { echo "ERROR: MONGO_URI not set."; exit 1; }
command -v mongorestore >/dev/null 2>&1 || { echo "ERROR: mongorestore not installed."; exit 1; }

ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" ]]; then
  echo "Available backups:"
  ls -1t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | head -10 | nl -w2 -s'. '
  read -r -p "Pick a number (or 'q' to quit): " choice
  [[ "$choice" == "q" ]] && exit 0
  ARCHIVE="$(ls -1t "$BACKUP_DIR"/*.tar.gz | sed -n "${choice}p")"
fi
[[ -f "$ARCHIVE" ]] || { echo "ERROR: $ARCHIVE not found."; exit 1; }

echo ""
echo "  ⚠  This will OVERWRITE data in: $MONGO_URI"
read -r -p "  Type 'restore' to confirm: " confirm
[[ "$confirm" == "restore" ]] || { echo "Aborted."; exit 1; }

TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT
echo "[$(date)] Extracting $ARCHIVE..."
tar -xzf "$ARCHIVE" -C "$TMP"

DUMP_DIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
echo "[$(date)] Restoring from $DUMP_DIR..."
mongorestore --uri="$MONGO_URI" --drop --quiet "$DUMP_DIR"

echo "[$(date)] Restore complete. Verify by checking /api/finance/balances."
