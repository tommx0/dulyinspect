#!/bin/bash
# Backup while the container is running (for a scheduled task, e.g. on a Synology):
#   docker exec dulyinspect /usr/local/lib/instance/backup.sh [count]
# Writes /data/backups/live-<time>.sql.gz (pg_dumpall, consistent) and keeps the latest <count> (default 14).
# The files under /data/storage and /data/storage-xattr (photos, reports …) and /data/secrets are needed as well.
source /usr/local/lib/instance/common.sh
KEEP=${1:-14}
[[ $KEEP =~ ^[1-9][0-9]*$ ]] || { echo "count must be a positive number." >&2; exit 2; }
FILE=/data/backups/live-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
if ! s6-setuidgid postgres env "${PG_ENV[@]}" bash -o pipefail -c \
    "pg_dumpall -h /var/run/postgresql -U supabase_admin | gzip > '$FILE.part'"; then
  rm -f "$FILE.part"; echo "ERROR: backup failed." >&2; exit 1
fi
mv "$FILE.part" "$FILE"
ls -1t /data/backups/live-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "Backup $FILE ($(du -h "$FILE" | cut -f1)), keeping: $KEEP"
