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
# DIST_DIR defaults to $ROOT_DIR/dist. Tests may override it to point at a
# temp fixture dir (see tests/unit/test-package-cleanup.mjs) so the real
# packaging script can be exercised without touching the repo's dist/.
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist}"
mkdir -p "$DIST_DIR"

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

# Remove previously packaged ZIPs so dist only holds the current build's output.
# Scoped to our own naming pattern (simple-tab-summarizer-v*.zip) inside DIST_DIR
# via a nullglob loop — never a broad rm on the directory.
shopt -s nullglob
for old_zip in "$DIST_DIR"/simple-tab-summarizer-v*.zip; do
  echo "Removing old package: $(basename "$old_zip")"
  rm -f "$old_zip"
done
shopt -u nullglob

# Copy runtime extension files only
cp "$ROOT_DIR/manifest.json" "$BUILD_DIR/"
cp "$ROOT_DIR/background.js" "$BUILD_DIR/"
cp "$ROOT_DIR/content.js" "$BUILD_DIR/"
cp "$ROOT_DIR/shadow-monkeypatch-world.js" "$BUILD_DIR/"
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

# Copy runtime module directories
for dir in api constants dom features lifecycle render sync utils; do
  if [ -d "$ROOT_DIR/$dir" ]; then
    cp -R "$ROOT_DIR/$dir" "$BUILD_DIR/"
  fi
done

# Validate that every file referenced by the packaged manifest is present
node "$ROOT_DIR/scripts/validate-extension-files.mjs" "$BUILD_DIR"

# Validate that every statically-imported ES module is present in the package.
# The manifest does not list ESM imports (e.g. background.js imports
# ./api/codex-client.js), so the manifest validator alone cannot catch a module
# omitted from the copy list above. This walks the import graph from the
# manifest entry points and fails loudly if any imported file is missing.
node "$ROOT_DIR/scripts/validate-extension-imports.mjs" "$BUILD_DIR"

# Create ZIP (manifest.json at root level)
rm -f "$DIST_DIR/$ZIP_NAME"
cd "$BUILD_DIR"
zip -r "$DIST_DIR/$ZIP_NAME" .

echo "✅ Packaged extension to: $DIST_DIR/$ZIP_NAME"
