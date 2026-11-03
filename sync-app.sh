#!/bin/bash
# Update the app source in app/ from a checkout of the app repository (maintainers only; building needs only this repository).
#   ./sync-app.sh [app checkout] [ref]   (checkout also via TUERPRUEFUNG=…, default ../tuerpruefung; ref default origin/main)
# Takes only the parts listed in app-parts.txt, without tests, and records the source commit in app/SOURCE.
set -euo pipefail
cd "$(dirname "$0")"
APP_REPO=${1:-${TUERPRUEFUNG:-../tuerpruefung}}; REF=${2:-${REF:-origin/main}}
git -C "$APP_REPO" fetch -q origin
PARTS=(); while IFS= read -r z; do [[ $z =~ ^[[:space:]]*(#|$) ]] || PARTS+=("$z"); done < app-parts.txt
rm -rf app && mkdir app
git -C "$APP_REPO" archive "$REF" -- "${PARTS[@]}" | tar -x -C app
# Not needed to build the image: unit tests and the local settings of "supabase functions serve"
find app -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) -delete
rm -f app/supabase/functions/.env
V=$(node -p "require('./app/package.json').version")
C=$(git -C "$APP_REPO" rev-parse --short "$REF")
printf 'version=%s\ncommit=%s\n' "$V" "$C" > app/SOURCE
echo "app/ = app $V ($C), $(find app -type f | wc -l | tr -d ' ') files"
