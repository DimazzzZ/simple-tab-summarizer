/**
 * Content Script for Tab Group Summarizer
 * 
 * This script is injected into each tab to extract the main text content.
 * Uses a fast-path-first strategy with lightweight fallbacks.
 * 
 * Optimizations:
 * - Fast extraction: stops after finding the first good content block
 * - Domain-aware extraction (GitHub, docs, landing pages)
 * - Aggressive boilerplate removal
 * - Lower character cap to reduce token costs
 * - Lightweight metadata fallback for timeout-heavy pages
 */

(function() {
  'use strict';

  const MAX_CHARS = 4000;
  const MIN_GOOD_CONTENT = 200; // chars needed to consider extraction "good"

  /**
   * Main entry: extract content using the best available strategy
   */
  function extractContent() {
    const hostname = window.location.hostname || '';

    // Domain-specific extraction
    if (hostname.includes('github.com')) {
      const ghContent = extractGitHubContent();
      if (ghContent.length > MIN_GOOD_CONTENT) return cleanContent(ghContent);
    }

    // Fast path: try targeted selectors, stop at first good match
    const fastResult = extractFastPath();
    if (fastResult.length > MIN_GOOD_CONTENT) {
      return cleanContent(fastResult);
    }

    // Slow path: broader extraction
    const slowResult = extractSlowPath();
    if (slowResult.length > MIN_GOOD_CONTENT) {
      return cleanContent(slowResult);
    }

    // Last resort: metadata + headings
    return cleanContent(extractMetadataFallback());
  }

  /**
   * Fast path: use querySelector (single match) for top selectors
   * Stops as soon as we find enough content
   */
  function extractFastPath() {
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

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.innerText || '';
          if (text.trim().length > MIN_GOOD_CONTENT) {
            return text;
          }
        }
      } catch (e) {
        // Selector might be invalid, skip
      }
    }

    return '';
  }

  /**
   * Slow path: broader extraction using querySelectorAll
   * but limited to top 3 matches per selector
   */
  function extractSlowPath() {
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.post',
      '.article',
      '.entry',
      '.field-body',
      '.text-content'
    ];

    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          const texts = Array.from(elements)
            .slice(0, 3) // limit to top 3 matches
            .map(el => el.innerText || '')
            .filter(text => text.trim().length > 50)
            .join('\n\n');
          
          if (texts.length > MIN_GOOD_CONTENT) {
            return texts;
          }
        }
      } catch (e) {
        // Skip invalid selectors
      }
    }

    return '';
  }

  /**
   * GitHub-specific extraction: prioritize README, repo info
   */
  function extractGitHubContent() {
    const parts = [];

    // Repo name and description
    try {
      const repoName = document.querySelector('[itemprop="name"] a, [itemprop="name"]');
      if (repoName) {
        parts.push('Repository: ' + repoName.innerText.trim());
      }
    } catch (e) {}

    try {
      const description = document.querySelector('[itemprop="description"]');
      if (description) {
        parts.push('Description: ' + description.innerText.trim());
      }
    } catch (e) {}

    // Topics/tags
    try {
      const topics = document.querySelector('.topics-list');
      if (topics) {
        parts.push('Topics: ' + topics.innerText.trim().replace(/\s+/g, ', '));
      }
    } catch (e) {}

    // README content
    try {
      const readme = document.querySelector('#readme article, .markdown-body');
      if (readme) {
        const readmeText = readme.innerText.trim();
        if (readmeText.length > 50) {
          parts.push('README:\n' + readmeText);
        }
      }
    } catch (e) {}

    return parts.join('\n\n');
  }

  /**
   * Lightweight fallback: extract metadata, headings, and first paragraphs
   * Used when normal extraction fails or times out
   */
  function extractMetadataFallback() {
    const parts = [];

    // Page title
    try {
      const title = document.title || '';
      if (title) parts.push('Title: ' + title);
    } catch (e) {}

    // Meta description
    try {
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc && metaDesc.content) {
        parts.push('Description: ' + metaDesc.content);
      }
    } catch (e) {}

    // OG description
    try {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc && ogDesc.content) {
        parts.push('OG Description: ' + ogDesc.content);
      }
    } catch (e) {}

    // All headings
    try {
      const headings = document.querySelectorAll('h1, h2, h3');
      if (headings.length > 0) {
        const headingTexts = Array.from(headings)
          .slice(0, 15)
          .map(h => h.innerText.trim())
          .filter(t => t.length > 0);
        if (headingTexts.length > 0) {
          parts.push('Headings:\n' + headingTexts.map((h, i) => `${i + 1}. ${h}`).join('\n'));
        }
      }
    } catch (e) {}

    // First few paragraphs
    try {
      const paragraphs = document.querySelectorAll('p, .markdown-body p, article p');
      if (paragraphs.length > 0) {
        const paraTexts = Array.from(paragraphs)
          .slice(0, 8)
          .map(p => p.innerText.trim())
          .filter(t => t.length > 30);
        if (paraTexts.length > 0) {
          parts.push('Content:\n' + paraTexts.join('\n\n'));
        }
      }
    } catch (e) {}

    return parts.join('\n\n');
  }

  /**
   * Clean and normalize extracted content
   */
  function cleanContent(text) {
    if (!text) return '';

    return text
      // Remove excessive whitespace
      .replace(/\n{3,}/g, '\n\n')
      // Remove lines that are just whitespace
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      // Remove duplicate consecutive lines
      .filter((line, i, arr) => i === 0 || line !== arr[i - 1])
      // Remove very short lines that are likely UI noise
      .filter(line => line.length < 3 || /[a-zA-Z0-9]{3,}/.test(line))
      .join('\n')
      // Limit to reasonable length
      .substring(0, MAX_CHARS);
  }

  // Extract and return the content
  return extractContent();
})();
