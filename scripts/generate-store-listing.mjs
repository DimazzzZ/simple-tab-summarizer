#!/usr/bin/env node
//
// Regenerate STORE_LISTING.md's "What's new in X.Y.Z" block from CHANGELOG.md.
//
// Motivation: The Chrome Web Store API (V2, 2025-10) has no endpoint for the
// listing description — it's editable only in the Developer Dashboard. This
// script automates the *authoring* half: it derives the store-formatted
// "What's new in X.Y.Z:" bullet block from the CHANGELOG entry for the target
// version and splices it into STORE_LISTING.md, so the release workflow can
// emit a paste-ready description as an artifact / job summary.
//
// Behavior:
//   - Parses CHANGELOG.md into per-version sections.
//   - For the target version, collects bullets under Added / Changed / Fixed
//     (Security / Tests / Refactored dropped by default — see INCLUDED_SUBSECTIONS).
//   - Mechanically strips markdown bold, links, and backticks so the store
//     block matches the flat-bullet marketing style already in STORE_LISTING.md.
//   - Rewrites STORE_LISTING.md idempotently: prepend the new block above the
//     current top-most "What's new in " line, or replace-in-place if the
//     target version's block already exists. Never touches static prose,
//     Permissions Justification, or asset sections.
//
// Modes (mutually exclusive):
//   default        write STORE_LISTING.md in place.
//   --check        exit 1 if STORE_LISTING.md has NO "What's new in <version>:"
//                  block (i.e. someone forgot to run the generator for this
//                  release). Exit 0 if a block for the version is present.
//                  This is intentionally lenient: the workflow is "mechanical
//                  transform + manual polish", so once a block exists an author
//                  may reword it without tripping the drift guard. Use
//                  --check-strict to require byte-exact generator output.
//   --check-strict exit 1 unless STORE_LISTING.md byte-matches the generated
//                  output for the version (no manual polish allowed).
//   --stdout       print only the Store Description body (intro → What's new
//                  history → How to use → Privacy → links) to stdout. This is
//                  the exact text to paste into the Dashboard.
//
// Options:
//   --version X.Y.Z   override; default reads manifest.json.
//   --changelog PATH  override; default <root>/CHANGELOG.md.
//   --listing PATH    override; default <root>/STORE_LISTING.md.
//
// Exit codes:
//   0  success (write, --stdout, or --check in-sync)
//   1  --check drift, or a fatal error (missing files, unparseable version)

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Which CHANGELOG sub-sections to include in the store "What's new" block.
// Store copy is user-facing; internal-only categories (Tests, Refactored,
// Security-as-code-hygiene) are dropped so the block stays scannable.
const INCLUDED_SUBSECTIONS = new Set(['Added', 'Changed', 'Fixed']);

// Stable delimiters in STORE_LISTING.md. Verified at repo state on 2026-09-08.
// If either delimiter goes missing, the script fails loudly rather than
// corrupting the file.
const STORE_DESCRIPTION_HEADING = '## Store Description';
const AFTER_DESCRIPTION_HEADING = '### Permissions Justification';

function parseArgs(argv) {
  const args = {
    mode: 'write', // 'write' | 'check' | 'check-strict' | 'stdout'
    version: null,
    changelogPath: path.join(ROOT_DIR, 'CHANGELOG.md'),
    listingPath: path.join(ROOT_DIR, 'STORE_LISTING.md'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.mode = 'check';
    else if (a === '--check-strict') args.mode = 'check-strict';
    else if (a === '--stdout') args.mode = 'stdout';
    else if (a === '--version') args.version = argv[++i];
    else if (a === '--changelog') args.changelogPath = path.resolve(argv[++i]);
    else if (a === '--listing') args.listingPath = path.resolve(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`❌ Unknown argument: ${a}`);
      console.error(HELP);
      process.exit(1);
    }
  }
  return args;
}

const HELP = `Usage: generate-store-listing.mjs [--check | --stdout] [--version X.Y.Z]
                                  [--changelog CHANGELOG.md] [--listing STORE_LISTING.md]

Regenerate the "What's new in X.Y.Z" block in STORE_LISTING.md from CHANGELOG.md.

  (default)  Write STORE_LISTING.md in place.
  --check        Exit non-zero if STORE_LISTING.md has no block for the version.
  --check-strict Exit non-zero unless the block byte-matches generator output.
  --stdout   Print the paste-ready Store Description body to stdout.

  --version X.Y.Z   Version to promote; defaults to manifest.json's "version".
`;

function readManifestVersion() {
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed.version) throw new Error('manifest.json has no "version" field');
  return parsed.version;
}

// -----------------------------------------------------------------------------
// CHANGELOG parsing
// -----------------------------------------------------------------------------

/**
 * Parse CHANGELOG.md into a map of version → { subsections: { name: [line...] } }.
 * Recognizes headers of the form `## [X.Y.Z] - DATE` and sub-headers `### Name`.
 */
export function parseChangelog(text) {
  const versions = new Map();
  const lines = text.split('\n');
  let currentVersion = null;
  let currentSubsection = null;

  const versionRe = /^##\s+\[([0-9]+\.[0-9]+\.[0-9]+)\]/;
  const subsectionRe = /^###\s+(.+?)\s*$/;

  for (const line of lines) {
    const vm = line.match(versionRe);
    if (vm) {
      currentVersion = vm[1];
      currentSubsection = null;
      if (!versions.has(currentVersion)) {
        versions.set(currentVersion, { subsections: {} });
      }
      continue;
    }
    if (!currentVersion) continue;

    const sm = line.match(subsectionRe);
    if (sm) {
      currentSubsection = sm[1].trim();
      const entry = versions.get(currentVersion);
      if (!entry.subsections[currentSubsection]) {
        entry.subsections[currentSubsection] = [];
      }
      continue;
    }

    // Bullet-line under a subsection (starts with "- ")
    if (currentSubsection && line.startsWith('- ')) {
      const entry = versions.get(currentVersion);
      entry.subsections[currentSubsection].push(line.slice(2));
      continue;
    }

    // Continuation lines for a bullet (indented). Append to the last bullet
    // in the current subsection so multi-line entries survive.
    if (currentSubsection && /^\s+\S/.test(line)) {
      const entry = versions.get(currentVersion);
      const bullets = entry.subsections[currentSubsection];
      if (bullets && bullets.length > 0) {
        bullets[bullets.length - 1] += ' ' + line.trim();
      }
    }
  }

  return versions;
}

// -----------------------------------------------------------------------------
// Store-voice transform
// -----------------------------------------------------------------------------

/**
 * Convert one CHANGELOG bullet (raw markdown) into a store-voice bullet body.
 * Mechanical, deterministic. Rules:
 *   - `**Bold Prefix**: rest`   → `Bold Prefix: rest`
 *   - `**inline emphasis**`     → `inline emphasis`
 *   - `[text](url)`             → `text`
 *   - Inline code `` `x` ``     → `x`
 *   - Collapse runs of whitespace to single spaces.
 */
export function storeifyBullet(raw) {
  let s = raw;

  // Bold prefix at start: **Label**: rest → Label: rest
  s = s.replace(/^\*\*([^*]+)\*\*(\s*:)/, '$1$2');
  // Remaining bold/italic emphasis: **x** → x, __x__ → x, *x* → x
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  // Inline links [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Inline code `x` → x
  s = s.replace(/`([^`]+)`/g, '$1');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Build a "What's new in X.Y.Z:" block (multi-line string, no trailing newline)
 * from a parsed version entry.
 */
export function buildWhatsNewBlock(version, versionEntry) {
  const bullets = [];
  // Preserve CHANGELOG's Added → Changed → Fixed ordering for readability.
  const order = ['Added', 'Changed', 'Fixed'];
  for (const name of order) {
    if (!INCLUDED_SUBSECTIONS.has(name)) continue;
    const items = versionEntry.subsections[name];
    if (!items) continue;
    for (const raw of items) {
      bullets.push(`- ${storeifyBullet(raw)}`);
    }
  }
  if (bullets.length === 0) {
    throw new Error(
      `No Added/Changed/Fixed bullets found for version ${version} in CHANGELOG.md`,
    );
  }
  return [`What's new in ${version}:`, ...bullets].join('\n');
}

// -----------------------------------------------------------------------------
// STORE_LISTING.md rewrite
// -----------------------------------------------------------------------------

/**
 * Rewrite STORE_LISTING.md content so its "What's new" history includes the
 * given block for `version` at the top. Idempotent: if the block for this
 * version already exists, it is replaced in place (still at its current
 * position). Otherwise the block is prepended above the current top-most
 * "What's new in " block.
 *
 * Never modifies text outside the Store Description region.
 */
export function spliceWhatsNew(listingText, version, newBlock) {
  const descStart = listingText.indexOf(STORE_DESCRIPTION_HEADING);
  const descEnd = listingText.indexOf(AFTER_DESCRIPTION_HEADING);
  if (descStart < 0) {
    throw new Error(
      `Could not find "${STORE_DESCRIPTION_HEADING}" in STORE_LISTING.md`,
    );
  }
  if (descEnd < 0 || descEnd < descStart) {
    throw new Error(
      `Could not find "${AFTER_DESCRIPTION_HEADING}" in STORE_LISTING.md`,
    );
  }

  const before = listingText.slice(0, descStart);
  const region = listingText.slice(descStart, descEnd);
  const after = listingText.slice(descEnd);

  const lines = region.split('\n');

  // Locate all existing "What's new in " block starts.
  const blockStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("What's new in ")) blockStarts.push(i);
  }

  const versionHeader = `What's new in ${version}:`;
  const newLines = newBlock.split('\n');

  const existingIdx = blockStarts.findIndex((i) => lines[i] === versionHeader);

  let updatedLines;
  if (existingIdx >= 0) {
    // Replace in place: from that header up to (but not including) the next
    // block start OR the first blank line + non-bullet line — cleanest is to
    // slice until the next "What's new in " OR the first empty line followed
    // by non-bullet content. Since existing blocks are consistently separated
    // by one blank line + next block/section, replace until next block start
    // or blank-line-then-non-bullet.
    const start = blockStarts[existingIdx];
    let end;
    if (existingIdx + 1 < blockStarts.length) {
      end = blockStarts[existingIdx + 1]; // up to next block header
      // Trim trailing blank line off the replacement window so we don't double
      // blank-lines. `end` is a "What's new..." header, and the current text
      // between them is: `<block>\n\n<next-header>`. Splicing `[start, end)`
      // means we replace everything up to (not including) the next header.
      updatedLines = [
        ...lines.slice(0, start),
        ...newLines,
        '',
        ...lines.slice(end),
      ];
    } else {
      // Last block in the region — walk forward until we hit a blank line
      // followed by a non-bullet, non-empty line (that's where the next
      // section like "How to use:" begins).
      end = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        if (lines[i] === '' && i + 1 < lines.length && !lines[i + 1].startsWith('- ') && lines[i + 1] !== '') {
          end = i; // stop at the blank line
          break;
        }
      }
      updatedLines = [
        ...lines.slice(0, start),
        ...newLines,
        ...lines.slice(end),
      ];
    }
  } else {
    // Prepend above the current top-most block.
    if (blockStarts.length === 0) {
      throw new Error(
        'STORE_LISTING.md has no existing "What\'s new in " block to anchor against',
      );
    }
    const anchor = blockStarts[0];
    updatedLines = [
      ...lines.slice(0, anchor),
      ...newLines,
      '',
      ...lines.slice(anchor),
    ];
  }

  return before + updatedLines.join('\n') + after;
}

/**
 * Extract the Store Description body (the text between the STORE_DESCRIPTION
 * heading and the "### Permissions Justification" heading) for --stdout mode.
 * Skips the "## Store Description" markdown header itself.
 */
export function extractDescriptionBody(listingText) {
  const descStart = listingText.indexOf(STORE_DESCRIPTION_HEADING);
  const descEnd = listingText.indexOf(AFTER_DESCRIPTION_HEADING);
  if (descStart < 0 || descEnd < 0) {
    throw new Error('STORE_LISTING.md is missing expected section delimiters');
  }
  const region = listingText.slice(
    descStart + STORE_DESCRIPTION_HEADING.length,
    descEnd,
  );
  return region.replace(/^\s+/, '').replace(/\s+$/, '') + '\n';
}

/**
 * Does STORE_LISTING.md already contain a "What's new in <version>:" block?
 */
export function hasVersionBlock(listingText, version) {
  return listingText.includes(`What's new in ${version}:`);
}

// -----------------------------------------------------------------------------
// Diff (simple line diff for --check output)
// -----------------------------------------------------------------------------

function simpleDiff(a, b) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const out = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      if (i < aLines.length) out.push(`- ${aLines[i]}`);
      if (i < bLines.length) out.push(`+ ${bLines[i]}`);
    }
  }
  return out.join('\n');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version || readManifestVersion();

  if (!fs.existsSync(args.changelogPath)) {
    console.error(`❌ CHANGELOG not found: ${args.changelogPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(args.listingPath)) {
    console.error(`❌ STORE_LISTING not found: ${args.listingPath}`);
    process.exit(1);
  }

  const changelogText = fs.readFileSync(args.changelogPath, 'utf8');
  const versions = parseChangelog(changelogText);
  const versionEntry = versions.get(version);
  if (!versionEntry) {
    console.error(
      `❌ Version ${version} not found in ${path.relative(ROOT_DIR, args.changelogPath)}`,
    );
    process.exit(1);
  }

  const newBlock = buildWhatsNewBlock(version, versionEntry);
  const currentListing = fs.readFileSync(args.listingPath, 'utf8');
  const nextListing = spliceWhatsNew(currentListing, version, newBlock);

  if (args.mode === 'stdout') {
    // Emit the paste-ready body. Prefer the CURRENT file so any manual polish
    // of the wording is preserved in the release artifact. Only fall back to
    // the freshly generated version when the file has no block yet (so the
    // artifact is never empty of the new release's notes).
    const source = hasVersionBlock(currentListing, version)
      ? currentListing
      : nextListing;
    process.stdout.write(extractDescriptionBody(source));
    return;
  }

  if (args.mode === 'check') {
    // Lenient: only require that *a* block for this version exists. Manual
    // polish of the wording is allowed and won't trip this guard.
    if (hasVersionBlock(currentListing, version)) {
      console.log(`✅ STORE_LISTING.md has a "What's new in ${version}" block`);
      return;
    }
    console.error(
      `❌ STORE_LISTING.md is missing a "What's new in ${version}" block. Run: npm run store:listing`,
    );
    process.exit(1);
  }

  if (args.mode === 'check-strict') {
    if (currentListing === nextListing) {
      console.log(`✅ STORE_LISTING.md is up to date for v${version}`);
      return;
    }
    console.error(
      `❌ STORE_LISTING.md is out of date for v${version}. Run: npm run store:listing`,
    );
    console.error('---');
    console.error(simpleDiff(currentListing, nextListing));
    process.exit(1);
  }

  // write mode
  if (currentListing === nextListing) {
    console.log(`✅ STORE_LISTING.md already up to date for v${version}`);
    return;
  }
  fs.writeFileSync(args.listingPath, nextListing);
  console.log(
    `📝 Updated ${path.relative(ROOT_DIR, args.listingPath)} for v${version}`,
  );
}

// Only run main() when invoked as a script, not when imported by tests.
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
