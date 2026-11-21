# SPI/EPG remaining work

- Verify slideshow concurrently with live EPG, audio and DL+; the user has confirmed EPG, audio and DL+ on COLOR DAB+ EID `0x2117`.
- Exercise the programme guide in a browser against a live carousel, including multiplex changes, network interruptions and longer reception intervals.
- Add integration fixtures for SPI decoding, repeated carousel updates, worker restart and playback coexistence.
- Review worker lifecycle, simultaneous probe/play requests, service and programme expiry, and installation on a clean host.
