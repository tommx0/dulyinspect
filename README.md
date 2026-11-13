# DulyInspect – single instance

**DulyInspect** is a web app for inspecting and documenting safety systems: escape doors, automatic doors, fire doors,
emergency lighting, fire alarm and intrusion alarm systems, smoke vents, smoke detectors, electrical installations,
portable appliances and PV systems. Inspectors work on their phone, also offline; the app produces signed PDF reports.

This repository packages the app as **one Docker image for one instance**: frontend and all backend services in a single
container, with all data in one volume. It is meant for a small business running the app on its own server or NAS
(e.g. Synology). The app source needed for the build is included in [`app/`](app/), so this repository is all you need to build the image.

> The app speaks German and English: each device follows its browser language (German if it is German, otherwise English)
> and can be switched at the bottom of every page. Inspection reports and labels use a fixed language per instance
> (settings → company details).

- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Data and backups](#data-and-backups)
- [Updates](#updates)
- [Building](#building)
- [How it works](#how-it-works)
- [Testing](#testing)
- [Known limitations](#known-limitations)
- [Licence](#licence)

## Features

- **One container**: PostgreSQL 15, GoTrue (auth), PostgREST, Storage, Realtime, Edge Runtime and Caddy, supervised by s6-overlay.
- **No data loss on updates**: a full database backup before every version change; downgrade, Postgres major version and
  volume locks stop the container before anything is touched.
- **Guided setup**: on first visit the app shows the initial setup („Ersteinrichtung“), protected by a setup key from the data
  folder, followed by a commissioning wizard („Inbetriebnahme“) for company data, inspected systems, checklists, legal texts,
  branding, labels and users.
- **Hardened**: every service runs as its own user with only its own variables, Postgres only listens on 127.0.0.1 with one
  password per service, API descriptions (OpenAPI, GraphQL, Realtime tenant API) are blocked, passwords never reach the log.
- **Works on storage without extended attributes** (Docker Desktop on a Mac, SMB/NFS shares): file metadata falls back to a
  parallel folder.
- **German and English**: the interface follows the browser language; reports and labels use the language set for the instance.
- **Free edition** under AGPL-3.0: no preview notice, no demo mode, new versions load automatically (never during an inspection).

## Quick start

You need the image as a file or from a registry (see [Building](#building)) and a reverse proxy with HTTPS in front of it –
camera, QR scan and installing the app on a phone require HTTPS.

```yaml
# docker-compose.yml
services:
  dulyinspect:
    image: dulyinspect:latest
    container_name: dulyinspect
    restart: unless-stopped
    ports:
      - "8090:8080"
    volumes:
      - ./data:/data
    environment:
      APP_URL: "https://inspection.example.com"
    stop_grace_period: 60s
```

```sh
docker compose up -d
docker compose logs -f     # wait for "Setup complete, app … at …"
cat data/SETUP_KEY.txt     # setup key for the initial setup
```

Open the address, enter the setup key and create the first admin. The app then prints a key sheet for its encryption –
keep it safe – and opens the commissioning wizard. The key file is deleted as soon as the first admin exists.

**Docker Desktop (Mac, Windows): use a named volume, not a folder from the host.** Docker Desktop cannot keep Linux file owners
on a host folder (chown has no lasting effect), and Postgres refuses a data directory it does not own – the container then stops
with `ERROR: /data cannot keep file owners …`. Replace `./data:/data` with a named volume:

```yaml
    volumes:
      - dulyinspect-data:/data
volumes:
  dulyinspect-data:
```

Linux servers and Synology (btrfs/ext4 shared folders) can use a folder as shown above.

Step-by-step guides with screenshots of every setting, Synology Container Manager and the DSM reverse proxy:

- **[docs/Docker-Synology-Guide.pdf](docs/Docker-Synology-Guide.pdf)** (English)
- **[docs/Anleitung-Docker-Synology.pdf](docs/Anleitung-Docker-Synology.pdf)** (German)

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `APP_URL` | `http://localhost:8080` | Public address of the app, exactly as opened in the browser (used for login, QR codes, CSP) |
| `MAX_ACTIVE_USERS` | `2` | Maximum number of active users |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | `admin@lokal`, `Administrator`, – | Automated installs only: create the first admin at startup instead of in the browser. Only on the very first start, while there is no account; remove `ADMIN_PASSWORD` afterwards |
| `ADMIN_CHANGE_PASSWORD` | `yes` | With `ADMIN_PASSWORD`: the admin must choose a new password at first login |
| `ADMIN_TWO_FACTOR` | `no` | With `ADMIN_PASSWORD`: the admin must set up an authenticator app at first login |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | –, `587`/`465`, `starttls`, –, –, – | Optional mail server offered in the app as „Mailserver des Betreibers“ (Einstellungen → Mail). `SMTP_SECURITY`: `starttls`, `tls` or `none`. Without these the admin can enter a mail server in the app; its password is stored encrypted with a key in `secrets/` |
| `SMTP_ALLOW_PRIVATE` | `no` | `yes`: allow a mail server in the local network (10.x, 172.16–31.x, 192.168.x). Loopback is always blocked |
| `SETUP_WITHOUT_KEY` | `no` | `yes`: the initial setup does not ask for the setup key. **Tests only** – whoever opens the page first becomes admin |

Yes/no values also accept `ja`/`nein`, `true`/`false`. The German variable names of earlier versions (`APP_ADRESSE`,
`ADMIN_PASSWORT`, `ADMIN_PASSWORT_AENDERN`, `ADMIN_ZWEI_FAKTOR`, `MAX_AKTIVE_BENUTZER`, `EINRICHTUNG_OHNE_SCHLUESSEL`)
still work.

## Data and backups

Everything lives in one volume, `/data`:

| Path | Content |
|---|---|
| `postgres/` | Database – never copy while the container is running |
| `storage/` | Photos, signatures, PDF reports, documents, logo |
| `storage-xattr/` | File metadata, only used on storage without extended attributes (still read after moving to storage with them) |
| `secrets/` | JWT secret, API keys, database passwords – **never delete**, otherwise all logins and keys become invalid |
| `backups/` | `pre-<version>-<time>.sql.gz` before every version change (latest 5), `live-<time>.sql.gz` from `backup.sh` |
| `caddy/` | Caddy state |
| `version` | App version set up last |
| `SETUP_KEY.txt` | Setup key, only until the first admin exists |
| `.lock` | Lock: one container per volume |

Data folders of versions before 2.87 (German names such as `geheim/`, `sicherung/`) are renamed automatically on the next start.

**Backup while running** (e.g. as a scheduled task on a Synology):

```sh
docker exec dulyinspect /usr/local/lib/instance/backup.sh 14   # keeps the latest 14
```

This writes a consistent database dump to `backups/`. Back up the whole data folder except `postgres/` as well: `storage/`,
`storage-xattr/` and `secrets/` are needed for a restore. The app also has its own backup („Datensicherung“) that includes files.

## Forgotten admin password

Another admin sets a new password in the app (Benutzer → Passwort). If there is none, use the emergency command in the
container (no app password needed, only access to the container):

```sh
docker exec -it dulyinspect reset-admin                          # list the admins
docker exec -it dulyinspect reset-admin admin@example.com        # new one-time password, to be changed at the next login
docker exec -it dulyinspect reset-admin admin@example.com --two-factor   # also remove the second factors (phone lost)
```

The one-time password is shown once and stored nowhere (not in the container log). The reset goes through the Auth API
like „Passwort“ in the app's user management, marks the password for change at the next login and is written to the app's
log (System → Logdateien, user „Container (reset-admin)“). A deactivated admin is only reactivated when no active admin is
left. Changing `ADMIN_PASSWORD` later does not reset anything; there is no password reset by email.

## Updates

Pull or import the new image and recreate the container (`docker compose up -d`). On the first start with a new app version:

1. A full backup is written first. If it fails, nothing starts.
2. Auth and Storage migrate their schemas, then the missing app migrations run, one transaction per file.
3. An older image on a newer schema, or a different Postgres major version, stops the container with a message, without changing the data.

Stop the container with `docker stop -t 60` (or `docker compose stop`); s6 shuts Postgres down cleanly in a few seconds.

> **Renamed:** the app was called „Anlagenprüfung“ and the image `anlagenpruefung-einzel` until 2.89. Existing installations
> only change the image in their `docker-compose.yml` to `dulyinspect:latest`; container name, volume and data folder can stay.

## Building

Everything needed is in this repository. [`app/`](app/) holds the app source: only the parts listed in
[`app-parts.txt`](app-parts.txt), without tests – never the tenant administration or the multi-tenant stack; the Dockerfile
fails if they show up. [`app/SOURCE`](app/SOURCE) names the app version and commit. Maintainers update `app/` from the
app repository with `./sync-app.sh <app checkout> [ref]`.

**GitHub Actions** (recommended for Intel/AMD, e.g. most Synology models): Actions → *Build image (amd64)* → *Run workflow*.
The run builds the image, runs the smoke test and provides the `.tar` as an artifact for 5 days; optionally it also publishes
to ghcr.io.

**Locally**:

```sh
./build.sh linux/amd64     # or linux/arm64
```

The result is the image `dulyinspect:<version>` and `:latest` and the file `out/dulyinspect-<version>-<arch>.tar`
for `docker load` or the Synology Container Manager.

## How it works

```
Browser ──HTTPS──▶ reverse proxy ──HTTP──▶ :8080 Caddy (web.caddy) ── app (/opt/www), /konfig.js
                                              ├─ /auth/v1      ▶ GoTrue      127.0.0.1:9999
                                              ├─ /rest/v1      ▶ PostgREST   127.0.0.1:3000
                                              ├─ /storage/v1   ▶ Storage     127.0.0.1:5000 ─▶ /data/storage
                                              ├─ /realtime/v1  ▶ Realtime    127.0.0.1:4000
                                              └─ /functions/v1 ▶ Edge Runtime 127.0.0.1:9000 ─▶ 127.0.0.1:8001 (internal Caddy)
                                                                    all ─▶ Postgres 127.0.0.1:5432 ─▶ /data/postgres
```

- **Base**: Debian 13 slim. Postgres 15 from apt.postgresql.org (with pg_cron and wal2json), not the Supabase image: a minimal
  core ([`core.sql`](rootfs/usr/local/lib/instance/core.sql)) creates the roles and schemas the services and the app expect.
  `postgres` is not a superuser, as with Supabase. LLVM is removed (`jit = off`).
- **Startup order** (s6-rc): `lock` → `prepare` → `db` → `auth`, `rest`, `storage`, `realtime`, `edge`, `internal` → `setup`
  → `web`, `setup-key`. If a step fails, the container stops (`S6_BEHAVIOUR_IF_STAGE2_FAILS=2`).
  - [`prepare.sh`](rootfs/usr/local/lib/instance/prepare.sh): folders, secrets, `konfig.js`, create the database or back it up before an update.
  - [`setup.sh`](rootfs/usr/local/lib/instance/setup.sh): app migrations, Realtime tenant, first admin or setup key.
  - `setup-key`: deletes `SETUP_KEY.txt` once the first admin exists.
- **Isolation**: every service runs as its own user and only gets the variables its run script passes (`S6_KEEP_ENV=0`,
  `run_as` in [`common.sh`](rootfs/usr/local/lib/instance/common.sh)). The superuser is only reachable via the socket for the OS user `postgres`.
- **Runtime configuration**: the frontend is the same for every instance. Address and public key are in `/konfig.js`, written on
  every start and served with `no-store`; the app loads it before starting and keeps it in the service worker cache for offline use.
- **Storage without extended attributes**: [`xattr-fallback.cjs`](rootfs/usr/local/lib/instance/xattr-fallback.cjs) is preloaded
  into storage-api and keeps file metadata as JSON in `storage-xattr/` when the data folder cannot store extended attributes.

## Testing

```sh
test/smoke-test.sh dulyinspect:latest
```

Three runs without a browser, also part of the GitHub workflow: first start with an admin from the environment (login, RLS,
uploads, Realtime, blocked API descriptions, backup, volume lock); an update from a data folder with the German names of
earlier versions (renaming, backup, data kept, xattr fallback); and the initial setup with the setup key.

`TUERPRUEFUNG=<checkout> node test/browser.mjs [url]` checks a running container in Chromium and WebKit (login, WebSocket under
the CSP, service worker, offline start).

## Known limitations

- **Edge Functions load npm packages at runtime** (`npm:@supabase/supabase-js@2`, `npm:postgres`), so the container needs
  internet access, at least once after it is recreated: the cache is in `/var/cache/edge`, not in the volume.
- **HTTPS** is not built in; a reverse proxy is needed.
- **Realtime** connects to the database as `supabase_admin` (as in Supabase self-hosting); a dedicated role would be better.
- **s6-overlay** is downloaded without a checksum.
- **Restoring from `backups/`** is not documented step by step and has not been tested for real yet.
- **Postgres major version upgrade** (15 → 17) is not described yet.
- **Safari/iOS**: the WebSocket under `connect-src 'self'` has only been tested in Chromium.
- Image about 1.9 GB (file about 340 MB); the largest part is storage-api (about 620 MB, 305 MB of it OpenTelemetry).

## Licence

Copyright © 2026 Thomas Marx.

Free software under the **GNU Affero General Public License v3.0** ([LICENSE](LICENSE), SPDX `AGPL-3.0-only`): anyone may use it,
also in a business, change it and pass it on. Whoever distributes a modified version or offers it as a service over a network
must provide the complete source code of their version under the same licence. No warranty, see sections 15 and 16 of the licence.

**Dual licensing:** the author also licenses the same software under other terms, for example for use in a proprietary product
or with a contract and support. Please contact the author.

The bundled third-party components (PostgreSQL, Supabase services, Caddy, npm packages) keep their own licences; the app lists
them under „Open Source“ (`#/lizenzen`).

Security issues: please report them privately via [GitHub security advisories](https://github.com/tommx0/dulyinspect/security/advisories/new).
