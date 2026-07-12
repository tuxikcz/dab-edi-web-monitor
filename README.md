# DAB EDI web monitor

A simple internal web player for DAB/DAB+ services from an EDI stream. Node.js keeps one TCP connection to the multiplex, copies EDI data into a separately supervised DABlin instance for each configured station, and FFmpeg converts WAV/PCM to MP3 for the browser.

The project does not use a shell pipeline. If DABlin or FFmpeg crashes, stalls, or gets blocked, Node terminates both process groups and starts the whole decoding chain again. The systemd unit also uses `KillMode=control-group`, so no orphaned processes remain after a service restart.

## Requirements

- Linux, Debian 12/13 recommended
- Node.js 20 or newer
- DABlin
- FFmpeg with `libmp3lame`

On Debian:

```bash
apt update
apt install nodejs dablin ffmpeg
```

## Quick Test Without Installation

```bash
cd dab-edi-web-monitor
npm run check
npm run test-edi
npm start
```

The web UI then listens on:

```text
http://SERVER_IP:8088/
```

To start only the MP3 stream without the web UI:

```bash
npm run stream
```

For one configured station, the stream is available at:

```text
http://SERVER_IP:8088/stream.mp3
```

For multiple stations, use the ID from `config.json`:

```text
http://SERVER_IP:8088/stream/first.mp3
http://SERVER_IP:8088/first.mp3
```

In an external HTML5 player, use:

```html
<audio controls src="http://SERVER_IP:8088/stream.mp3"></audio>
```

The default endpoint is set to:

```text
93.185.96.156:15000
```

This endpoint sends ETI-NI data, so `config.json` uses:

```json
"format": "eti"
```

For a real EDI AF input, use `"format": "edi"`.

## Station Configuration

The `config.json` file contains a first-test setup that selects the first discovered service:

```json
{
  "id": "first",
  "name": "First multiplex service",
  "selector": { "type": "serviceIndex", "value": 1 }
}
```

`serviceIndex` selects an audio service by the SubChId order printed by DABlin on lines containing `audio service (SubChId ...)`. Value `1` means the lowest SubChId, `2` means the next one, and so on. On application startup, a short DABlin discovery run is executed, the index is converted to a SID, and the actual stream then starts using that SID.

The length of this initial discovery can be configured:

```json
"stream": {
  "discoverSeconds": 8
}
```

The web UI language can be configured:

```json
"ui": {
  "language": "cz"
}
```

Supported values are `cz`, `en`, and `de`.

DL text, DL+ metadata, and MOT slideshow images require DABlin with the `patches/dablin-pad-metadata.patch` patch. After installing the patched DABlin, enable metadata in the configuration:

```json
"metadata": {
  "enabled": true,
  "slideDir": "/tmp/dab-edi-web-monitor-metadata"
}
```

The web UI will then show the latest text metadata and the current slideshow image for the selected station. Without a patched DABlin, keep `enabled` set to `false`.

### DABlin Patch For PAD Metadata

The normal console version of DABlin writes only audio data to stdout. The `patches/dablin-pad-metadata.patch` patch adds these options:

- `-j` writes DL/DL+/slideshow events as JSON lines to stderr;
- `-J <dir>` does the same and also writes the latest MOT slideshow image to a directory.

Example build on Debian:

```bash
apt update
apt install git build-essential cmake pkg-config libfaad-dev libmpg123-dev
git clone https://github.com/Opendigitalradio/dablin.git /tmp/dablin-src
cd /tmp/dablin-src
git apply /path/to/dab-edi-web-monitor/patches/dablin-pad-metadata.patch
cmake -S . -B build -DDISABLE_SDL=1
cmake --build build --target dablin -j"$(nproc)"
sudo install -m 0755 build/src/dablin /usr/local/bin/dablin
```

After installation, verify that DABlin knows the new options:

```bash
/usr/local/bin/dablin -h | grep -- "-J"
```

Then enable `metadata.enabled` in the configuration. If the application exits with an `unrecognized option` message after enabling it, it is still using an unpatched DABlin, or `binaries.dablin` points to a different binary.

If DABlin exits with `SDL output was disabled, so PCM output must be selected!` even with the `-w` argument, it was probably built from an older version of this patch. Update the patch, run `cmake --build ...` again, and reinstall the binary.

For stable production use, configure a specific SID:

```json
{
  "id": "hey",
  "name": "HEY Radio",
  "selector": { "type": "sid", "value": "0x24F8" }
}
```

Or an exact label:

```json
{
  "id": "hey",
  "name": "HEY Radio",
  "selector": { "type": "label", "value": "HEY Radio" }
}
```

Any number of services can be added to the `stations` array. Each one runs its own DABlin and FFmpeg process, but all of them receive data from one shared EDI TCP connection.

## Endpoint Diagnostics

Basic TCP test and received data volume:

```bash
npm run test-edi
```

Test duration in seconds:

```bash
TEST_SECONDS=30 npm run test-edi
```

Text-only DABlin diagnostics without playback:

```bash
DISCOVER_SECONDS=30 npm run discover
```

Automatic parsing of the service list is not implemented in this first version because the console output format differs between DABlin versions. The web selection shows services defined in `config.json`.

## System Installation

```bash
sudo ./install.sh
```

The configuration is installed to:

```text
/etc/dab-edi-web-monitor/config.json
```

Commands:

```bash
systemctl status dab-edi-web-monitor
journalctl -u dab-edi-web-monitor -f
systemctl restart dab-edi-web-monitor
```

After changing the configuration:

```bash
systemctl restart dab-edi-web-monitor
```

## Watchdog

Three independent points are monitored:

1. whether EDI data is coming from the TCP socket;
2. whether DABlin is producing WAV/PCM;
3. whether FFmpeg is producing MP3.

When a timeout is exceeded, both process groups are terminated with `SIGTERM`, then with `SIGKILL` after a short timeout, and the decoder is started again. A slow web client is disconnected so it cannot fill memory or stop decoding.

## Optional Password

In `config.json`:

```json
"auth": {
  "enabled": true,
  "username": "monitor",
  "password": "change-me"
}
```

When exposing the application to the internet, it should be placed behind an HTTPS reverse proxy. For nginx, disable stream buffering:

```nginx
location / {
    proxy_pass http://127.0.0.1:8088;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 1h;
}
```

## API

- `GET /api/status` - EDI and decoder status
- `GET /api/stations` - list of configured stations
- `GET /stream/ID.mp3` - MP3 stream
- `POST /api/restart/ID` - manual decoder restart
- `GET /healthz` - HTTP 200 if EDI is online and at least one station is streaming
