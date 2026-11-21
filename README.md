# DAB PROBE

Web-based DAB/DAB+ ETI/EDI multiplex probe with audio streaming, DL+, MOT Slideshow and SPI/EPG support. An ETI-NI or EDI AF TCP source is required; this software is not an RF receiver. SPI support implements the subset described in `vendor/dablin-epg/README.md`.

The intended platform is Raspberry Pi 4/5, Raspberry Pi OS 64-bit or Debian 12/13 ARM64. Raspberry Pi 3 and 32-bit builds are experimental. The installer and workload have not been validated on Raspberry Pi hardware. Provision Node.js 20 or newer at `/usr/bin/node` from a trusted source before installing; Debian 12's default Node.js may be too old. No image or prebuilt binary is supplied.

## Install and configure

Clone the existing project and install from its source directory:

```sh
git clone https://github.com/tuxikcz/dab-edi-web-monitor.git
cd dab-edi-web-monitor
sudo ./install.sh
sudo nano /etc/dab-edi-web-monitor/config.json
sudo node /opt/dab-edi-web-monitor/scripts/check-config.js /etc/dab-edi-web-monitor/config.json
sudo systemctl enable --now dab-probe
sudo systemctl status dab-probe
journalctl -u dab-probe -f
```

The installer uses apt for build tools, libraries and FFmpeg, builds the bundled DABlin without SDL and GTK, runs CLI smoke checks, and installs it under `/opt/dab-edi-web-monitor/bin`. It never replaces `/usr/local/bin/dablin`. It does not start or enable the service. Repeat `sudo ./install.sh` to update; an existing configuration is retained. Restart the service explicitly after reviewing the update: `sudo systemctl restart dab-probe`.

Set `edi.host`, `edi.port` and `edi.format` (`eti` for ETI-NI or `edi` for EDI AF). The first boot is blocked until a source is configured. `listen.host` defaults to `127.0.0.1`; `probe.port` sets the web port (default 8090). Use a local browser or SSH port forwarding, for example `ssh -L 8090:127.0.0.1:8090 user@your-pi`. Change `ui.language` to `cz`, `en` or `de`. `metadata.enabled` controls DL/DL+ and slideshow together; `epg.enabled` controls the EPG worker. The `watchdog`, `audio`, `stream` and `stations` sections configure timeouts, audio and the optional fixed-station server. The probe itself lets you discover and select an audio service in the browser.

For LAN access, set `auth.enabled` to true and set a unique nonempty username and password before changing `listen.host`. The service preflight rejects non-loopback binding without authentication. HTTP Basic credentials are not encrypted: use a properly configured HTTPS reverse proxy for remote access. Restrict access to trusted users; the probe endpoint can connect to network hosts chosen by its users. Do not expose the service directly to the public internet.

## Resource use

During steady operation one TCP source feeds the selected audio worker and one EPG worker; discovery and format detection use separate short-lived connections. The EPG worker starts DABlin without selecting an audio service. The stream server can start an audio worker per configured station, so CPU and memory depend on station count, bitrate and source. Measure the load on your Pi; no tested station-count limit is available. Buffers and slow clients are bounded by the existing watchdog settings.

## Remove

```sh
sudo systemctl disable --now dab-probe
sudo rm -f /etc/systemd/system/dab-probe.service
sudo systemctl daemon-reload
sudo rm -rf /opt/dab-edi-web-monitor
```

This keeps `/etc/dab-edi-web-monitor/config.json` and the system account. Remove them explicitly only if they are no longer needed. Reinstallation preserves the configuration.

## License

DAB PROBE is MIT licensed. Bundled DABlin is GPL-3.0-or-later; its FEC component has separate LGPL-2.1 terms. See `LICENSE`, `vendor/dablin-epg/COPYING` and `vendor/dablin-epg/fec/LICENSE` and source notices.

Existing configurations are preserved. Before startup, `binaries.dablin` must point to `/opt/dab-edi-web-monitor/bin/dablin`; the service preflight rejects other binaries.

## Existing installations and development

Updating with `sudo ./install.sh` does not change `/etc/dab-edi-web-monitor/config.json` and does not start either unit. Before restarting, set `binaries.dablin` to `/opt/dab-edi-web-monitor/bin/dablin` and validate the configuration. The existing `dab-edi-web-monitor.service` remains available for the fixed-station interface; `dab-probe.service` provides the interactive multiplex probe. Run one mode at a time to maintain a single shared source connection. The fixed-station port is `listen.port`; the probe uses `probe.port`. For LAN access enable authentication as described above.

For local development, copy `config.example.json` to the ignored `config.local.json` and configure it; run `CONFIG=config.local.json npm run probe`, `npm test` and `npm run check`. The tracked `config.json` remains an example configuration. The installer builds the bundled DABlin source, including the integrated PAD metadata and SPI decoder; no upstream patching or system DABlin package is required.
