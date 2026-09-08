#!/usr/bin/env node
//
// Import-graph completeness check for a packaged extension directory.
//
// The manifest validator (validate-extension-files.mjs) only checks files
// listed in manifest.json (service_worker, popup, side_panel, content_scripts,
// icons, web_accessible_resources, ...). It does NOT check ES-module imports
// like `import { x } from './api/codex-client.js'`.
//
// This script closes that gap: starting from every JS entry point referenced
// by the manifest, it recursively resolves every static `import ... from '...'`
// and `export ... from '...'` specifier that begins with `.` or `/` and
// verifies the target file exists inside the packaged extension. A missing
// import means the caller (background.js, popup.js, ...) will fail at load
// time in Chrome, so we fail the build here instead.
//
// Deliberately out of scope:
//   - dynamic `import(...)` calls (not a copy-completeness concern for us)
//   - bare specifiers ('lodash') — the extension ships no node_modules
//   - URL-schemed imports (http://, chrome-extension://)
//
// Usage: node scripts/validate-extension-imports.mjs <packaged-extension-dir>

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const extensionRoot = path.resolve(process.argv[2] || '.');
const manifestPath = path.join(extensionRoot, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`❌ Missing manifest.json in ${extensionRoot}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// -----------------------------------------------------------------------------
// Collect JS entry points from the manifest
// -----------------------------------------------------------------------------

const entryPoints = new Set();

function addJsEntry(value) {
  if (typeof value !== 'string' || value.length === 0) return;
  if (!value.endsWith('.js')) return;
  entryPoints.add(value.replace(/^\/+/, ''));
}

function addHtmlEntry(value) {
  if (typeof value !== 'string' || value.length === 0) return;
  if (!value.endsWith('.html')) return;
  const htmlPath = path.join(extensionRoot, value.replace(/^\/+/, ''));
  if (!fs.existsSync(htmlPath)) return;
  const html = fs.readFileSync(htmlPath, 'utf8');
  // Grab <script src="..."> targets (both module and classic).
  const scriptRe = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    const src = m[1];
    if (/^(?:https?:|chrome-extension:|data:)/i.test(src)) continue;
    // Resolve HTML-relative src to a repo-root-relative path.
    const htmlDir = path.dirname(value.replace(/^\/+/, ''));
    const resolved = path.posix.normalize(path.posix.join(htmlDir, src));
    if (resolved.endsWith('.js')) entryPoints.add(resolved);
  }
}

addJsEntry(manifest.background?.service_worker);
addHtmlEntry(manifest.action?.default_popup);
addHtmlEntry(manifest.side_panel?.default_path);
addHtmlEntry(manifest.options_page);
addHtmlEntry(manifest.options_ui?.page);

for (const cs of manifest.content_scripts || []) {
  for (const js of cs.js || []) addJsEntry(js);
}

for (const group of manifest.web_accessible_resources || []) {
  for (const res of group.resources || []) {
    if (typeof res === 'string' && res.endsWith('.js') && !res.includes('*')) {
      addJsEntry(res);
    }
  }
}

// -----------------------------------------------------------------------------
// Walk the import graph
// -----------------------------------------------------------------------------

// Match top-level `import ... from 'spec'`, `export ... from 'spec'`, and
// side-effect `import 'spec'` — all with either quote style. Deliberately
// avoids matching import(...) dynamic form.
//
// Group 1 (double-quoted) or Group 2 (single-quoted) captures the specifier.
const staticImportRe =
  /(?:^|[\s;])(?:import|export)\s+(?:[^'";]+?\s+from\s+)?(?:"([^"]+)"|'([^']+)')/g;

const visited = new Set();
const missing = []; // { importer, specifier, resolved }

function resolveSpecifier(fromFile, specifier) {
  // Only relative and absolute-project imports are copy-completeness concerns.
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;

  const fromDir = path.dirname(fromFile);
  let candidate;
  if (specifier.startsWith('/')) {
    candidate = path.join(extensionRoot, specifier);
  } else {
    candidate = path.resolve(extensionRoot, fromDir, specifier);
  }

  // Enforce that resolved path stays inside the extension root.
  const rel = path.relative(extensionRoot, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  // Try the literal path, then common ESM extension fallbacks.
  const attempts = [
    candidate,
    `${candidate}.js`,
    `${candidate}.mjs`,
    path.join(candidate, 'index.js'),
    path.join(candidate, 'index.mjs')
  ];
  for (const attempt of attempts) {
    if (fs.existsSync(attempt) && fs.statSync(attempt).isFile()) {
      return path.relative(extensionRoot, attempt);
    }
  }
  return null; // unresolved — will be reported as missing
}

function walk(relFile, importer) {
  if (visited.has(relFile)) return;
  visited.add(relFile);

  const absFile = path.join(extensionRoot, relFile);
  if (!fs.existsSync(absFile)) {
    missing.push({ importer: importer || '(manifest entry point)', specifier: relFile, resolved: null });
    return;
  }

  const source = fs.readFileSync(absFile, 'utf8');
  staticImportRe.lastIndex = 0;
  let m;
  while ((m = staticImportRe.exec(source)) !== null) {
    const specifier = m[1] || m[2];
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;

    const resolved = resolveSpecifier(relFile, specifier);
    if (resolved === null) {
      missing.push({ importer: relFile, specifier, resolved: null });
      continue;
    }
    walk(resolved, relFile);
  }
}

for (const entry of entryPoints) {
  walk(entry, null);
}

// -----------------------------------------------------------------------------
// Report
// -----------------------------------------------------------------------------

if (missing.length > 0) {
  for (const m of missing) {
    console.error(
      `❌ Missing imported module: '${m.specifier}' (imported from ${m.importer})`
    );
  }
  process.exit(1);
}

console.log(
  `✅ Validated ${visited.size} module(s) reachable from ${entryPoints.size} manifest entry point(s) in ${extensionRoot}`
);
