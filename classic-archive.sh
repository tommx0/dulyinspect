#!/bin/bash
# Convert a docker save file into the classic docker-archive format (with "repositories"):
#   ./classic-archive.sh <in.tar> <out.tar> <name:tag> [more name:tag …]
# Newer Docker saves images in the OCI layout; the image import of Synology Container Manager rejects that as an
# "invalid Docker repository". docker load accepts both. The classic format stores layers uncompressed (larger file).
set -euo pipefail
IN=$(cd "$(dirname "$1")" && pwd)/$(basename "$1"); OUT=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2
FIRST=$1; shift
EXTRA=(); for t in "$@"; do EXTRA+=(--additional-tag "$t"); done
SKOPEO=quay.io/skopeo/stable:v1.17.0@sha256:be15097a3e99a1fe72838b3d626d1c283db38626536fff5e04ab6bbb814baeca
docker run --rm -v "$(dirname "$IN"):/in:ro" -v "$(dirname "$OUT"):/out" "$SKOPEO" copy -q "${EXTRA[@]}" \
  "docker-archive:/in/$(basename "$IN")" "docker-archive:/out/$(basename "$OUT"):$FIRST"
tar -xOf "$OUT" repositories >/dev/null || { echo "ERROR: $OUT has no repositories file." >&2; exit 1; }
