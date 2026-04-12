/**
 * Content Script for Tab Group Summarizer — Fast Path Only
 * 
 * Optimized for speed: uses textContent (no layout-triggering innerText),
 * stops early after collecting enough content, and avoids heavy DOM scans.
 * 
 * Strategy:
 * 1. Domain-specific extraction (GitHub, etc.)
 * 2. Fast targeted selectors with textContent
 * 3. Metadata fallback (title, meta, headings, first paragraphs)
 */

(function() {
  'use strict';

  const MAX_CHARS = 4000;
  const MIN_GOOD_CONTENT = 150;

  /**
   * Main entry
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
   * Clean and truncate text
   */
  function truncate(text) {
    if (!text) return '';
    return text
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .filter((l, i, a) => i === 0 || l !== a[i - 1])
      .filter(l => l.length < 3 || /[a-zA-Z0-9]{3,}/.test(l))
      .join('\n')
      .substring(0, MAX_CHARS);
  }

  return extractContent();
})();
