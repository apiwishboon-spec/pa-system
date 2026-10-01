#!/usr/bin/env bash
#
#  PA System · macOS installer
#  -------------------------------------------------------------------------
#  macOS cannot self-update an unsigned app, so this script does it for you:
#  it asks GitHub for the newest release, downloads it, and replaces the copy in
#  /Applications. Your settings and music library live in ~/Library and are
#  never touched.
#
#      curl -fsSL https://raw.githubusercontent.com/apiwishboon-spec/pa-system/main/install-macos.sh | bash
#
#  Re-run it whenever you want the latest version. There is nothing to
#  uninstall and no version number to look up.
#
#  Optional environment variables:
#      PA_INSTALL_DIR   where to install (default: /Applications)
#      PA_NO_LAUNCH=1   install without asking to open the app
#
set -euo pipefail

REPO="apiwishboon-spec/pa-system"
APP_NAME="PA System"
INSTALL_DIR="${PA_INSTALL_DIR:-/Applications}"
API="https://api.github.com/repos/${REPO}/releases/latest"

# ------------------------------------------------------------------ output
# Colour is dropped when stdout is not a terminal, which is the case when this
# script is piped from curl. Without that guard every message arrives wrapped in
# literal escape sequences.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[0m'
  RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'
else
  B=""; DIM=""; R=""; RED=""; GRN=""; YEL=""; CYN=""
fi

STEP=0

rule()   { printf '%s%s%s\n' "$DIM" "────────────────────────────────────────────────────────────" "$R"; }
banner() {
  printf '\n%s%s  PA System%s %s· macOS installer%s\n' "$B" "$CYN" "$R" "$DIM" "$R"
  rule
}
step() {
  STEP=$((STEP + 1))
  printf '\n%s[%d]%s %s%s%s\n' "$DIM" "$STEP" "$R" "$B" "$1" "$R"
}
note() { printf '    %s%s%s\n' "$DIM" "$1" "$R"; }
good() { printf '    %s✓%s %s\n' "$GRN" "$R" "$1"; }
warn() { printf '    %s!%s %s%s%s\n' "$YEL" "$R" "$YEL" "$1" "$R" >&2; }
fail() { printf '\n    %s✗ %s%s\n' "$RED" "$1" "$R" >&2; exit 1; }

# A spinner only makes sense on a terminal; a static message is used otherwise
# so piped logs stay readable.
if [ -t 1 ]; then
  spin_start() {
    SPIN_MSG="$1"
    ( while :; do
        printf '\r    %s⠋%s %s' "$CYN" "$R" "$SPIN_MSG"
        sleep 0.1
        printf '\r    %s⠙%s %s' "$CYN" "$R" "$SPIN_MSG"
        sleep 0.1
        printf '\r    %s⠹%s %s' "$CYN" "$R" "$SPIN_MSG"
        sleep 0.1
        printf '\r    %s⠸%s %s' "$CYN" "$R" "$SPIN_MSG"
        sleep 0.1
        printf '\r    %s⠼%s %s' "$CYN" "$R" "$SPIN_MSG"
        sleep 0.1
        printf '\r    %s⠴%s %s' "$CYN" "$R" "$SPIN_MSG"
        sleep 0.1
        printf '\r    %s⠦%s %s' "$CYN" "$R" "$SPIN_MSG"
        sleep 0.1
        printf '\r    %s⠧%s %s' "$CYN" "$R" "$SPIN_MSG"
        sleep 0.1
        printf '\r    %s⠇%s %s' "$CYN" "$R" "$SPIN_MSG"
        sleep 0.1
        printf '\r    %s⠏%s %s' "$CYN" "$R" "$SPIN_MSG"
        sleep 0.1
      done ) &
      SPIN_PID=$!
  }
  spin_stop() {
    # `wait` is what suppresses bash's "Terminated" job notice; without it the
    # killed spinner leaks a job-control message into the output.
    [ -n "${SPIN_PID:-}" ] && kill "$SPIN_PID" 2>/dev/null || true
    wait "${SPIN_PID:-}" 2>/dev/null || true
    printf '\r\033[K'
    SPIN_PID=""
  }
else
  spin_start() { note "$1"; SPIN_PID=""; }
  spin_stop()  { :; }
fi

# ------------------------------------------------------------- preflight
command -v curl >/dev/null || fail "curl is required"

[ "$(uname -s)" = "Darwin" ] ||
  fail "this installer is for macOS. On Windows, download PA-System-Setup-<version>.exe from the releases page."

banner

# ----------------------------------------------------------- find the latest
step "Looking up the latest release"

spin_start "Asking GitHub…"
RELEASE_JSON="$(curl -fsSL "$API")" || SPIN_OK=0
spin_stop
[ "${SPIN_OK:-1}" = "1" ] || fail "could not reach GitHub. Check your connection and try again."

# The asset name is version-stamped, so match on the extension rather than a
# hardcoded filename.
DMG_URL="$(printf '%s' "$RELEASE_JSON" |
  grep -oE '"browser_download_url": "[^"]*\.dmg"' |
  sed 's/.*: "//; s/"$//' |
  head -1 || true)"

[ -n "$DMG_URL" ] ||
  DMG_URL="$(printf '%s' "$RELEASE_JSON" | grep -oE 'https://[^"]*\.dmg' | head -1 || true)"

[ -n "$DMG_URL" ] || fail "the latest release has no macOS disk image. Try a previous release from the releases page."

VERSION="$(printf '%s' "$DMG_URL" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
[ -n "$VERSION" ] || VERSION="unknown"
LATEST="${VERSION#v}"

good "latest release is ${B}v${LATEST}${R}"

# ------------------------------------------------------- already up to date?
# Read the version from Info.plist. Electron does not reliably print a version
# for --version on macOS, so PlistBuddy is the dependable source.
step "Checking what is installed"

PLIST="$INSTALL_DIR/$APP_NAME.app/Contents/Info.plist"
INSTALLED_VER=""
if [ -f "$PLIST" ]; then
  INSTALLED_VER="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST" 2>/dev/null || true)"
  good "$APP_NAME ${INSTALLED_VER} is installed"
else
  note "no existing copy in ${INSTALL_DIR}"
fi

if [ -n "$INSTALLED_VER" ] && [ "$INSTALLED_VER" = "$LATEST" ]; then
  printf '\n%s%s  Already up to date.%s  %sv%s\n' "$GRN" "$B" "$R" "$DIM" "$LATEST"
  rule
  exit 0
fi

# --------------------------------------------------------------- download
step "Downloading v${LATEST}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --progress-bar is only drawn on a terminal, so fall back to a plain message.
if [ -t 1 ]; then
  curl -fL --progress-bar -o "$TMP/pa-system.dmg" "$DMG_URL" ||
    fail "download failed. Check your connection, then re-run this command."
else
  note "downloading…"
  curl -fsSL -o "$TMP/pa-system.dmg" "$DMG_URL" ||
    fail "download failed. Check your connection, then re-run this command."
fi

SIZE="$(du -h "$TMP/pa-system.dmg" | cut -f1 | tr -d ' ')"
good "saved ${SIZE}"

# ------------------------------------------------------------ close the app
step "Closing the running app, if any"

if pgrep -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" >/dev/null 2>&1; then
  osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
  sleep 1
  # A PA can sit in the tray all week; kill it if a normal quit was not enough.
  if pgrep -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" >/dev/null 2>&1; then
    warn "it did not quit on its own, force-quitting"
    pkill -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" || true
    sleep 1
  fi
  good "closed"
else
  note "not running"
fi

# --------------------------------------------------------------- install
step "Installing to ${INSTALL_DIR}"

spin_start "Mounting disk image…"
MOUNT="$(hdiutil attach "$TMP/pa-system.dmg" -nobrowse -readonly 2>/dev/null |
  grep -oE '/Volumes/.*' | head -1 || true)"
spin_stop
[ -n "$MOUNT" ] || fail "could not mount the downloaded disk image."

cleanup_mount() { hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true; }
trap 'cleanup_mount; rm -rf "$TMP"' EXIT

if [ ! -d "$INSTALL_DIR" ]; then
  warn "$INSTALL_DIR does not exist, creating it"
  mkdir -p "$INSTALL_DIR" || fail "cannot write to $INSTALL_DIR"
fi

# A plain `mv` over a running-or-quarantined app leaves a stale bundle behind,
# so remove first.
rm -rf "$INSTALL_DIR/$APP_NAME.app"
spin_start "Copying the app…"
cp -R "$MOUNT/$APP_NAME.app" "$INSTALL_DIR/" || {
  spin_stop
  fail "copy failed. Your user account may not be allowed to write to $INSTALL_DIR."
}
spin_stop
good "copied"

cleanup_mount
trap 'rm -rf "$TMP"' EXIT

# Unsigned builds are quarantined by Gatekeeper. Clear it so the app opens.
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME.app" 2>/dev/null || true
good "cleared the quarantine flag (the build is unsigned)"

# ---------------------------------------------------------------- summary
step "Done"

if [ -n "$INSTALLED_VER" ]; then
  note "upgraded  ${DIM}${INSTALLED_VER} → ${LATEST}${R}"
else
  note "installed ${DIM}v${LATEST}${R}"
fi
note "app      ${DIM}${INSTALL_DIR}/${APP_NAME}.app${R}"

rule
printf '%s%s  PA System v%s is ready.%s\n\n' "$GRN" "$B" "$LATEST" "$R"

# Offer to start it back up, but only in an interactive session. When piped from
# curl, stdin is the script itself, so prompting there would consume the input
# instead of asking anything.
LAUNCH="${PA_NO_LAUNCH:-}"
if [ -z "$LAUNCH" ] && [ -t 0 ]; then
  printf '  Open PA System now? [Y/n] '
  read -r reply
  case "$reply" in
    [nN]*) ;;
    *) open "$INSTALL_DIR/$APP_NAME.app" ;;
  esac
  printf '\n'
fi

note "Re-run this command any time to fetch a newer release."
printf '\n'