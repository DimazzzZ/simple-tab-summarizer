#!/usr/bin/env bash
#
# generate-icons.sh — Regenerate Chrome extension PNG icons from SVG source
#
# Requirements:
#   - ImageMagick 6 or 7 (magick or convert command)
#   - SVG source file (default: icons/icon.svg)
#
# Usage:
#   ./scripts/generate-icons.sh [source_svg]
#
# Example:
#   ./scripts/generate-icons.sh icons/icon.svg
#   ./scripts/generate-icons.sh ./my-custom-icon.svg
#

set -euo pipefail

# --- Configuration ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE="${1:-$PROJECT_DIR/icons/icon.svg}"
OUTPUT_DIR="$PROJECT_DIR/icons"

# Chrome extension required sizes
SIZES=(16 48 128)

# Optional extra sizes (uncomment if you want them)
# SIZES+=(32 64 256 512)

# --- Validation ---
if [[ ! -f "$SOURCE" ]]; then
  echo "ERROR: Source SVG not found: $SOURCE" >&2
  exit 1
fi

# Detect ImageMagick command (v7 uses 'magick', v6 uses 'convert')
if command -v magick &>/dev/null; then
  IM_CMD="magick"
elif command -v convert &>/dev/null; then
  IM_CMD="convert"
else
  echo "ERROR: ImageMagick not found. Install it with: brew install imagemagick" >&2
  exit 1
fi

echo "Using ImageMagick: $IM_CMD"
echo "Source: $SOURCE"
echo "Output: $OUTPUT_DIR"
echo ""

# --- Generate icons ---
mkdir -p "$OUTPUT_DIR"

for size in "${SIZES[@]}"; do
  output="$OUTPUT_DIR/icon${size}.png"
  
  $IM_CMD \
    -background none \
    -density 1200 \
    "$SOURCE" \
    -resize "${size}x${size}!" \
    -filter Lanczos \
    -strip \
    "$output"
  
  # Verify output
  if [[ -f "$output" ]]; then
    actual_size=$($IM_CMD identify -format "%wx%h" "$output" 2>/dev/null || echo "unknown")
    echo "✓ Generated $output ($actual_size)"
  else
    echo "✗ Failed to generate $output" >&2
    exit 1
  fi
done

echo ""
echo "Done! All icons regenerated in $OUTPUT_DIR"
