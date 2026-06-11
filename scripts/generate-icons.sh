#!/usr/bin/env bash
#
# Generate platform app icons from build/icon.svg.
#
# Produces:
#   build/icons/icon.icns  -> macOS .app bundle + DMG volume icon
#   build/icons/icon.ico   -> Windows (app + Squirrel installer)
#   build/icons/icon.png   -> Linux (512x512, deb/rpm)
#
# macOS-only: relies on `qlmanage` (high-quality SVG rasterizer) and `iconutil`.
# The generated files are committed, so CI on any platform can package without
# this toolchain. Re-run this only when build/icon.svg changes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/build/icon.svg"
OUT="$ROOT/build/icons"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ -f "$SRC" ] || { echo "error: $SRC not found" >&2; exit 1; }
command -v qlmanage >/dev/null || { echo "error: qlmanage required (macOS)" >&2; exit 1; }
command -v iconutil >/dev/null || { echo "error: iconutil required (macOS)" >&2; exit 1; }
command -v sips     >/dev/null || { echo "error: sips required (macOS)" >&2; exit 1; }

mkdir -p "$OUT"

# 1. Rasterize a 1024px master PNG via macOS Quick Look (best SVG fidelity here).
qlmanage -t -s 1024 -o "$TMP" "$SRC" >/dev/null 2>&1
MASTER="$TMP/master.png"
mv "$TMP/$(basename "$SRC").png" "$MASTER"
# Force exact square canvas in case Quick Look padded the thumbnail.
sips -z 1024 1024 "$MASTER" >/dev/null

# 2. macOS .icns via iconset.
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
for spec in \
  "16:icon_16x16" "32:icon_16x16@2x" \
  "32:icon_32x32" "64:icon_32x32@2x" \
  "128:icon_128x128" "256:icon_128x128@2x" \
  "256:icon_256x256" "512:icon_256x256@2x" \
  "512:icon_512x512" "1024:icon_512x512@2x"; do
  size="${spec%%:*}"; name="${spec##*:}"
  sips -z "$size" "$size" "$MASTER" --out "$ICONSET/$name.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT/icon.icns"

# 3. Linux 512x512 PNG.
sips -z 512 512 "$MASTER" --out "$OUT/icon.png" >/dev/null

# 4. Windows .ico (multi-resolution). Prefer ImageMagick; warn if absent.
if command -v magick >/dev/null || command -v convert >/dev/null; then
  IM="$(command -v magick || command -v convert)"
  for s in 16 24 32 48 64 128 256; do
    sips -z "$s" "$s" "$MASTER" --out "$TMP/ico_$s.png" >/dev/null
  done
  "$IM" "$TMP/ico_16.png" "$TMP/ico_24.png" "$TMP/ico_32.png" \
        "$TMP/ico_48.png" "$TMP/ico_64.png" "$TMP/ico_128.png" \
        "$TMP/ico_256.png" "$OUT/icon.ico"
else
  echo "warning: ImageMagick not found; skipped icon.ico (Windows)" >&2
fi

echo "Generated:"
ls -la "$OUT"
