# syntax=docker/dockerfile:1.7
# DulyInspect as a single instance: frontend and all backend services in one image.
# Build: docker build -t dulyinspect .   (or ./build.sh); the app source is in app/ (update with sync-app.sh)
# Versions match the multi-tenant stack of the app (tuerpruefung: infra/mandanten/erzeuge-compose.mjs).
# Postgres: official Debian 13 packages instead of supabase/postgres, same major version as the multi-tenant stack (15).
ARG PG_IMAGE=postgres:15-trixie
ARG REALTIME_IMAGE=supabase/realtime:v2.150.2
ARG EDGE_IMAGE=supabase/edge-runtime:v1.77.9
ARG REST_IMAGE=postgrest/postgrest:v14.18
ARG AUTH_IMAGE=supabase/gotrue:v2.197.0
ARG STORAGE_IMAGE=supabase/storage-api:v1.87.2
ARG CADDY_IMAGE=caddy:2.11-alpine
ARG PG_VERSION=15
ARG S6_VERSION=3.2.1.0

FROM ${PG_IMAGE} AS pg
FROM ${REALTIME_IMAGE} AS realtime
FROM ${EDGE_IMAGE} AS edge
FROM ${REST_IMAGE} AS rest
FROM ${AUTH_IMAGE} AS auth
FROM ${CADDY_IMAGE} AS caddy

# storage-api is built for Alpine (musl): rebuild its only native module (fs-xattr) for glibc
FROM ${STORAGE_IMAGE} AS storage-musl
FROM node:26-trixie-slim AS storage
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY --from=storage-musl /app /app
RUN cd /app && npm rebuild fs-xattr && node -e "require('fs-xattr')"

# Frontend without a Supabase address: the app reads it at runtime from konfig.js (written by prepare.sh).
# Without the build variable the CSP only allows the app's own origin ('self'); app and API share one origin here.
# The output does not depend on the target platform, so build natively (an amd64 build on a Mac would be emulated).
FROM --platform=$BUILDPLATFORM node:24-trixie-slim AS frontend
RUN corepack enable
WORKDIR /app
COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY app/ .
# Only the app, never the tenant administration or the multi-tenant stack (app/ holds the parts from app-parts.txt, see sync-app.sh)
RUN for d in verwaltung infra vertraege docker-compose.verwaltung.yml scripts/kunde-einrichten.mjs scripts/ausrollen-coolify.mjs; do \
      if [ -e "$d" ]; then echo "app/ contains $d – take only the parts listed in app-parts.txt (sync-app.sh)." >&2; exit 1; fi; done
RUN test -f public/konfig.js || { echo "This app version has no konfig.js (runtime configuration) – too old for this image." >&2; exit 1; }
# Free edition under AGPL-3.0 (this image only; other deployments of the app are unaffected): no "Vorschauversion" notice or
# watermark, no demo mode, new versions load without an update banner (never during an inspection), a link to LICENSE instead
# of the vendor's licence terms, no vendor details, security reports via this repository.
ARG REPO=https://github.com/tommx0/dulyinspect
# The image only needs name and version from package.json (not the scripts of the multi-tenant operation)
RUN node -e "const p = require('./package.json'); require('fs').writeFileSync('/app-version.json', JSON.stringify({ name: p.name, version: p.version }))"
RUN VITE_VORSCHAU=nein VITE_DEMO=nein VITE_UPDATE=automatisch VITE_ENTWICKLER=nein \
    VITE_LIZENZ_LINK=$REPO/blob/main/LICENSE VITE_LIZENZ_NAME="GNU AGPL-3.0" \
    VITE_SICHERHEIT_KONTAKT=$REPO/security/advisories/new pnpm build

# Base stays debian:trixie-slim: postgres:15-trixie as a base would add a VOLUME (/var/lib/postgresql/data) and STOPSIGNAL SIGINT.
# From the official image we only take the apt.postgresql.org source and key, and its entrypoint script.
FROM debian:trixie-slim
ARG TARGETARCH
ARG S6_VERSION
ARG PG_VERSION
COPY --from=pg /usr/local/share/keyrings/postgres.gpg.asc /usr/local/share/keyrings/postgres.gpg.asc
COPY --from=pg /etc/apt/sources.list.d/pgdg.list /etc/apt/sources.list.d/pgdg.list
COPY --from=pg /usr/local/bin/docker-entrypoint.sh /usr/local/lib/instance/pg-entrypoint.sh
# User postgres as in the official image (uid/gid 999), created before the packages are installed,
# and without the default cluster that the Debian package would otherwise create on installation
RUN groupadd -r -g 999 postgres && useradd -r -u 999 -g postgres -d /var/lib/postgresql -s /bin/bash postgres \
    && mkdir -p /etc/postgresql-common/createcluster.d \
    && echo 'create_main_cluster = false' > /etc/postgresql-common/createcluster.d/instance.conf
# pg_cron: locks the support access after it expires (app migration supportzugang); wal2json: Realtime (postgres_changes).
# libtinfo6, libstdc++6, libssl3t64, zlib1g, libzstd1: Realtime (Erlang); libatomic1: Node; libpq5: PostgREST.
# LLVM (about 145 MB) is only used for JIT compilation of queries, which a database of this size does not need (jit = off):
# removed after installation despite the package dependency of postgresql-15.
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-$PG_VERSION postgresql-$PG_VERSION-cron postgresql-$PG_VERSION-wal2json \
      ca-certificates curl openssl xz-utils libatomic1 libpq5 libtinfo6 libstdc++6 libssl3t64 zlib1g libzstd1 locales \
    && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen \
    && rm -f /usr/lib/postgresql/$PG_VERSION/lib/llvmjit*.so && rm -rf /usr/lib/postgresql/$PG_VERSION/lib/bitcode \
    && dpkg --purge --force-depends libllvm19 libz3-4 \
    && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in amd64) A=x86_64 ;; arm64) A=aarch64 ;; *) exit 1 ;; esac \
    && curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-noarch.tar.xz" | tar -C / -Jxp \
    && curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-${A}.tar.xz" | tar -C / -Jxp

# One user per service; only postgres may log in as supabase_admin without a password (peer)
RUN for u in auth rest storage realtime edge web; do useradd -r -M -d /nonexistent -s /usr/sbin/nologin "$u"; done

COPY --from=realtime /app /opt/realtime
COPY --from=edge /usr/local/bin/edge-runtime /usr/local/bin/edge-runtime
COPY --from=rest /bin/postgrest /usr/local/bin/postgrest
COPY --from=auth /usr/local/bin/auth /usr/local/bin/gotrue
COPY --from=auth /usr/local/etc/auth/migrations /usr/local/etc/auth/migrations
COPY --from=storage /usr/local/bin/node /usr/local/bin/node
COPY --from=storage /app /opt/storage
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy

COPY --from=frontend /app/dist /opt/www
COPY --from=frontend /app/supabase/migrations /opt/migrations
COPY --from=frontend /app/supabase/functions /opt/functions
# .env is only used by "supabase functions serve" during development
RUN rm -f /opt/functions/.env
COPY --from=frontend /app-version.json /opt/app-package.json
COPY rootfs/ /

RUN chmod 755 /usr/local/lib/instance/*.sh \
    && mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql

ENV PATH=/usr/lib/postgresql/15/bin:/command:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PGDATA=/data/postgres PG_MAJOR=15 \
    LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_KEEP_ENV=0

LABEL org.opencontainers.image.title="DulyInspect (single instance)" \
      org.opencontainers.image.description="Inspection app for safety systems – frontend and backend in one container" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/tommx0/dulyinspect"
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD curl -fsS http://127.0.0.1:8080/auth/v1/health >/dev/null || exit 1
ENTRYPOINT ["/init"]
