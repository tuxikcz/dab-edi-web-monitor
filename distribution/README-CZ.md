# DAB PROBE

Webový monitor DAB/DAB+ multiplexu z ETI-NI nebo EDI AF přes TCP s přehráváním MP3, DL/DL+, MOT Slideshow a SPI/EPG. Nejde o RF přijímač. Omezení SPI dekodéru jsou popsána v `vendor/dablin-epg/README.md`.

Cílová platforma je Raspberry Pi 4/5 s 64bitovým Raspberry Pi OS nebo Debianem 12/13 ARM64. Raspberry Pi 3 a 32bitový systém jsou experimentální. Instalace zatím nebyla ověřena na fyzickém Raspberry Pi. Před instalací zajistěte Node.js 20 či novější v `/usr/bin/node` z důvěryhodného zdroje; výchozí verze v Debianu 12 může být starší.

## Instalace a konfigurace

```sh
sudo ./install.sh
sudo nano /etc/dab-probe/config.json
sudo node /opt/dab-probe/scripts/check-public-config.js /etc/dab-probe/config.json
sudo systemctl enable --now dab-probe
sudo systemctl status dab-probe
journalctl -u dab-probe -f
```

Instalátor přes apt zajistí závislosti, lokálně sestaví DABlin bez SDL a ověří jeho základní rozhraní. Binárka je v `/opt/dab-probe/bin`, systémový `/usr/local/bin/dablin` se nemění. Služba se sama neaktivuje ani nespustí. Opakované `sudo ./install.sh` zachová existující konfiguraci; po aktualizaci službu podle potřeby restartujte `sudo systemctl restart dab-probe`.

Vyplňte `edi.host`, `edi.port` a `edi.format` (`eti` nebo `edi`); bez zdroje preflight spuštění odmítne. Web standardně naslouchá jen na `127.0.0.1`, port určuje `probe.port` (8090). Vzdáleně lze použít SSH tunel `ssh -L 8090:127.0.0.1:8090 user@your-pi`. Jazyk nastavuje `ui.language` (`cz`, `en`, `de`). `metadata.enabled` společně zapíná DL/DL+ a slideshow, `epg.enabled` EPG worker. Sekce `watchdog`, `audio`, `stream` a `stations` nastavují timeouty, audio a volitelný server pevných stanic. V probe se stanice vyhledá a vybere na webu.

Pro přístup z LAN zapněte `auth.enabled` a nastavte vlastní neprázdné jméno a heslo před změnou `listen.host`. Preflight odmítne LAN bez autentizace. HTTP Basic není šifrovaný: pro vzdálený přístup použijte správně nastavenou HTTPS reverse proxy. Přístup dovolte jen důvěryhodným uživatelům; probe může navazovat spojení na jimi zadané síťové cíle. Nevystavujte službu přímo internetu.

## Zdroje a odstranění

Za běžného provozu jeden TCP zdroj sdílí audio worker a EPG worker; discovery a detekce formátu používají krátkodobá samostatná spojení. EPG DABlin nespouští s vybranou audio službou. Počet současných stanic ovlivňuje CPU i RAM; ověřený limit pro Raspberry Pi zatím není k dispozici.

```sh
sudo systemctl disable --now dab-probe
sudo rm -f /etc/systemd/system/dab-probe.service
sudo systemctl daemon-reload
sudo rm -rf /opt/dab-probe
```

Konfigurace `/etc/dab-probe/config.json` a systémový účet zůstanou zachovány. Opakovaná instalace konfiguraci nepřepíše.

## Licence

DAB PROBE má licenci MIT. Přiložený DABlin je GPL-3.0-or-later, knihovna FEC má samostatnou licenci LGPL-2.1. Viz `LICENSE`, `vendor/dablin-epg/COPYING`, `vendor/dablin-epg/fec/LICENSE` a hlavičky zdrojů.

Existující konfigurace se zachová. Před spuštěním musí `binaries.dablin` ukazovat na `/opt/dab-probe/bin/dablin`; preflight jinou binárku odmítne.
