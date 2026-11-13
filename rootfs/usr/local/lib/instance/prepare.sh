#!/bin/bash
# First step of every start (as root): folders, secrets, runtime configuration, create the database or back it up before an update.
source /usr/local/lib/instance/common.sh

# Data folders of versions before the English names (2.87): rename once, nothing is copied or deleted
migrate_name() { if [[ -e $1 && ! -e $2 ]]; then mv "$1" "$2"; echo "Renamed ${1#/data/} → ${2#/data/}"; fi; }
migrate_name /data/geheim /data/secrets
migrate_name /data/secrets/einzel.env /data/secrets/instance.env
migrate_name /data/sicherung /data/backups
for f in /data/backups/vor-*.sql.gz; do [[ -e $f ]] && mv "$f" "${f/\/vor-/\/pre-}"; done
for f in /data/backups/laufend-*.sql.gz; do [[ -e $f ]] && mv "$f" "${f/\/laufend-/\/live-}"; done
migrate_name /data/stand /data/version
migrate_name /data/storage-attribute /data/storage-xattr
migrate_name /data/EINRICHTUNGSSCHLUESSEL.txt /data/SETUP_KEY.txt
rm -f /data/.belegt   # old lock file; the lock service now uses /data/.lock

install -d -m 755 /data
install -d -m 711 /data/secrets          # postgres only needs its own key in there
install -d -m 700 -o postgres -g postgres /data/postgres /data/backups
install -d -m 750 -o storage -g storage /data/storage
# File metadata, in case the storage path has no extended attributes (xattr-fallback.cjs)
install -d -m 750 -o storage -g storage /data/storage-xattr
install -d -m 700 -o web -g web /data/caddy
# Postgres only runs on a data directory owned by its user. Some storage cannot keep Linux owners (Docker Desktop on a Mac
# with a folder from the Mac: chown has no lasting effect, everything shows as root) – stop here, before anything is touched.
if [[ $(stat -c %u /data/postgres) != "$(id -u postgres)" ]]; then
  echo "ERROR: /data cannot keep file owners (chown has no effect), so Postgres cannot start." >&2
  echo "This happens with a folder from the Mac in Docker Desktop. Use a named Docker volume instead (README, \"Docker Desktop\")." >&2
  exit 1
fi
install -d -m 700 -o edge -g edge /var/cache/edge

rnd() { openssl rand -hex "$1"; }
umask 077
if [[ ! -f $SECRETS ]]; then
  echo "First start: generating secrets ($SECRETS)."
  J=$(rnd 32); NOW=$(date +%s); UNTIL=$((NOW + 10 * 365 * 24 * 3600))
  cat > "$SECRETS" <<EOF
JWT_SECRET=$J
ANON_KEY=$(jwt "$J" "{\"role\":\"anon\",\"iss\":\"supabase\",\"iat\":$NOW,\"exp\":$UNTIL}")
SERVICE_ROLE_KEY=$(jwt "$J" "{\"role\":\"service_role\",\"iss\":\"supabase\",\"iat\":$NOW,\"exp\":$UNTIL}")
PW_SUPABASE_ADMIN=$(rnd 24)
PW_POSTGRES=$(rnd 24)
PW_AUTHENTICATOR=$(rnd 24)
PW_AUTH=$(rnd 24)
PW_STORAGE=$(rnd 24)
PW_REALTIME_META=$(rnd 24)
REALTIME_API_JWT_SECRET=$(rnd 32)
REALTIME_SECRET_KEY_BASE=$(rnd 32)
REALTIME_DB_ENC_KEY=$(rnd 8)
EOF
fi
# Key for the mail server password the app stores (app 2.92+, Edge Function "mail"). Added to older secret files once;
# never replaced, a new key would make stored passwords unreadable.
grep -q '^MAIL_SCHLUESSEL=' "$SECRETS" || echo "MAIL_SCHLUESSEL=$(openssl rand -base64 32)" >> "$SECRETS"
umask 022
load_secrets

write_config

PG_MAJOR=$(postgres --version | sed -E 's/.* ([0-9]+)\..*/\1/')
if [[ ! -s /data/postgres/PG_VERSION ]]; then
  echo "First start: creating the database."
  s6-setuidgid postgres env "${PG_ENV[@]}" POSTGRES_PASSWORD="$PW_SUPABASE_ADMIN" PW_SUPABASE_ADMIN="$PW_SUPABASE_ADMIN" \
    PW_POSTGRES="$PW_POSTGRES" PW_AUTHENTICATOR="$PW_AUTHENTICATOR" PW_AUTH="$PW_AUTH" PW_STORAGE="$PW_STORAGE" \
    PW_REALTIME_META="$PW_REALTIME_META" JWT_SECRET="$JWT_SECRET" /usr/local/lib/instance/db-init.sh create
  exit 0
fi

OLD=$(cat /data/postgres/PG_VERSION)
if [[ $OLD != "$PG_MAJOR" ]]; then
  echo "ERROR: The data was created by Postgres $OLD, this image has Postgres $PG_MAJOR." >&2
  echo "Nothing was changed. Upgrade path: README, section \"Postgres major version\"." >&2
  exit 1
fi

# New app version: a full backup before any migration (including those of Auth and Storage)
NEW=$(app_version); BEFORE=$(cat /data/version 2>/dev/null || echo unknown)
if [[ $NEW != "$BEFORE" ]]; then
  FILE=/data/backups/pre-$NEW-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
  echo "Update $BEFORE → $NEW: backup to $FILE"
  s6-setuidgid postgres env "${PG_ENV[@]}" /usr/local/lib/instance/db-init.sh backup "$FILE"
  # Keep the latest 5 backups
  ls -1t /data/backups/pre-*.sql.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
fi
