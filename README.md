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

Kterou stanici ze `stations[]` ma stream-only server pouzit pro `/stream.mp3`,
urcuje nulovy index v konfiguraci:

```json
"stream": {
  "stationIndex": 0
}
```

Hodnota `0` znamena prvni stanici v poli `stations`, `1` druhou atd.
Pokud `stationIndex` nechate `null`, stream-only server spusti vsechny stanice
a `/stream.mp3` bude dostupne jen v pripade, ze je nakonfigurovana prave jedna
stanice.

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
  "selector": { "type": "first" }
}
```

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
