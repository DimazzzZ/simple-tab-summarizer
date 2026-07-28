import { test, expect } from '@playwright/test';

/**
 * Google Docs extraction tests using mocked HTML fixtures.
 *
 * These tests verify the extraction logic works correctly without
 * depending on external Google Docs (which may contain sensitive data
 * or become unavailable).
 */

// Mock Google Docs HTML with DOCS_modelChunk structure
const MOCK_GOOGLE_DOCS_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test Document</title></head>
<body>
  <div class="kix-appview-editor">
    <div class="kix-paragraphrenderer">Sample document content</div>
  </div>
  <script>
    var DOCS_modelChunk = {
      "chunk": [
        {"ty": "is", "s": "SAMPLE HEADING"},
        {"ty": "is", "s": "This is a test document for extraction validation."},
        {"ty": "is", "s": "Contact information placeholder."},
        {"ty": "other", "data": "ignored"},
        {"ty": "is", "s": "Additional test content here."}
      ]
    };
  </script>
</body>
</html>
`;

test.describe('Google Docs - Text Extraction (Mocked)', () => {
  test('DOM text extraction captures body content', async ({ page }) => {
    await page.setContent(MOCK_GOOGLE_DOCS_HTML);

    const snapshot = await page.evaluate(() => {
      const bodyInnerText = document.body?.innerText || '';
      const bodyTextContent = document.body?.textContent || '';
      const editorEl = document.querySelector('.kix-appview-editor');

      return {
        bodyInnerTextLength: bodyInnerText.length,
        bodyTextContentLength: bodyTextContent.length,
        editorExists: editorEl !== null,
        hasContent: bodyInnerText.length > 0 || bodyTextContent.length > 0,
      };
    });

    expect(snapshot.editorExists).toBe(true);
    expect(snapshot.hasContent).toBe(true);
    expect(typeof snapshot.bodyInnerTextLength).toBe('number');
  });

  test('DOCS_modelChunk extraction parses structured content', async ({ page }) => {
    await page.setContent(MOCK_GOOGLE_DOCS_HTML);

    const extracted = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const t = s.textContent || '';
        if (t.includes('DOCS_modelChunk')) {
          const match = t.match(/DOCS_modelChunk\s*=\s*({.*?});/s);
          if (match) {
            try {
              const data = JSON.parse(match[1]);
              const texts = data.chunk
                .filter(c => c.ty === 'is' && c.s)
                .map(c => c.s);
              if (texts.length > 0) return texts.join('\n');
            } catch (e) {
              return { error: e.message };
            }
          }
        }
      }
      return { error: 'DOCS_modelChunk not found' };
    });

    expect(typeof extracted).toBe('string');
    expect(extracted).toContain('SAMPLE HEADING');
    expect(extracted).toContain('test document');
    expect(extracted).toContain('Contact information placeholder');
    expect(extracted).toContain('Additional test content');
    expect(extracted).not.toContain('ignored');
  });

  test('extraction handles missing DOCS_modelChunk gracefully', async ({ page }) => {
    await page.setContent(`<!DOCTYPE html><html><body><div>No model chunk here</div></body></html>`);

    const result = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const t = s.textContent || '';
        if (t.includes('DOCS_modelChunk')) {
          return 'found';
        }
      }
      return { error: 'DOCS_modelChunk not found' };
    });

    expect(result).toEqual({ error: 'DOCS_modelChunk not found' });
  });

  test('extraction handles malformed JSON gracefully', async ({ page }) => {
    await page.setContent(`<!DOCTYPE html><html><body><script>var DOCS_modelChunk = {invalid json};</script></body></html>`);

    const result = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const t = s.textContent || '';
        if (t.includes('DOCS_modelChunk')) {
          const match = t.match(/DOCS_modelChunk\s*=\s*({.*?});/s);
          if (match) {
            try {
              JSON.parse(match[1]);
              return 'parsed';
            } catch (e) {
              return { error: e.message };
            }
          }
        }
      }
      return { error: 'DOCS_modelChunk not found' };
    });

    expect(result).toHaveProperty('error');
  });
});
