# Changelog

## Unreleased

- Replace the probe's long EPG list with a station and local-day programme guide, programme details, and an independent on-air indicator.
- Keep the last valid guide visible when updates fail, show its update time and flag data older than one hour as potentially stale.
- Add Czech, English and German guide labels and regression tests for bearer selection, local time, daylight saving, midnight and live updates.
- Show compact local times, mark repeated DST hours and automatically follow the current programme until a manual selection.
- Add an allowlisted public source export, Raspberry Pi installation templates and loopback-first service configuration.
- Protect probe endpoints with configured authentication and same-origin checks; bound EPG and slide responses.
- Require the bundled DABlin path at service preflight and verify EPG diagnostics during installation.
- Install the bundled console DABlin without SDL or GTK under `/opt/dab-edi-web-monitor`, retain the existing configuration path and provide separate fixed-station and interactive probe units.
- Preserve configuration during updates and require a preflight check before either systemd service starts.
