/**
 * Content Script for Tab Group Summarizer — Fast Path + Dynamic Content Support
 * 
 * Optimized for speed: uses textContent (no layout-triggering innerText),
 * stops early after collecting enough content, and avoids heavy DOM scans.
 * 
 * Strategy:
 * 1. Domain-specific extraction (GitHub, etc.)
 * 2. Fast targeted selectors with textContent
 * 3. Wait for dynamic content hydration (for JS-heavy sites)
 * 4. Metadata fallback (title, meta, headings, first paragraphs)
 */

(function() {
  'use strict';

  const MAX_CHARS = 4000;
  const MIN_GOOD_CONTENT = 150;
  const MAX_WAIT_MS = 3000;
  const POLL_INTERVAL_MS = 300;

  /**
   * Main entry — supports both sync and async (wait-for-content) modes
   */
  function extractContent() {
    const hostname = window.location.hostname || '';

    // Domain-specific
    if (hostname.includes('github.com')) {
      const gh = extractGitHub();
      if (gh.length > MIN_GOOD_CONTENT) return truncate(gh);
    }

    // Fast path: try article/main with textContent
    const fast = extractFast();
    if (fast.length > MIN_GOOD_CONTENT) return truncate(fast);

    // Fallback: metadata + headings + first paragraphs
    return truncate(extractMetadata());
  }

  /**
   * Async entry — waits for content to hydrate on dynamic pages
   * Returns a Promise that resolves with the extracted text
   */
  async function extractContentAsync() {
    const hostname = window.location.hostname || '';

    // Domain-specific (sync, usually fast)
    if (hostname.includes('github.com')) {
      const gh = extractGitHub();
      if (gh.length > MIN_GOOD_CONTENT) return truncate(gh);
    }

    // Fast path: try article/main with textContent
    let fast = extractFast();
    if (fast.length > MIN_GOOD_CONTENT) return truncate(fast);

    // Wait for dynamic content to hydrate
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);

      // Check if article/main now has content
      fast = extractFast();
      if (fast.length > MIN_GOOD_CONTENT) return truncate(fast);

      // Also check body for substantial content
      const bodyText = document.body ? (document.body.textContent || '') : '';
      if (bodyText.trim().length > MIN_GOOD_CONTENT * 2) {
        return truncate(bodyText);
      }
    }

    // Fallback: metadata + headings + first paragraphs
    return truncate(extractMetadata());
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fast extraction using textContent (no layout recalc)
   */
  function extractFast() {
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.main-content',
      '#main-content',
      '.post-content',
      '.article-content',
      '.story-body',
      '.article-body',
      '.markdown-body',
      '.entry-content',
      '.post-body',
      '.content',
      '#content'
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent || '';
          if (text.trim().length > MIN_GOOD_CONTENT) {
            return text;
          }
        }
      } catch (e) {}
    }
    return '';
  }

  /**
   * GitHub-specific: repo info + README
   */
  function extractGitHub() {
    const parts = [];

    try {
      const name = document.querySelector('[itemprop="name"] a, [itemprop="name"]');
      if (name) parts.push('Repo: ' + name.textContent.trim());
    } catch (e) {}

    try {
      const desc = document.querySelector('[itemprop="description"]');
      if (desc) parts.push('Description: ' + desc.textContent.trim());
    } catch (e) {}

    try {
      const topics = document.querySelector('.topics-list');
      if (topics) parts.push('Topics: ' + topics.textContent.trim().replace(/\s+/g, ', '));
    } catch (e) {}

    try {
      const readme = document.querySelector('#readme article, .markdown-body');
      if (readme) {
        const t = readme.textContent.trim();
        if (t.length > 50) parts.push('README:\n' + t);
      }
    } catch (e) {}

    return parts.join('\n\n');
  }

  /**
   * Metadata fallback: title, meta, headings, first paragraphs
   */
  function extractMetadata() {
    const parts = [];

    try {
      if (document.title) parts.push('Title: ' + document.title);
    } catch (e) {}

    try {
      const meta = document.querySelector('meta[name="description"]');
      if (meta && meta.content) parts.push('Description: ' + meta.content);
    } catch (e) {}

    try {
      const og = document.querySelector('meta[property="og:description"]');
      if (og && og.content) parts.push('OG: ' + og.content);
    } catch (e) {}

    try {
      const headings = document.querySelectorAll('h1, h2, h3');
      if (headings.length > 0) {
        const hTexts = [];
        for (let i = 0; i < Math.min(headings.length, 12); i++) {
          const t = headings[i].textContent.trim();
          if (t) hTexts.push(t);
        }
        if (hTexts.length > 0) parts.push('Headings:\n' + hTexts.map((h, i) => `${i + 1}. ${h}`).join('\n'));
      }
    } catch (e) {}

    try {
      const paras = document.querySelectorAll('p');
      if (paras.length > 0) {
        const pTexts = [];
        for (let i = 0; i < Math.min(paras.length, 6); i++) {
          const t = paras[i].textContent.trim();
          if (t.length > 20) pTexts.push(t);
        }
        if (pTexts.length > 0) parts.push('Content:\n' + pTexts.join('\n\n'));
      }
    } catch (e) {}

    return parts.join('\n\n');
  }

  /**
   * Clean and truncate text (Unicode-safe)
   */
  function truncate(text) {
    if (!text) return '';
    return text
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .filter((l, i, a) => i === 0 || l !== a[i - 1])
      // Keep lines with any 3+ word characters (Unicode-aware)
      .filter(l => l.length < 3 || /\p{L}|\p{N}/u.test(l))
      .join('\n')
      .substring(0, MAX_CHARS);
  }

  // Expose async version for dynamic pages
  window.__tabSummarizerExtractAsync = extractContentAsync;

  // Sync fallback for immediate extraction
  return extractContent();
})();
