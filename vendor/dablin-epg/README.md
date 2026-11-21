# DABlin with SPI/EPG

## About

This is a fork of [DABlin](https://github.com/Opendigitalradio/dablin) with native DAB Service and Programme Information (SPI/MOT) electronic programme guide support for the console and GTK applications. DABlin plays DAB and DAB+ services from ETI or EDI streams and recordings; it does not receive or demodulate RF by itself.

## Features

- ETI-NI input and EDI AF input, from files or standard input.
- DAB (MP2) and DAB+ (AAC) audio decoding.
- Dynamic Label (DLS) and MOT Slideshow in the GTK application.
- Native SPI/EPG reception and decoding from a signalled MSC packet component.
- GTK programme guide with station and day selection, local times and programme details.
- Console EPG export to JSON, with optional decoding diagnostics.

## Build dependencies

A C and C++ compiler with C++11 support, CMake 3.10 or later, pkg-config, POSIX threads, libmpg123, FAAD2, SDL2 and an iconv implementation are required for the default build. The bundled Reed–Solomon FEC library also uses the system maths library. gtkmm 3 is needed for `dablin_gtk`; without it only the console application is built. On systems without native atomic support, GCC's libatomic is also required. On glibc systems iconv is provided by libc.

For Debian 12/13 or Ubuntu, install the build tools and libraries with:

```sh
sudo apt update
sudo apt install build-essential cmake pkg-config libmpg123-dev libfaad-dev libsdl2-dev libgtkmm-3.0-dev
```

FDK-AAC can be used instead of FAAD2 when an `fdk-aac` or `fdk-aac-dabplus` development package is available: configure with `-DUSE_FDK-AAC=1`. For PCM-only output without an SDL dependency, configure with `-DDISABLE_SDL=1` and use `-p` when selecting audio playback.

## Build

```sh
cmake -S . -B build
cmake --build build -j"$(nproc)"
```

The resulting executables are `build/src/dablin` and, when gtkmm 3 is installed, `build/src/dablin_gtk`. To install them and their manual pages, run `sudo cmake --install build`. No Python runtime or external EPG generator is required.

## Usage

Display command-line options with:

```sh
build/src/dablin -h
build/src/dablin_gtk -h
```

After installation the commands are `dablin -h` and `dablin_gtk -h`. As in
upstream DABlin, the help option prints usage and exits with status 1.

For an ETI-NI stream over TCP, pipe the bytes to the GTK player:

```sh
nc SERVER PORT | build/src/dablin_gtk
```

To export EPG from an ETI-NI stream, use:

```sh
nc SERVER PORT | build/src/dablin -I --epg-json epg.json
```

A complete supported carousel must be received before the JSON file is written. Use `--epg-diagnostics` with `--epg-json` for packet, CRC, MOT and SPI diagnostics on standard error. Programme times in JSON are UTC. Existing audio selection options can be used while EPG is received.

For **EDI AF** input, select the EDI parser:

```sh
nc SERVER PORT | build/src/dablin_gtk -f edi
nc SERVER PORT | build/src/dablin -f edi -I --epg-json epg.json
```

ETI-NI and EDI AF have different framing. Use the default ETI mode for an ETI/TCP stream; do **not** pass `-f edi` to an ETI stream. A filename may be supplied instead of piping a stream. `-I` disables catch-up after an interruption.

In GTK, open the programme guide with the **EPG** button or the `e` key. Choose a station and day to see programme times and details. Times are converted to the computer's local timezone; the currently playing programme is highlighted. The guide updates after complete carousel reception and retains the last complete guide after packet errors.

## Limitations

SPI support is experimental and implements a subset of ETSI SPI/MOT. The receiver currently selects the first supported signalled SPI component, although its guide can describe multiple stations. A complete supported carousel is needed for an update. Supported programme bearers use explicit ensemble identifiers and 16-bit programme SIDs; token tables, default or implicit bearers, multiple locations, fractional-second times, compressed or conditional-access MOT objects, MOT header mode, compressed directories and packet-mode FEC are not supported. EDI AF is supported; EDI PFT fragmentation is not. Full service expiry, multiplex reconfiguration and all carousel update variants are not implemented. Availability of EPG, Dynamic Label and Slideshow depends on the broadcaster.

## Credits

DABlin was created by Stefan Pöschel and is maintained upstream by the [OpenDigitalRadio project](https://github.com/Opendigitalradio/dablin). This is a derived version with SPI/EPG extensions by DABlin contributors. Source files retain their original copyright notices. The bundled FEC code derives from Phil Karn, KA9Q's libfec; see `fec/README.md`.

## License

DABlin is distributed under the GNU General Public License, version 3 or later; see [COPYING](COPYING) and individual source headers. The bundled libfec component has a separate GNU Lesser General Public License, version 2.1; see [fec/LICENSE](fec/LICENSE) and the notices in `fec/`.
