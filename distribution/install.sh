#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ "$(id -u)" -ne 0 ]; then echo 'Run sudo ./install.sh' >&2; exit 1; fi
. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in debian:12|debian:13|raspbian:12|raspbian:13) ;; *) echo "Unsupported OS: ${ID:-unknown} ${VERSION_ID:-unknown}" >&2; exit 1;; esac
case "$(uname -m)" in aarch64) echo 'ARM64: Raspberry Pi 4/5 target' ;; armv7l|x86_64) echo 'Experimental architecture; hardware installation is not verified' ;; *) echo 'Unsupported architecture' >&2; exit 1;; esac
command -v systemctl >/dev/null || { echo 'systemd is required' >&2; exit 1; }
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential cmake pkg-config libmpg123-dev libfaad-dev ffmpeg nodejs
/usr/bin/node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error("Node.js 20+ is required at /usr/bin/node for systemd; install it using a trusted source, then rerun this installer."); process.exit(1); }'
if [ -f package-lock.json ]; then
  command -v npm >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y npm
  npm ci --omit=dev
fi
DABLIN_BUILD_DIR="$(pwd)/build/dablin" ./scripts/build-dablin.sh
binary="$(pwd)/build/dablin/src/dablin"
help=$("$binary" -h 2>&1 || true)
printf '%s\n' "$help" | grep -q -- '--epg-json'
printf '%s\n' "$help" | grep -q -- '--epg-diagnostics'
printf '%s\n' "$help" | grep -q -- '-j '
printf '%s\n' "$help" | grep -q -- '-J <dir>'
"$binary" -f eti -p -j </dev/null >/dev/null 2>&1
mkdir -p build/smoke-slides
"$binary" -f eti -p -J build/smoke-slides </dev/null >/dev/null 2>&1
if "$binary" -f edi -I --epg-json build/smoke-epg.json --epg-diagnostics </dev/null >/dev/null 2>build/smoke-epg.log; then
  echo 'Unexpected EPG result for an empty stream' >&2; exit 1
fi
grep -q 'no complete programme information' build/smoke-epg.log
grep -q 'EPG summary:' build/smoke-epg.log
id dabprobe >/dev/null 2>&1 || useradd --system --home /nonexistent --shell /usr/sbin/nologin dabprobe
install -d -o root -g root -m 0755 /opt/dab-probe /opt/dab-probe/bin /etc/dab-probe
cp -a src public scripts package.json /opt/dab-probe/
install -o root -g root -m 0755 "$binary" /opt/dab-probe/bin/dablin
if [ ! -f /etc/dab-probe/config.json ]; then
  install -o root -g dabprobe -m 0640 config.example.json /etc/dab-probe/config.json
else
  echo 'Preserving /etc/dab-probe/config.json'
fi
install -o root -g root -m 0644 systemd/dab-probe.service /etc/systemd/system/dab-probe.service
systemctl daemon-reload
cat <<'MSG'
Installed without starting or enabling the service.
Edit /etc/dab-probe/config.json, especially edi.host, then verify:
  sudo /usr/bin/node /opt/dab-probe/scripts/check-public-config.js /etc/dab-probe/config.json
Start and inspect:
  sudo systemctl enable --now dab-probe
  sudo systemctl status dab-probe
  journalctl -u dab-probe -f
MSG
