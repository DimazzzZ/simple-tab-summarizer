#!/usr/bin/env bash
#
# Package the extension into a clean ZIP for Chrome Web Store submission.
#
# Usage:
#   ./scripts/package-extension.sh [VERSION]
#
# If VERSION is not provided, it reads from manifest.json.
# Output: dist/simple-tab-summarizer-v<VERSION>.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

# Read version from manifest.json if not provided
if [ -z "${1:-}" ]; then
  VERSION=$(node -e "console.log(require('$ROOT_DIR/manifest.json').version)")
else
  VERSION="$1"
fi

ZIP_NAME="simple-tab-summarizer-v${VERSION}.zip"
BUILD_DIR="$DIST_DIR/simple-tab-summarizer"

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Copy runtime extension files only
cp "$ROOT_DIR/manifest.json" "$BUILD_DIR/"
cp "$ROOT_DIR/background.js" "$BUILD_DIR/"
cp "$ROOT_DIR/content.js" "$BUILD_DIR/"
cp "$ROOT_DIR/popup.html" "$BUILD_DIR/"
cp "$ROOT_DIR/popup.js" "$BUILD_DIR/"
cp "$ROOT_DIR/sidebar.html" "$BUILD_DIR/"
cp "$ROOT_DIR/sidebar.js" "$BUILD_DIR/"
cp "$ROOT_DIR/styles.css" "$BUILD_DIR/"
cp "$ROOT_DIR/ui-controller.js" "$BUILD_DIR/"
cp "$ROOT_DIR/LICENSE" "$BUILD_DIR/"
cp "$ROOT_DIR/PRIVACY.md" "$BUILD_DIR/"

# Copy icons directory
cp -R "$ROOT_DIR/icons" "$BUILD_DIR/"

# Create ZIP (manifest.json at root level)
cd "$BUILD_DIR"
zip -r "$DIST_DIR/$ZIP_NAME" .

echo "✅ Packaged extension to: $DIST_DIR/$ZIP_NAME"
