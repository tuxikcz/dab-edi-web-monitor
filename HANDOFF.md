# SPI/EPG handoff

DAB PROBE uses the bundled DABlin SPI decoder and the existing PAD metadata integration. The EPG worker subscribes to the shared EdiSource; `/api/epg` exposes its last complete guide and update time. The decoder, audio, DL+ and slideshow pipelines were not changed by the programme-guide UI work.

The user reports live EPG for HEY Radio on COLOR DAB+ (EID `0x2117`) alongside working audio and DL+. This report does not establish a live slideshow regression result. The original PAD patch remains in `patches/`; build instructions are in the README.

The probe page provides bearer-based station selection, a local calendar day, a programme table and details. Times use the browser's timezone, including daylight-saving changes; a programme appears on every local day it overlaps. The on-air marker is independent of row selection. The page polls `/api/epg` every five seconds, retains its last valid guide on errors or incomplete responses and reports a guide as potentially stale after one hour without a successful update. The one-hour threshold is a UI policy, not a decoder timeout. CRC errors are handled by the existing decoder/cache; the UI cannot report individual CRC errors unless the API reports an error or the guide becomes stale.

Run `npm test` and `npm run check`. The guide tests use synthetic data and cover bearers, timezones, DST, midnight, selection, updates, stale data and translations. A browser check with a live multiplex remains useful for deployment-specific reception and layout.
