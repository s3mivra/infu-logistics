#!/usr/bin/env bash
# Daily MongoDB backup for Semivra POS.
# - Reads MONGO_URI from server/.env
# - Dumps to backups/YYYY-MM-DD/
# - Compresses to .tar.gz
# - Keeps last N days (default 30)
# - Optional: uploads to S3 / B2 / Backblaze if BACKUP_S3_BUCKET is set
#
# Usage:
#   bash scripts/backup-mongo.sh
#   RETENTION_DAYS=14 bash scripts/backup-mongo.sh
#
# Cron (daily at 02:00):
#   0 2 * * * cd /path/to/semivra && bash scripts/backup-mongo.sh >> /var/log/semivra-backup.log 2>&1

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/server/.env"
BACKUP_DIR="$ROOT/backups"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DATE="$(date -u '+%Y-%m-%d_%H%M%S')"

[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE not found. Run scripts/setup-env.sh first."; exit 1; }

# Load MONGO_URI (and optional S3 vars) from .env
set -a; . "$ENV_FILE"; set +a
[[ -z "${MONGO_URI:-}" ]] && { echo "ERROR: MONGO_URI not set in $ENV_FILE"; exit 1; }

command -v mongodump >/dev/null 2>&1 || { echo "ERROR: mongodump not installed. Install MongoDB Database Tools."; exit 1; }

mkdir -p "$BACKUP_DIR"
TARGET="$BACKUP_DIR/$DATE"

echo "[$(date)] Backing up to $TARGET..."
mongodump --uri="$MONGO_URI" --out="$TARGET" --quiet

echo "[$(date)] Compressing..."
tar -czf "$TARGET.tar.gz" -C "$BACKUP_DIR" "$DATE"
rm -rf "$TARGET"

SIZE="$(du -h "$TARGET.tar.gz" | cut -f1)"
echo "[$(date)] Backup complete: $TARGET.tar.gz ($SIZE)"

# Optional S3 upload
if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  if command -v aws >/dev/null 2>&1; then
    echo "[$(date)] Uploading to s3://$BACKUP_S3_BUCKET/semivra-backups/..."
    aws s3 cp "$TARGET.tar.gz" "s3://$BACKUP_S3_BUCKET/semivra-backups/$DATE.tar.gz" --quiet
    echo "[$(date)] S3 upload complete."
  else
    echo "[$(date)] WARNING: BACKUP_S3_BUCKET set but aws CLI not installed."
  fi
fi

# Prune old local backups
echo "[$(date)] Pruning backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -maxdepth 1 -name '*.tar.gz' -mtime "+$RETENTION_DAYS" -delete -print

echo "[$(date)] Done."
