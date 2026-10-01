# Changelog

All notable changes to PA System are documented here.

## [Unreleased]

### Added
- Dashboard as the landing page: ready/setup banner, next scheduled cue, now
  playing, schedule state, input source, music state, audio-file completeness
- Activity log on the dashboard, newest at the bottom, with a button to open the
  log folder
- `npm run verify:paths`, which checks `pa-media://` path resolution on Windows,
  macOS and Linux
- Self-test now runs on the Windows CI job, not only on macOS

### Fixed
- **Windows: all cues were silent.** A `pa-media://` URL pathname always starts
  with `/`, but a Windows absolute path begins with a drive letter, so
  `path.resolve` produced `\C:\C:\...` and every lookup 404'd. The test tone
  still worked because it is synthesised in Web Audio and never reads a file,
  which made it look like a speaker problem rather than a code one.
- Audio decode failures are now written to the app log instead of only the
  devtools console, so a broken file is visible when reporting a problem

## [0.2.2] — 2026-10-01

### Added
- School attribution in the app footer: Sirindhorn Planetarium Suankularb
  Wittayalai School
- School name in the Windows installer publisher metadata, and a "Provided for
  use by" line in the LICENSE and README

Copyright holder is unchanged: Apiwish Anutaravanichkul, MIT License.

## [0.2.1] — 2026-10-01

### Added
- Separate volume control for the PA Start / PA Finish chimes (`volChime`,
  default 0.55), on its own `chime` gain bus

### Fixed
- PA Start and PA Finish stings were riding the announcement bus at full level,
  which read much louder than speech; existing configs pick up the quieter
  default automatically with no migration

## [0.2.0] — 2026-10-01

### Added
- System-audio (loopback) input and line-in/device input selection
- Input tab with source picker, level trim and feedback warning
- BGM import with automatic destination creation and self-healing track selection
- TV test tone: steady 1 kHz beep and repeating `beep-beep-beep` interval signal
- End-of-announcement sound, resolved by filename aliases (`end`, `close`, …)
- Menu-bar / system-tray background operation with schedule pause
- Launch-at-login in hidden mode
- Auto-update from GitHub Releases: hourly check, background download, install on quit
- Application icon derived from `system.png`

### Changed
- BGM and input ducking now uses click-free gain ramps instead of hard cuts
- Settings persistence is debounced and flushed on quit, so slider drags stay smooth
- Version is now `0.2.0`

### Fixed
- System-audio capture no longer rejects when no video source is present
- Bell/BGM silence bug caused by a null saved track with the toggle enabled
- Music import failures when the destination directory did not exist
- Emergency cue no longer interrupted by the announcement end sound

### Known issues
- macOS builds are unsigned: Gatekeeper prompts on first launch, and macOS
  cannot self-update until a Developer ID certificate is configured
- Windows builds are unsigned: SmartScreen shows an "unknown publisher" warning
- System-audio capture records the whole output device, so a line-in source is
  recommended to avoid feedback
