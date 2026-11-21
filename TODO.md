# SPI/EPG remaining work

- Verify slideshow concurrently with live EPG, audio and DL+; the user has confirmed EPG, audio and DL+ on COLOR DAB+ EID `0x2117`.
- Exercise the programme guide in a browser against a live carousel, including multiplex changes, network interruptions and longer reception intervals.
- Add integration fixtures for SPI decoding, repeated carousel updates, worker restart and playback coexistence.
- Review worker lifecycle, simultaneous probe/play requests, service and programme expiry, and installation on a clean host.
- Test public installer, upgrades, configuration preservation, removal and reinstall on clean Debian 12/13 ARM64 and Raspberry Pi 4/5; Node.js 20+ must be provisioned on systems with older distro packages.
- Conduct full security testing, including proxy configuration, malformed data, client limits and concurrent requests, before public release.
- Verify responsive layout and repeated-hour tooltips in real browsers and on touch devices.
- With writable Git metadata, stage the public `config.json` example with the managed DABlin path without overwriting local configuration changes.
- Confirm `origin/master` with `git fetch`; network DNS was unavailable in the sandbox.
