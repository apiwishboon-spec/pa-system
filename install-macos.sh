#!/usr/bin/env bash
#
# PA System installer for macOS.
#
# macOS cannot self-update an unsigned app, so this script does it for you:
# it asks GitHub for the newest release, downloads it, and replaces the copy in
# /Applications.
#
#   curl -fsSL https://raw.githubusercontent.com/apiwishboon-spec/pa-system/main/install-macos.sh | bash
#
# Re-run it whenever you want the latest version. There is nothing to uninstall
# and no version number to look up.

set -euo pipefail

REPO="apiwishboon-spec/pa-system"
APP_NAME="PA System"
INSTALL_DIR="${PA_INSTALL_DIR:-/Applications}"
API="https://api.github.com/repos/${REPO}/releases/latest"

info() { printf '\033[1m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null || die "curl is required"

[ "$(uname -s)" = "Darwin" ] || die "this installer is for macOS; Windows users should download PA-System-Setup-<version>.exe"

# --------------------------------------------------------------- find latest
info "Checking for the latest release"

# The asset name is version-stamped, so match on the extension instead of a
# hardcoded filename. Falls back to the API's JSON `url` if the grep misses.
DMG_URL="$(
  curl -fsSL "$API" |
    grep -oE '"browser_download_url": "[^"]*\.dmg"' |
    sed 's/.*: "//; s/"$//' |
    head -1
)" || true

if [ -z "$DMG_URL" ]; then
  DMG_URL="$(curl -fsSL "$API" | grep -oE 'https://[^"]*\.dmg' | head -1)"
fi

[ -n "$DMG_URL" ] || die "could not find a macOS download in the latest release"

VERSION="$(printf '%s' "$DMG_URL" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
info "Latest version: ${VERSION:-unknown}"

# ----------------------------------------------------------- already current?
# Read the version from Info.plist. Electron does not reliably print a version
# for --version on macOS, so PlistBuddy is the dependable source.
INSTALLED_VER=""
PLIST="$INSTALL_DIR/$APP_NAME.app/Contents/Info.plist"
if [ -f "$PLIST" ]; then
  INSTALLED_VER="$(
    /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST" 2>/dev/null || true
  )"
fi

if [ -n "$INSTALLED_VER" ] && [ "$INSTALLED_VER" = "${VERSION#v}" ]; then
  info "Already up to date (${INSTALLED_VER})"
  exit 0
fi
[ -n "$INSTALLED_VER" ] && info "Installed: ${INSTALLED_VER}"

# ------------------------------------------------------------- download
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info "Downloading"
curl -fL --progress-bar -o "$TMP/pa-system.dmg" "$DMG_URL" ||
  die "download failed: $DMG_URL"

# ----------------------------------------------------------------- install
info "Stopping any running instance"
osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
sleep 1
# A PA can sit in the tray all week; kill it if a normal quit was not enough.
if pgrep -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" >/dev/null 2>&1; then
  warn "app did not quit on its own, force-quitting"
  pkill -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" || true
  sleep 1
fi

info "Mounting disk image"
MOUNT="$(hdiutil attach "$TMP/pa-system.dmg" -nobrowse -readonly |
  grep -oE '/Volumes/.*' | head -1)"
[ -n "$MOUNT" ] || die "could not mount the disk image"

cleanup_mount() {
  hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
}
trap 'cleanup_mount; rm -rf "$TMP"' EXIT

if [ ! -d "$INSTALL_DIR" ]; then
  warn "$INSTALL_DIR does not exist, creating it"
  mkdir -p "$INSTALL_DIR" || die "cannot write to $INSTALL_DIR"
fi

# A plain `mv` over a running-or-quarantined app leaves a stale bundle behind,
# so remove first. User settings and the music library live in ~/Library and
# are untouched by this.
info "Installing to $INSTALL_DIR"
rm -rf "$INSTALL_DIR/$APP_NAME.app"
cp -R "$MOUNT/$APP_NAME.app" "$INSTALL_DIR/" ||
  die "copy failed (try: sudo $0)"

cleanup_mount
trap 'rm -rf "$TMP"' EXIT

# Unsigned builds are quarantined by Gatekeeper. Clear it so the app opens.
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME.app" 2>/dev/null || true

info "Installed $APP_NAME ${VERSION#v} to $INSTALL_DIR"

# Offer to start it back up, but only in an interactive session.
if [ -t 0 ]; then
  read -r -p "Open PA System now? [y/N] " reply
  case "$reply" in
    [yY]*) open "$INSTALL_DIR/$APP_NAME.app" ;;
  esac
fi

printf '\n\033[32mDone.\033[0m Re-run this script any time to fetch the latest release.\n'