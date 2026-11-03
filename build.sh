#!/bin/bash
# Build the image and save it as a file for import (e.g. Synology Container Manager).
#   ./build.sh [platform]
#   ./build.sh linux/amd64                 Intel/AMD (most Synology models), default
#   ./build.sh linux/arm64                 ARM (e.g. Mac with Apple silicon, Raspberry Pi 5)
# Result: image dulyinspect:<version> and :latest, file out/dulyinspect-<version>-<arch>.tar (classic docker-archive format,
# importable in Synology Container Manager and with docker load)
# The app version is the source in app/ (see app/SOURCE; update with sync-app.sh).
set -euo pipefail
cd "$(dirname "$0")"
PLATFORM=${1:-linux/amd64}
ARCH=${PLATFORM#linux/}
V=$(sed -n 's/^version=//p' app/SOURCE); C=$(sed -n 's/^commit=//p' app/SOURCE)
echo "Building app $V ($C) for $PLATFORM …"
docker build --platform "$PLATFORM" \
  --label org.opencontainers.image.version="$V" --label org.opencontainers.image.revision="$C" \
  -t "dulyinspect:$V" -t dulyinspect:latest .
mkdir -p out
# Classic docker-archive format: the Synology Container Manager import rejects the OCI layout of docker save
docker save -o "out/.oci-$V-$ARCH.tar" "dulyinspect:$V" dulyinspect:latest
./classic-archive.sh "out/.oci-$V-$ARCH.tar" "out/dulyinspect-$V-$ARCH.tar" "dulyinspect:$V" dulyinspect:latest
rm -f "out/.oci-$V-$ARCH.tar"
ls -lh "out/dulyinspect-$V-$ARCH.tar"
