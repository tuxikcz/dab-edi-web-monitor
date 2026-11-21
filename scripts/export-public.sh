#!/bin/sh
# Explicit allowlist; never copies the private config, repository metadata or tests.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out="$root/build/dab-probe-public"
mkdir -p "$root/build"
if [ -e "$out" ]; then echo "Output already exists: $out (remove or move it manually before exporting again)" >&2; exit 1; fi
mkdir "$out"
cp -a "$root/src" "$root/public" "$root/vendor" "$root/patches" "$out/"
mkdir -p "$out/scripts"
cp "$root/scripts/build-dablin.sh" "$out/scripts/"
cp "$root/distribution/scripts/check-public-config.js" "$out/scripts/"
cp -a "$root/distribution/systemd" "$out/"
for file in README.md README-CZ.md config.example.json package.json install.sh .gitignore; do cp "$root/distribution/$file" "$out/"; done
cp "$root/LICENSE" "$root/CHANGELOG.md" "$out/"
printf 'Export: %s\n' "$out"
