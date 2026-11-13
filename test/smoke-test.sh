#!/bin/bash
# Smoke test for a built image, without a browser (runs locally and in the GitHub workflow):
#   test/smoke-test.sh [image]      default dulyinspect:latest
# Run 1: first start with the admin from ADMIN_*, konfig.js, blocked API descriptions, login, REST with RLS, uploads,
#        Realtime handshake, backup.sh, reset-admin, volume lock.
# Run 2: simulated update from a version with the German folder and variable names: folders renamed, backup before the
#        update, data and keys kept, xattr fallback (as on storage without extended attributes, e.g. Docker Desktop on a Mac).
# Run 3: no ADMIN_PASSWORD – initial setup in the browser with the setup key from data/SETUP_KEY.txt.
# Cleans up afterwards.
set -uo pipefail
IMAGE=${1:-dulyinspect:latest}
NAME=smoke-$$; VOL=smoke-$$; PORT=${PORT:-18080}; B=http://localhost:$PORT
FAILED=0
ok() { echo "  ok      $1"; }
fail() { echo "  FAILED  $1"; FAILED=$((FAILED + 1)); }
check() { local name=$1; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else fail "$name"; fi; }
cleanup() { docker rm -f "$NAME" "$NAME-two" "$NAME-three" >/dev/null 2>&1; docker volume rm "$VOL" "$VOL-three" >/dev/null 2>&1; }
trap cleanup EXIT
sql() { docker exec "$1" bash -c "source /usr/local/lib/instance/common.sh; psql_admin -c \"$2\""; }

start() { # extra docker run arguments
  docker run -d --name "$NAME" -p "$PORT:8080" -v "$VOL:/data" "$@" "$IMAGE" >/dev/null
}
# wait_for_log <since> <pattern> [container]: until the pattern shows up in new log lines, an error appears or the container
# stops (at most 300 s)
wait_for_log() {
  local since=$1 pattern=$2 c=${3:-$NAME}
  for _ in $(seq 1 150); do
    # grep without -q reads to the end: with pipefail, an early exit would turn a match into SIGPIPE for docker logs
    docker logs --since "$since" "$c" 2>&1 | grep "$pattern" >/dev/null && return 0
    docker logs --since "$since" "$c" 2>&1 | grep "^ERROR" >/dev/null && return 1
    [[ $(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null) == true ]] || return 1
    sleep 2
  done
  return 1
}
token() {
  curl -s -X POST "$B/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
    -d '{"email":"admin@smoke.test","password":"smoke-test-12345"}' | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

echo "Smoke test $IMAGE ($(docker image inspect -f '{{.Architecture}}' "$IMAGE"))"
echo "Run 1: first start"
docker volume create "$VOL" >/dev/null
T0=$(date +%s); SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
start -e APP_URL="$B" -e ADMIN_EMAIL=admin@smoke.test -e ADMIN_NAME="Smoke Test" -e ADMIN_PASSWORD=smoke-test-12345 -e ADMIN_CHANGE_PASSWORD=no
if ! wait_for_log "$SINCE" "^Setup complete"; then
  fail "first start"; docker logs "$NAME" 2>&1 | grep -v "^\s*$" | tail -40; exit 1
fi
ok "first start in $(( $(date +%s) - T0 )) s"
check "admin from ADMIN_* created" bash -c "docker logs $NAME 2>&1 | grep -q '^First admin admin@smoke.test created'"
check "no passwords in the log" bash -c "! docker logs $NAME 2>&1 | grep -qi \"password '\""

ANON=$(docker exec "$NAME" sh -c '. /data/secrets/instance.env; echo $ANON_KEY')
JS=$(curl -fsS $B/ | grep -o 'assets/index-[^"]*\.js' | head -1)
check "built without the preview notice" bash -c "! curl -fsS $B/$JS | grep -q 'Vorschauversion'"
check "demo mode off in the database" bash -c "[[ \$(docker exec $NAME bash -c 'source /usr/local/lib/instance/common.sh; psql_admin -c \"select aktiv from intern.demo_modus\"') == f ]]"
check "no vendor details (MX-Smart-Tech)" bash -c "! docker exec $NAME grep -rqi 'mx-smart' /opt/www --exclude-dir=anleitung"
check "no vendor licence terms" bash -c "! docker exec $NAME grep -rq 'Lizenzgeber' /opt/www/assets"
check "security.txt: reports via the repository" bash -c "curl -fsS $B/.well-known/security.txt | grep -q '^Contact: https://github.com/'"
check "app served" bash -c "curl -fsS $B/ | grep -q '<div id=\"root\">'"
check "konfig.js with address and key" bash -c "curl -fsS $B/konfig.js | grep -q '\"supabaseUrl\":\"$B\"' && curl -fsS $B/konfig.js | grep -q '$ANON'"
check "konfig.js never cached" bash -c "curl -fsSI $B/konfig.js | grep -qi 'cache-control: no-store'"
for p in /rest/v1/ /storage/v1/documentation /realtime/v1/api/tenants /realtime/v1/api/openapi; do
  check "blocked: $p" bash -c "[[ \$(curl -s -o /dev/null -w '%{http_code}' -H 'apikey: $ANON' $B$p) == 404 ]]"
done
check "blocked: GraphQL" bash -c "[[ \$(curl -s -o /dev/null -w '%{http_code}' -H 'apikey: $ANON' -H 'Accept-Profile: graphql_public' $B/rest/v1/x) == 404 ]]"

TOKEN=$(token)
if [[ -n $TOKEN ]]; then ok "login"; else fail "login"; fi
check "REST with RLS: own profile as admin" bash -c "curl -fsS '$B/rest/v1/benutzer?select=name,rolle' -H 'apikey: $ANON' -H 'Authorization: Bearer $TOKEN' | grep -q '\"rolle\":\"admin\"'"
check "REST without login: no users" bash -c "[[ \$(curl -s '$B/rest/v1/benutzer?select=name' -H 'apikey: $ANON') != *Smoke* ]]"
PNG=$(mktemp); printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$PNG"
check "upload to Storage" curl -fsS -X POST "$B/storage/v1/object/branding/smoke.png" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: image/png' --data-binary "@$PNG"
check "download from Storage" bash -c "curl -fsS '$B/storage/v1/object/public/branding/smoke.png' | cmp -s - '$PNG'"
check "download with Content-Type" bash -c "curl -fsSI '$B/storage/v1/object/public/branding/smoke.png' | grep -qi '^content-type: image/png'"
check "Realtime: wal2json slot possible" sql "$NAME" "select pg_drop_replication_slot(slot_name) from (select (pg_create_logical_replication_slot('smoke', 'wal2json', true)).slot_name) s"
check "Realtime WebSocket (101)" bash -c "curl -s -o /dev/null -w '%{http_code}' --max-time 3 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' '$B/realtime/v1/websocket?apikey=$ANON&vsn=1.0.0' | grep -q 101"
check "Edge Function reachable" bash -c "curl -s -X POST $B/functions/v1/ersteinrichtung -H 'Content-Type: application/json' -d '{}' | grep -q fehler"
check "backup.sh" docker exec "$NAME" /usr/local/lib/instance/backup.sh 3

# Emergency password reset from the command line: one-time password, change at next login, log entry
check "reset-admin lists the admins" bash -c "docker exec $NAME reset-admin | grep -q 'admin@smoke.test'"
check "reset-admin refuses unknown users" bash -c "! docker exec $NAME reset-admin nobody@smoke.test"
# A second factor to remove (an unverified TOTP enrolment is enough)
curl -fsS -X POST "$B/auth/v1/factors" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"factor_type":"totp","friendly_name":"smoke"}' >/dev/null
RESET=$(docker exec "$NAME" reset-admin ADMIN@smoke.test --two-factor 2>&1)
NEWPW=$(sed -n 's/^    \([A-Za-z0-9-]\{19\}\)$/\1/p' <<<"$RESET")
if [[ -n $NEWPW ]]; then ok "reset-admin: one-time password"; else fail "reset-admin: one-time password"; echo "$RESET"; fi
FACTORS=$(sql "$NAME" "select count(*) from auth.mfa_factors")
if [[ $FACTORS == 0 ]] && grep -q 'Second factors removed: 1' <<<"$RESET"; then ok "reset-admin --two-factor: factor removed"; else fail "reset-admin --two-factor: factor removed"; fi
T=$(token); if [[ -z $T ]]; then ok "reset-admin: old password no longer works"; else fail "reset-admin: old password no longer works"; fi
check "reset-admin: new password works" bash -c "curl -fsS -X POST '$B/auth/v1/token?grant_type=password' -H 'apikey: $ANON' \
  -H 'Content-Type: application/json' -d '{\"email\":\"admin@smoke.test\",\"password\":\"$NEWPW\"}' | grep -q access_token"
CHANGE=$(sql "$NAME" "select count(*) from intern.passwort_vorgabe v join benutzer b on b.id = v.benutzer_id where b.email = 'admin@smoke.test'")
if [[ $CHANGE == 1 ]]; then ok "reset-admin: change at next login"; else fail "reset-admin: change at next login"; fi
LOGGED=$(sql "$NAME" "select count(*) from log_zeile where zeile like '%reset-admin%Passwort neu gesetzt%admin@smoke.test%'")
if [[ $LOGGED == 1 ]]; then ok "reset-admin: log entry"; else fail "reset-admin: log entry"; fi
check "reset-admin: password not in the container log" bash -c "! docker logs $NAME 2>&1 | grep -qF '$NEWPW'"
# Back to the original password for the rest of the test (as an admin would do at the next login)
UID_ADMIN=$(sql "$NAME" "select id from benutzer where email = 'admin@smoke.test'")
SRK=$(docker exec "$NAME" sh -c '. /data/secrets/instance.env; echo $SERVICE_ROLE_KEY')
docker exec "$NAME" curl -fsS -X PUT "http://127.0.0.1:9999/admin/users/$UID_ADMIN" -H "Authorization: Bearer $SRK" \
  -H 'Content-Type: application/json' -d '{"password":"smoke-test-12345"}' >/dev/null
sql "$NAME" "delete from intern.passwort_vorgabe" >/dev/null

# Volume lock: a second container on the same volume must exit without touching the data
docker run -d --name "$NAME-two" -v "$VOL:/data" "$IMAGE" >/dev/null
for _ in $(seq 1 30); do [[ $(docker inspect -f '{{.State.Running}}' "$NAME-two") == false ]] && break; sleep 2; done
check "volume lock" bash -c "[[ \$(docker inspect -f '{{.State.Running}} {{.State.ExitCode}}' $NAME-two) == 'false 1' ]]"
check "first container keeps running" bash -c "[[ \$(docker inspect -f '{{.State.Running}}' $NAME) == true ]]"

echo "Run 2: update from the German layout, xattr fallback"
T0=$(date +%s); docker stop -t 60 "$NAME" >/dev/null
check "clean stop in $(( $(date +%s) - T0 )) s" bash -c "[[ \$(docker inspect -f '{{.State.ExitCode}}' $NAME) == 0 ]]"
docker rm "$NAME" >/dev/null
# Data folder as written by versions before 2.87: German names, older app version
docker run --rm --entrypoint sh -v "$VOL:/data" "$IMAGE" -c 'cd /data && mv secrets geheim && mv geheim/instance.env geheim/einzel.env \
  && mv backups sicherung && for f in sicherung/live-*; do mv "$f" "sicherung/laufend-${f#sicherung/live-}"; done \
  && echo 0.0.0 > stand && rm version && mv storage-xattr storage-attribute && touch .belegt'
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Old German variable names must still work
start -e APP_ADRESSE="$B" -e ADMIN_PASSWORT=ignored-12345 -e XATTR_FALLBACK=force
if wait_for_log "$SINCE" "^Setup complete"; then ok "restart after the update"; else fail "restart after the update"; docker logs "$NAME" 2>&1 | tail -30; fi
check "German folders renamed" docker exec "$NAME" sh -c 'test -f /data/secrets/instance.env && test -d /data/backups && test -f /data/version \
  && ls /data/backups/live-*.sql.gz && test -d /data/storage-xattr && test ! -e /data/geheim && test ! -e /data/sicherung && test ! -e /data/.belegt'
check "backup before the update" bash -c "docker logs $NAME 2>&1 | grep -q '^Update 0.0.0 → ' && docker exec $NAME sh -c 'ls /data/backups/pre-*.sql.gz'"
check "APP_ADRESSE still accepted" bash -c "curl -fsS $B/konfig.js | grep -q '\"supabaseUrl\":\"$B\"'"
check "data kept (file still there)" bash -c "curl -fsS '$B/storage/v1/object/public/branding/smoke.png' -o /dev/null"
check "keys kept" bash -c "[[ \$(docker exec $NAME sh -c '. /data/secrets/instance.env; echo \$ANON_KEY') == '$ANON' ]]"
check "no second admin" bash -c "! docker logs --since $SINCE $NAME 2>&1 | grep -q 'First admin'"
TOKEN=$(token)
check "xattr fallback: upload" curl -fsS -X POST "$B/storage/v1/object/branding/fallback.png" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: image/png' --data-binary "@$PNG"
check "xattr fallback: Content-Type kept" bash -c "curl -fsSI '$B/storage/v1/object/public/branding/fallback.png' | grep -qi '^content-type: image/png'"
FALLBACK="find /data/storage-xattr -path '*fallback.png*' -name '*.json' | grep -q ."
check "xattr fallback: metadata in storage-xattr" docker exec "$NAME" sh -c "$FALLBACK"
check "xattr fallback: delete cleans up" bash -c "curl -fsS -X DELETE '$B/storage/v1/object/branding/fallback.png' -H 'apikey: $ANON' -H 'Authorization: Bearer $TOKEN' >/dev/null \
  && ! docker exec $NAME sh -c \"$FALLBACK\""
rm -f "$PNG"
docker stop -t 60 "$NAME" >/dev/null

echo "Run 3: initial setup in the browser"
THREE="$NAME-three"; SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker run -d --name "$THREE" -p "$PORT:8080" -v "$VOL-three:/data" -e APP_URL="$B" "$IMAGE" >/dev/null
wait_for_log "$SINCE" "^Setup complete" "$THREE"
check "without ADMIN_PASSWORD: no admin, key in the log" bash -c "docker logs $THREE 2>&1 | grep -q '^Initial setup in the browser at .*setup key: [0-9A-Z]\{4\}-'"
KEY=$(docker exec "$THREE" head -1 /data/SETUP_KEY.txt 2>/dev/null)
if [[ $KEY =~ ^[0-9A-Z-]{9,}$ ]]; then ok "setup key file in the data folder"; else fail "setup key file in the data folder"; fi
check "konfig.js: hint to the key file, no key" bash -c "curl -fsS $B/konfig.js | grep -q 'SETUP_KEY.txt' && ! curl -fsS $B/konfig.js | grep -q einrichtungsschluessel"
ANON3=$(docker exec "$THREE" sh -c '. /data/secrets/instance.env; echo $ANON_KEY')
check "initial setup with the key" bash -c "curl -fsS -X POST $B/functions/v1/ersteinrichtung -H 'apikey: $ANON3' -H 'Content-Type: application/json' \
  -d '{\"schluessel\":\"$KEY\",\"name\":\"First Admin\",\"email\":\"first@smoke.test\",\"passwort\":\"smoke-test-67890\"}' >/dev/null"
for _ in $(seq 1 15); do docker exec "$THREE" test -e /data/SETUP_KEY.txt || break; sleep 2; done
check "key file deleted after the setup" bash -c "! docker exec $THREE test -e /data/SETUP_KEY.txt"
check "commissioning open (new instance)" bash -c "[[ \$(docker exec $THREE bash -c 'source /usr/local/lib/instance/common.sh; psql_admin -c \"select inbetriebnahme from firma\"') == '{}' ]]"

echo; if (( FAILED )); then echo "$FAILED check(s) failed."; exit 1; fi; echo "All checks passed."
