# Shared helpers for the startup and service scripts (sourced).
# Without S6_KEEP_ENV the services do not see the container's variables: each service gets only what its run script
# passes explicitly (ADMIN_PASSWORD, for example, never reaches the Edge Functions).
set -euo pipefail
PATH_BASE=/usr/lib/postgresql/15/bin:/command:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH=$PATH_BASE
SECRETS=/data/secrets/instance.env
# Settings in /etc/instance/postgresql.conf (among others log_statement = none: otherwise ALTER ROLE … PASSWORD would end up
# in the log in plain text; cron.host via the socket). Data directory from PGDATA.
PGSTART=(postgres -c config_file=/etc/instance/postgresql.conf)
PG_ENV=(PGDATA=/data/postgres PG_MAJOR=15 LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8)

# getenv <NAME> [default] [OLD_NAME]: container variable (docker run -e / compose environment), else the old German name
# of earlier versions, else the default
getenv() {
  local d=/run/s6/container_environment
  if [[ -f $d/$1 ]]; then cat "$d/$1"
  elif [[ -n ${3:-} && -f $d/$3 ]]; then cat "$d/$3"
  else printf '%s' "${2:-}"; fi
}
# is_yes <value>: yes/ja/true/1/on
is_yes() { [[ ${1,,} =~ ^(yes|ja|true|1|on)$ ]]; }

APP_URL=$(getenv APP_URL http://localhost:8080 APP_ADRESSE); APP_URL=${APP_URL%/}

load_secrets() { # shellcheck disable=SC1090
  source "$SECRETS"; }

# run_as <user> <command …>: as the service user with an empty environment plus SERVICE_ENV=(…)
run_as() {
  local u=$1; shift
  exec env -i PATH="$PATH_BASE" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 HOME=/tmp "${SERVICE_ENV[@]}" s6-setuidgid "$u" "$@"
}

# psql as supabase_admin via the socket (peer, OS user postgres only)
psql_admin() { s6-setuidgid postgres env "${PG_ENV[@]}" psql -h /var/run/postgresql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -Atq "$@"; }
# psql as role postgres (owner of the app tables, as with "supabase db push")
psql_pg() { s6-setuidgid postgres env "${PG_ENV[@]}" psql -h /var/run/postgresql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq "$@"; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # jwt <secret> <payload-json>
  local k p
  k=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url); p=$(printf '%s' "$2" | b64url)
  printf '%s.%s.%s' "$k" "$p" "$(printf '%s' "$k.$p" | openssl dgst -sha256 -hmac "$1" -binary | b64url)"
}

# wait_for <seconds> <command …>
wait_for() { local n=$1; shift; for _ in $(seq 1 "$n"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

app_version() { node -p "require('/opt/app-package.json').version"; }

# Initial setup in the browser: the setup key as a file in the data folder (File Station, Explorer); the setup-key service
# deletes it once the first admin exists
SETUP_KEY_FILE=/data/SETUP_KEY.txt
readable_key() { sed 's/.\{4\}/&-/g; s/-$//' <<<"$1"; }

# write_config [setup key]: runtime configuration of the app (tuerpruefung: src/lib/konfig.ts), served by web.caddy as
# /konfig.js. With a key (SETUP_WITHOUT_KEY=yes only) the app fills it in itself during the initial setup.
write_config() {
  install -d -m 755 /run/instance
  U="$APP_URL" K="$ANON_KEY" S="${1:-}" node -e '
    const e = process.env
    const k = { supabaseUrl: e.U, supabaseKey: e.K, appAdresse: e.U,
      einrichtungHinweis: "Steht im Datenordner des Containers in der Datei SETUP_KEY.txt und im Protokoll des Containers.",
      ...(e.S ? { einrichtungsschluessel: e.S } : {}) }
    process.stdout.write(`// Written when the container starts\nwindow.__KONFIG__ = ${JSON.stringify(k)}\n`)' > /run/instance/konfig.js.new
  chmod 644 /run/instance/konfig.js.new
  mv /run/instance/konfig.js.new /run/instance/konfig.js
}
