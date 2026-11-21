# SPI/EPG remaining work

- Verify ETI and EDI input against real recordings and 10.0.200.37:14000 (COLOR DAB+ JC: ECC E2, EID 2107, HEY Radio SID 24F8, SPI subchannel 30, packet address 1).
- Verify repeated carousel updates, reconnects, multiplex changes, and EPG reception simultaneously with audio, DL+ and slideshow.
- Add integration regression fixtures for SPI decoding, worker restart and playback coexistence; expand UI and API tests.
- Review worker lifecycle, simultaneous probe/play requests, service and programme expiry, and installation on a clean host.
- Commit the verified changes when Git metadata is writable; leave aaaaaaa.png untracked.
