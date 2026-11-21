#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_dir=${DABLIN_BUILD_DIR:-"$root/build/dablin"}
cmake -S "$root/vendor/dablin-epg" -B "$build_dir" -DDISABLE_SDL=1
cmake --build "$build_dir" --target dablin -j "${BUILD_JOBS:-2}"
printf 'DABlin: %s/src/dablin\n' "$build_dir"
