# Changelog

All notable changes to PA System are documented here.

## [0.2.0] — unreleased

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