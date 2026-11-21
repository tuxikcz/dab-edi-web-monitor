#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Spustte jako root: sudo ./install.sh" >&2
  exit 1
fi

for cmd in node ffmpeg cmake pkg-config; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Chybi program: $cmd" >&2
    echo "Na Debianu obvykle: apt install nodejs dablin ffmpeg" >&2
    exit 1
  fi
done

./scripts/build-dablin.sh
install -o root -g root -m 0755 "${DABLIN_BUILD_DIR:-$(pwd)/build/dablin}/src/dablin" /usr/local/bin/dablin

id dabmonitor >/dev/null 2>&1 || useradd --system --home /nonexistent --shell /usr/sbin/nologin dabmonitor
install -d -o root -g root -m 0755 /opt/dab-edi-web-monitor /etc/dab-edi-web-monitor
cp -a package.json src public scripts /opt/dab-edi-web-monitor/
if [ ! -f /etc/dab-edi-web-monitor/config.json ]; then
  install -o root -g dabmonitor -m 0640 config.json /etc/dab-edi-web-monitor/config.json
else
  echo "Existujici /etc/dab-edi-web-monitor/config.json ponechan beze zmeny."
fi
install -o root -g root -m 0644 systemd/dab-edi-web-monitor.service /etc/systemd/system/dab-edi-web-monitor.service
systemctl daemon-reload
systemctl enable --now dab-edi-web-monitor.service

echo "Instalace hotova."
echo "Web: http://IP_SERVERU:8088/"
echo "Stav: systemctl status dab-edi-web-monitor"
echo "Log: journalctl -u dab-edi-web-monitor -f"
