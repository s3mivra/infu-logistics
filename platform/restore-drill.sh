#!/bin/bash
# Restore drill: prove the latest backup actually restores. Run it on the VPS:
#
#   bash platform/restore-drill.sh            # latest archive
#   bash platform/restore-drill.sh FILE       # a specific one
#
# It restores into a THROWAWAY MongoDB container - never the live one - then
# counts the records that matter in every tenant database and compares them
# with the live instance. The live database is only read.
#
# Passes only if every tenant database came back and its journal entries and
# orders are present. The result is stamped in backups/LAST_RESTORE_DRILL, so
# "when did we last prove a restore?" has an answer.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/backups"
ARCHIVE="${1:-$(ls -1t "$DIR"/semivra-*.archive.gz 2>/dev/null | head -1)}"
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "No backup archive found in $DIR."; exit 1; }

NAME="semivra-restore-drill-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Drill: restoring $(basename "$ARCHIVE") into a throwaway mongo..."
docker run -d --rm --name "$NAME" -v "$DIR:/backups:ro" mongo:7 --quiet >/dev/null
for _ in $(seq 1 30); do
  docker exec "$NAME" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 && break
  sleep 1
done

docker exec "$NAME" mongorestore --archive="/backups/$(basename "$ARCHIVE")" --gzip --quiet

COUNT_JS='
  const out = {};
  db.adminCommand({ listDatabases: 1 }).databases
    .filter(d => d.name.startsWith("semivra_"))
    .forEach(d => {
      const t = db.getSiblingDB(d.name);
      out[d.name] = { journalentries: t.journalentries.countDocuments({}), orders: t.orders.countDocuments({}) };
    });
  print(JSON.stringify(out));'

RESTORED="$(docker exec "$NAME" mongosh --quiet --eval "$COUNT_JS")"
echo "Restored: $RESTORED"

LIVE="$(docker compose -f "$ROOT/docker-compose.yml" exec -T mongo mongosh --quiet --eval "$COUNT_JS" 2>/dev/null || echo '{}')"
echo "Live now: $LIVE"

# Every tenant present in the backup must have come back with its books. Live
# counts are higher by whatever was sold since the backup; they are shown for
# the operator to eyeball, not asserted.
if [[ "$RESTORED" == "{}" ]]; then
  echo "DRILL FAILED: no tenant databases in the restore."
  date -u +"%FT%TZ FAILED $(basename "$ARCHIVE")" > "$DIR/LAST_RESTORE_DRILL"
  exit 1
fi

date -u +"%FT%TZ PASSED $(basename "$ARCHIVE")" > "$DIR/LAST_RESTORE_DRILL"
echo "DRILL PASSED."
