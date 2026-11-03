#!/bin/bash
# As OS user postgres, with a temporary server reachable only via the socket:
#   db-init.sh create          initialise an empty /data/postgres (core.sql + init.sql)
#   db-init.sh backup <file>   pg_dumpall of the existing database, gzipped
# No -u: the Postgres entrypoint script relies on unset variables
set -Eeo pipefail
# Reuse the functions of the official Postgres image's entrypoint (initdb, temporary server, init files)
# shellcheck disable=SC1091
source /usr/local/lib/instance/pg-entrypoint.sh
PGSTART=(postgres -c config_file=/etc/instance/postgresql.conf)
export POSTGRES_USER=supabase_admin POSTGRES_DB=postgres POSTGRES_HOST=/var/run/postgresql PGPORT=5432
export POSTGRES_INITDB_ARGS=${POSTGRES_INITDB_ARGS:-}

case ${1:-} in
  create)
    docker_setup_env
    docker_init_database_dir
    export PGPASSWORD=$POSTGRES_PASSWORD
    docker_temp_server_start "${PGSTART[@]}"
    docker_setup_db
    docker_process_init_files /usr/local/lib/instance/core.sql /usr/local/lib/instance/init.sql
    docker_temp_server_stop
    ;;
  backup)
    TARGET=${2:?file missing}
    docker_temp_server_start "${PGSTART[@]}"
    # After a hard stop (docker kill, power cut) recovery runs first, although pg_ctl already reports "started"
    for _ in $(seq 1 600); do psql -h /var/run/postgresql -U supabase_admin -d postgres -Atqc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
    if ! pg_dumpall -h /var/run/postgresql -U supabase_admin | gzip > "$TARGET.part"; then
      docker_temp_server_stop; rm -f "$TARGET.part"; echo "Backup failed – start aborted." >&2; exit 1
    fi
    mv "$TARGET.part" "$TARGET"
    docker_temp_server_stop
    ;;
  *) echo "Usage: db-init.sh create | backup <file>" >&2; exit 2 ;;
esac
