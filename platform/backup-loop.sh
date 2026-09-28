#!/bin/bash
# Scheduled MongoDB backup, run by the `backup` service in docker-compose.yml.
#
# Before this, backups only happened when someone typed `make backup`, and
# nothing ever checked that a dump could be read back. An untested backup is
# not a backup, so every run here is VERIFIED before it is kept:
#
#   1. mongodump the whole instance (every tenant database) with --oplog, so
#      the snapshot is consistent even while tills are writing
#   2. mongorestore --dryRun the archive - it must read end to end
#   3. only then rename it into place and stamp LAST_SUCCESS
#
# A failed or unreadable dump is deleted and stamped in LAST_FAILURE; it never
# replaces a good one. Old archives are pruned after RETENTION_DAYS.
#
# Offsite copies are the `backup-offsite` service's job (rclone to R2/B2).
set -uo pipefail

URI="${MONGO_BACKUP_URI:-mongodb://mongo:27017/?replicaSet=rs0}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DIR=/backups

mkdir -p "$DIR"
log() { echo "[$(date -u +%FT%TZ)] $*"; }

run_once() {
  local stamp out
  stamp="$(date -u +%Y-%m-%d_%H%M%S)"
  out="$DIR/semivra-$stamp.archive.gz"

  log "backup: dumping to $out"
  if ! mongodump --uri="$URI" --archive="$out.partial" --gzip --oplog --quiet; then
    log "backup: FAILED at mongodump"
    rm -f "$out.partial"
    date -u +%FT%TZ > "$DIR/LAST_FAILURE"
    return 1
  fi

  log "backup: verifying the archive reads back"
  if ! mongorestore --uri="$URI" --archive="$out.partial" --gzip --dryRun --quiet; then
    log "backup: FAILED verification - archive discarded"
    rm -f "$out.partial"
    date -u +%FT%TZ > "$DIR/LAST_FAILURE"
    return 1
  fi

  mv "$out.partial" "$out"
  date -u +%FT%TZ > "$DIR/LAST_SUCCESS"
  log "backup: OK ($(du -h "$out" | cut -f1))"

  find "$DIR" -maxdepth 1 -name 'semivra-*.archive.gz' -mtime "+$RETENTION_DAYS" -print -delete
  find "$DIR" -maxdepth 1 -name '*.partial' -mmin +360 -delete
}

# Never print the URI itself: with MONGO_AUTH=on it carries the root password,
# and container logs are read by more people than the .env is.
SAFE_URI="$(printf '%s' "$URI" | sed -E 's#(mongodb(\+srv)?://)[^@/]+@#\1***@#')"
log "backup: every ${INTERVAL_HOURS}h, keeping ${RETENTION_DAYS} days, from $SAFE_URI"
# First run shortly after start, so a fresh deployment is covered on day one.
sleep 120
while true; do
  run_once || true
  sleep "$((INTERVAL_HOURS * 3600))"
done
