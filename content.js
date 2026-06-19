(function() {
  'use strict';

  const MAX_CHARS = 50000;
  const MIN_CONTENT = 3000;
  const MAX_WAIT_MS = 15000;
  const POLL_INTERVAL_MS = 300;

  function getShadowRoot(el) {
    return el.shadowRoot || el.__shadowRootForSummarizer;
  }

  function collectVisibleText(root) {
    if (!root) return '';

    let parts = [];

    if (root.nodeType === Node.ELEMENT_NODE) {
      const sr = getShadowRoot(root);
      const text = sr ? (root.textContent || '') : (root.innerText || '');
      if (text.trim()) parts.push(text);

      if (sr) {
        for (const child of sr.childNodes) {
          const ct = collectVisibleText(child);
          if (ct.trim()) parts.push(ct);
        }
      }

      try {
        const descendants = root.querySelectorAll('*');
        for (const el of descendants) {
          const sr2 = getShadowRoot(el);
          if (sr2 && sr2 !== sr) {
            for (const child of sr2.childNodes) {
              const ct = collectVisibleText(child);
              if (ct.trim()) parts.push(ct);
            }
          }
        }
      } catch (e) {}
    }

    if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const child of root.childNodes) {
        const ct = collectVisibleText(child);
        if (ct.trim()) parts.push(ct);
      }
    }

    return parts.join('\n');
  }

  function extractGoogleDocsText() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const t = s.textContent || '';
        if (t.includes('DOCS_modelChunk')) {
          const match = t.match(/DOCS_modelChunk\s*=\s*({.*?});/s);
          if (match) {
            const data = JSON.parse(match[1]);
            const texts = data.chunk
              .filter(c => c.ty === 'is' && c.s)
              .map(c => c.s);
            if (texts.length > 0) return texts.join('\n');
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .filter((l, i, a) => i === 0 || l !== a[i - 1])
      .filter(l => l.length < 3 || /\p{L}|\p{N}/u.test(l))
      .join('\n')
      .substring(0, MAX_CHARS);
  }

  function extractContent() {
    const semanticSelectors = ['article', 'main', '[role="main"]'];
    for (const sel of semanticSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = collectVisibleText(el);
          if (text.trim().length > MIN_CONTENT) return cleanText(text);
        }
      } catch (e) {}
    }

    const root = document.body || document.documentElement;
    return cleanText(collectVisibleText(root));
  }

  async function extractContentAsync() {
    const semanticSelectors = ['article', 'main', '[role="main"]'];
    const startTime = Date.now();
    let prevText = '';
    let stableCount = 0;

    while (Date.now() - startTime < MAX_WAIT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      const gdocsText = extractGoogleDocsText();
      if (gdocsText && gdocsText.trim().length > 100) {
        return cleanText(gdocsText);
      }

      for (const sel of semanticSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const text = collectVisibleText(el);
            if (text.trim().length > MIN_CONTENT) return cleanText(text);
          }
        } catch (e) {}
      }

      const rootText = collectVisibleText(document.body || document.documentElement);
      if (rootText.trim().length > MIN_CONTENT) {
        if (rootText === prevText) {
          stableCount++;
          if (stableCount >= 2) return cleanText(rootText);
        } else {
          stableCount = 0;
        }
        prevText = rootText;
      }
    }

    const gdocsFallback = extractGoogleDocsText();
    if (gdocsFallback && gdocsFallback.trim().length > 100) {
      return cleanText(gdocsFallback);
    }

    const root = document.body || document.documentElement;
    return cleanText(collectVisibleText(root));
  }

  window.__tabSummarizerExtractAsync = extractContentAsync;

  return extractContent();
})();