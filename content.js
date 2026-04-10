/**
 * Content Script for Tab Group Summarizer
 * 
 * This script is injected into each tab to extract the main text content.
 * It uses smart selectors to find the main content area and falls back
 * to document.body.innerText if needed.
 */

(function() {
  'use strict';

  /**
   * Extract main content from the page
   * Uses various selectors to find article/main content areas
   */
  function extractContent() {
    // List of selectors to try, in order of preference
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.main-content',
      '#main-content',
      '.content',
      '#content',
      '.post',
      '.article',
      '.entry',
      '#entry',
      '.post-content',
      '.article-content',
      '.story-body',
      '.article-body',
      '[data-testid="article"]',
      '[data-testid="content"]',
      '.markdown-body', // GitHub, Medium
      '.post-body',
      '.entry-content', // WordPress
      '.field-body',
      '.text-content'
    ];

    let content = '';
    let found = false;

    // Try each selector
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        const texts = Array.from(elements)
          .map(el => el.innerText)
          .filter(text => text && text.trim().length > 100) // Filter out very short content
          .join('\n\n');
        
        if (texts.length > 100) {
          content = texts;
          found = true;
          break;
        }
      }
    }

    // Fallback to body content if no specific content area found
    if (!found) {
      // Try to remove common non-content elements
      const bodyClone = document.body.cloneNode(true);
      const elementsToRemove = [
        'nav',
        'header',
        'footer',
        'aside',
        '.sidebar',
        '#sidebar',
        '.navigation',
        '#navigation',
        '.nav',
        '.menu',
        '.header',
        '.footer',
        '.ad',
        '.ads',
        '.advertisement',
        '.cookie-banner',
        '#cookie-banner',
        '.popup',
        '.modal',
        '.overlay',
        'script',
        'style',
        'noscript',
        'iframe',
        '.social-share',
        '.comments',
        '#comments'
      ];

      elementsToRemove.forEach(sel => {
        const els = bodyClone.querySelectorAll(sel);
        els.forEach(el => el.remove());
      });

      content = bodyClone.innerText;
    }

    // Clean up the content
    content = cleanContent(content);

    return content;
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
      .join('\n')
      // Limit to reasonable length (avoid token overflow)
      .substring(0, 50000); // ~50k chars per page
  }

  // Extract and return the content
  return extractContent();
})();
