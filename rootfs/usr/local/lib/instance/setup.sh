#!/bin/bash
# After the services have started, before the app is reachable (as root):
# app migrations, Realtime tenant, first admin or setup key. If a step fails, the container stops.
source /usr/local/lib/instance/common.sh
load_secrets

# Auth and Storage migrate their schemas on startup; only then do the app migrations fit
wait_for 300 curl -fsS http://127.0.0.1:9999/health || { echo "Auth does not start." >&2; exit 1; }
wait_for 300 curl -fsS http://127.0.0.1:5000/status || { echo "Storage does not start." >&2; exit 1; }

# No downgrade: newer migrations in the database than in the image
LATEST=$(ls /opt/migrations/*.sql | xargs -n1 basename | cut -d_ -f1 | sort | tail -1)
IN_DB=$(psql_pg -c "select coalesce(max(version), '') from supabase_migrations.schema_migrations")
if [[ -n $IN_DB && $IN_DB > $LATEST ]]; then
  echo "ERROR: The database has schema $IN_DB, this image only knows up to $LATEST (older image?)." >&2
  exit 1
fi

# Missing migrations as postgres, one transaction per file (like the app's update assistant)
for f in /opt/migrations/*.sql; do
  b=$(basename "$f" .sql); v=${b%%_*}; n=${b#*_}
  [[ $(psql_pg -c "select 1 from supabase_migrations.schema_migrations where version = '$v'") == 1 ]] && continue
  { echo "begin;"; cat "$f"; echo ";"; echo "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n');"; echo "commit;"; } \
    | psql_pg >/dev/null || { echo "ERROR in migration $b – data unchanged, backup in /data/backups." >&2; exit 1; }
  echo "Migration $b applied."
done
psql_pg -c "notify pgrst, 'reload schema'"
# No demo mode in this image (the app is built without VITE_DEMO; switch the database lock off to match)
psql_admin -c "update intern.demo_modus set aktiv = false where aktiv" 2>/dev/null || true
# pg_cron stores the host per job when it is created (default localhost = TCP without password, blocked here);
# cron.host only applies to new jobs
psql_admin -c "update cron.job set nodename = '/var/run/postgresql' where nodename = 'localhost'" 2>/dev/null || true

# Realtime: one tenant "einzel" for this database (the router sets the host einzel.realtime); keep the name, it is stored
wait_for 120 curl -fsS -o /dev/null http://127.0.0.1:4000/healthcheck || { echo "Realtime does not start." >&2; exit 1; }
NOW=$(date +%s)
TOKEN=$(jwt "$REALTIME_API_JWT_SECRET" "{\"role\":\"service_role\",\"iat\":$NOW,\"exp\":$((NOW + 300))}")
if ! curl -fsS -o /dev/null -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4000/api/tenants/einzel; then
  curl -fsS -o /dev/null -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @- \
    http://127.0.0.1:4000/api/tenants <<EOF
{"tenant": {"name": "einzel", "external_id": "einzel", "jwt_secret": "$JWT_SECRET", "extensions": [{"type": "postgres_cdc_rls", "settings": {
  "db_name": "postgres", "db_host": "127.0.0.1", "db_user": "supabase_admin", "db_password": "$PW_SUPABASE_ADMIN", "db_port": "5432",
  "region": "local", "poll_interval_ms": 100, "poll_max_record_bytes": 1048576, "ssl_enforced": false}}]}}
EOF
  echo "Realtime tenant registered."
fi

# First admin: only while there is no account. Through the app's ersteinrichtung function, so the app's rules apply.
if [[ $(psql_admin -c "select count(*) from auth.users") == 0 ]]; then
  KEY=$(psql_admin -c "select schluessel from intern.einrichtungsschluessel limit 1")
  PASSWORD=$(getenv ADMIN_PASSWORD "" ADMIN_PASSWORT)
  if [[ -n $PASSWORD ]]; then
    # Automated install: create the admin right away
    EMAIL=$(getenv ADMIN_EMAIL); EMAIL=${EMAIL:-admin@lokal}
    is_yes "$(getenv ADMIN_TWO_FACTOR no ADMIN_ZWEI_FAKTOR)" && TWO_FACTOR=true || TWO_FACTOR=false
    is_yes "$(getenv ADMIN_CHANGE_PASSWORD yes ADMIN_PASSWORT_AENDERN)" && CHANGE=true || CHANGE=false
    wait_for 60 curl -s -o /dev/null http://127.0.0.1:9000/ || { echo "Edge Functions do not start." >&2; exit 1; }
    REQUEST=$(S="$KEY" N="$(getenv ADMIN_NAME Administrator)" E="$EMAIL" P="$PASSWORD" TF="$TWO_FACTOR" CP="$CHANGE" node -e '
      const e = process.env
      process.stdout.write(JSON.stringify({ schluessel: e.S, name: e.N, email: e.E, passwort: e.P,
        zwei_faktor: e.TF === "true", passwort_aendern: e.CP === "true" }))')
    RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "$REQUEST" http://127.0.0.1:9000/ersteinrichtung)
    if [[ ${RESPONSE##*$'\n'} != 200 ]]; then
      echo "ERROR creating the admin: ${RESPONSE%$'\n'*}" >&2; exit 1
    fi
    echo "First admin $EMAIL created."
  else
    # Normal case: the first admin is created in the browser with the setup key
    READABLE=$(readable_key "$KEY")
    printf '%s\n\n%s\n%s\n' "$READABLE" "Setup key for the initial setup in the browser ($APP_URL)." \
      "This file is deleted as soon as the first admin has been created." > "$SETUP_KEY_FILE"
    chmod 644 "$SETUP_KEY_FILE"
    if is_yes "$(getenv SETUP_WITHOUT_KEY no EINRICHTUNG_OHNE_SCHLUESSEL)"; then
      write_config "$READABLE"
      echo "SETUP_WITHOUT_KEY=yes: initial setup in the browser without a key – for tests only, whoever opens the page first becomes admin."
    else
      echo "Initial setup in the browser at $APP_URL, setup key: $READABLE (also in data/SETUP_KEY.txt)"
    fi
  fi
fi
[[ $(psql_admin -c "select count(*) from auth.users") == 0 ]] || rm -f "$SETUP_KEY_FILE"

app_version > /data/version
echo "Setup complete, app $(app_version) at $APP_URL."
