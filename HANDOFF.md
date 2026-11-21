# SPI/EPG handoff

The bundled source snapshot is derived from dablin-epg-public commit b355d89; its console includes the existing PAD integration adapted to the SPI changes. `scripts/build-dablin.sh` builds it without modifying the reference repository. The original metadata patch is retained. `/api/epg` serves an in-memory copy of the last published JSON, and the probe UI displays it in the configured language. The EPG process subscribes to the same EdiSource as audio.

The sandbox refused TCP access to 10.0.200.37:14000. No live carousel or concurrent audio, DL+ and slideshow test has been performed. Git metadata is read-only, so no commit was possible. Do not treat this work as a completed integration until the TODO items are resolved.
