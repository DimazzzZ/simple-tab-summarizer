/**
 * Pure helpers for the "What's new" after-update feature.
 *
 * No Chrome APIs here — kept side-effect-free so it can be unit-tested in Node
 * and imported from both the service worker (background.js) and the UI
 * (ui-controller.js).
 */

/**
 * Numeric compare of two "major.minor.patch" strings.
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal. Missing parts count as 0.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Given a list of known versions and the last version the user acknowledged,
 * return the subset strictly newer than lastSeen, newest-first.
 *
 * If lastSeen is null/undefined/empty, every version is considered unseen.
 *
 * @param {string[]} allVersions - known versions (any order)
 * @param {string|null|undefined} lastSeen
 * @returns {string[]} versions > lastSeen, sorted newest-first
 */
export function versionsNewerThan(allVersions, lastSeen) {
  const list = Array.isArray(allVersions) ? [...allVersions] : [];
  const filtered = lastSeen
    ? list.filter((v) => compareVersions(v, lastSeen) > 0)
    : list;
  return filtered.sort((a, b) => compareVersions(b, a));
}
