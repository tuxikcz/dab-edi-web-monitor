# DAB EDI web monitor

Jednoduchy interní webovy prehravac DAB/DAB+ sluzeb z EDI streamu. Node.js drzi jedno TCP spojeni k multiplexu, kopiruje EDI do samostatne rizene instance DABlinu pro kazdou nakonfigurovanou stanici a FFmpeg prevadi WAV/PCM na MP3 pro prohlizec.

Projekt nepouziva shellovou pipeline. Pri padu, zatuhnuti nebo ucpani DABlinu ci FFmpegu Node ukonci obe procesni skupiny a spusti cely dekodovaci retezec znovu. Systemd ma navic `KillMode=control-group`, takze po restartu sluzby nezustanou sirotci.

## Pozadavky

- Linux, doporucen Debian 12/13
- Node.js 20 nebo novejsi
- DABlin
- FFmpeg s `libmp3lame`

Na Debianu:

```bash
apt update
apt install nodejs dablin ffmpeg
```

## Rychly test bez instalace

```bash
cd dab-edi-web-monitor
npm run check
npm run test-edi
npm start
```

Web pak posloucha na:

```text
http://IP_SERVERU:8088/
```

Pouze MP3 stream bez weboveho rozhrani spustite:

```bash
npm run stream
```

Pro jednu nakonfigurovanou stanici je stream dostupny na:

```text
http://IP_SERVERU:8088/stream.mp3
```

Pro vice stanic pouzijte ID z `config.json`:

```text
http://IP_SERVERU:8088/stream/first.mp3
http://IP_SERVERU:8088/first.mp3
```

V externim HTML5 prehravaci pak staci:

```html
<audio controls src="http://IP_SERVERU:8088/stream.mp3"></audio>
```

Vychozi endpoint je nastaven na:

```text
93.185.96.156:15000
```

Tento endpoint posila ETI-NI data, proto ma v `config.json` nastaveno:

```json
"format": "eti"
```

Pro skutecny EDI AF vstup pouzijte `"format": "edi"`.

## Nastaveni stanic

Soubor `config.json` obsahuje pro prvni test vyber prvni nalezene sluzby:

```json
{
  "id": "first",
  "name": "Prvni sluzba multiplexu",
  "selector": { "type": "serviceIndex", "value": 1 }
}
```

`serviceIndex` vybira audio sluzbu podle poradi SubChId, ktere DABlin vypisuje
u radku `audio service (SubChId ...)`. Hodnota `1` znamena nejmensi SubChId,
`2` dalsi atd. Pri startu aplikace se kratce spusti diagnostika DABlinu, index
se prevede na SID a vlastni stream se potom spusti stabilne pres SID.

Delku teto uvodni diagnostiky lze nastavit:

```json
"stream": {
  "discoverSeconds": 8
}
```

Jazyk weboveho rozhrani lze nastavit v konfiguraci:

```json
"ui": {
  "language": "cz"
}
```

Podporovane hodnoty jsou `cz`, `en` a `de`.

DL texty, DL+ metadata a MOT slideshow obrazky vyzaduji DABlin s patchem
`patches/dablin-pad-metadata.patch`. Po instalaci patchnuteho DABlinu je lze
zapnout v konfiguraci:

```json
"metadata": {
  "enabled": true,
  "slideDir": "/tmp/dab-edi-web-monitor-metadata"
}
```

Web potom zobrazi posledni textova metadata a aktualni slideshow obrazek
u vybrane stanice. Bez patchnuteho DABlinu ponechte `enabled` na `false`.

### Patch DABlinu pro PAD metadata

Bezny konzolovy DABlin posila na stdout jen audio data. Patch
`patches/dablin-pad-metadata.patch` doplni volby:

- `-j` zapisuje DL/DL+/slideshow udalosti jako JSON lines na stderr;
- `-J <adresar>` dela to same a navic uklada posledni MOT slideshow obrazek.

Priklad sestaveni na Debianu:

```bash
apt update
apt install git build-essential cmake pkg-config libfaad-dev libmpg123-dev
git clone https://github.com/Opendigitalradio/dablin.git /tmp/dablin-src
cd /tmp/dablin-src
git apply /cesta/k/dab-edi-web-monitor/patches/dablin-pad-metadata.patch
cmake -S . -B build -DDISABLE_SDL=1
cmake --build build --target dablin -j"$(nproc)"
sudo install -m 0755 build/src/dablin /usr/local/bin/dablin
```

Po instalaci overte, ze DABlin zna nove volby:

```bash
/usr/local/bin/dablin -h | grep -- "-J"
```

Pak lze v konfiguraci zapnout `metadata.enabled`. Pokud aplikace po zapnuti
skonci hlaskou typu `unrecognized option`, stale se pouziva nepatchnuty DABlin
nebo konfigurace `binaries.dablin` ukazuje na jinou binarku.

Pokud DABlin skonci hlaskou `SDL output was disabled, so PCM output must be
selected!` i pri argumentu `-w`, byl pravdepodobne sestaven ze starsi verze
tohoto patche. Aktualizujte patch, znovu spustte `cmake --build ...` a binarku
znovu nainstalujte.

Pro stabilni produkcni pouziti nastavte konkretni SID:

```json
{
  "id": "hey",
  "name": "HEY Radio",
  "selector": { "type": "sid", "value": "0x24F8" }
}
```

Nebo presny label:

```json
{
  "id": "hey",
  "name": "HEY Radio",
  "selector": { "type": "label", "value": "HEY Radio" }
}
```

Do pole `stations` lze pridat libovolny pocet sluzeb. Pro kazdou bezi vlastni DABlin a FFmpeg, ale vsechny dostavaji data z jednoho sdileneho EDI TCP spojeni.

## Diagnostika endpointu

Pouhy TCP test a objem dat:

```bash
npm run test-edi
```

Delka testu v sekundach:

```bash
TEST_SECONDS=30 npm run test-edi
```

Textova diagnostika DABlinu bez prehravani:

```bash
DISCOVER_SECONDS=30 npm run discover
```

Automaticke parsovani seznamu sluzeb neni v teto prvni verzi implementovano, protoze format konzoloveho vystupu se mezi verzemi DABlinu lisi. Webovy vyber zobrazuje sluzby zadane v `config.json`.

## Systemova instalace

```bash
sudo ./install.sh
```

Konfigurace se instaluje do:

```text
/etc/dab-edi-web-monitor/config.json
```

Prikazy:

```bash
systemctl status dab-edi-web-monitor
journalctl -u dab-edi-web-monitor -f
systemctl restart dab-edi-web-monitor
```

Po zmene konfigurace:

```bash
systemctl restart dab-edi-web-monitor
```

## Watchdog

Kontroluji se tri nezavisle body:

1. zda z TCP socketu prichazeji EDI data;
2. zda DABlin vydava WAV/PCM;
3. zda FFmpeg vydava MP3.

Pri prekroceni timeoutu se shodi obe procesni skupiny pomoci `SIGTERM`, po kratkem timeoutu `SIGKILL`, a dekoder se znovu spusti. Pomaly webovy klient je odpojen, aby nemohl zaplnit pamet ani zastavit dekodovani.

## Volitelne heslo

V `config.json`:

```json
"auth": {
  "enabled": true,
  "username": "monitor",
  "password": "zmente-me"
}
```

Pri vystaveni do internetu je vhodne dat aplikaci za HTTPS reverse proxy. Pro nginx vypnete buffering streamu:

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

- `GET /api/status` – stav EDI a dekoderu
- `GET /api/stations` – seznam nakonfigurovanych stanic
- `GET /stream/ID.mp3` – MP3 stream
- `POST /api/restart/ID` – rucni restart dekoderu
- `GET /healthz` – HTTP 200, pokud je EDI online a alespon jedna stanice streamuje
