import { test, expect } from '@playwright/test';

const GOOGLE_DOC_URL = 'https://docs.google.com/document/d/1YbOSCV7NZPfLJ7YA7MK4Fzt5PEv_NwHEZVtS3cHTLdU/edit?usp=sharing';
const TARGET_TERMS = ['Kontakt', 'parking mesto'];

test.describe('Google Docs - Text Extraction Diagnostics', () => {
  test('capture DOM text snapshots at intervals to verify content is extractable', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(GOOGLE_DOC_URL, { waitUntil: 'domcontentloaded' });

    const snapshotTimestamps = [1000, 3000, 5000, 10000, 15000];
    const results = [];
    let previousWait = 0;

    for (const ms of snapshotTimestamps) {
      const waitDelta = ms - previousWait;
      if (waitDelta > 0) {
        await page.waitForTimeout(waitDelta);
      }
      previousWait = ms;

      const snapshot = await page.evaluate((terms) => {
        const bodyInnerText = document.body?.innerText || '';
        const bodyTextContent = document.body?.textContent || '';

        const editorEl = document.querySelector('.kix-appview-editor');
        const editorInnerText = editorEl?.innerText || null;
        const editorTextContent = editorEl?.textContent || null;

        const foundInInner = terms.filter(t => bodyInnerText.includes(t));
        const foundInTextContent = terms.filter(t => bodyTextContent.includes(t));

        return {
          bodyInnerTextLength: bodyInnerText.length,
          bodyTextContentLength: bodyTextContent.length,
          bodyInnerTextFirst500: bodyInnerText.substring(0, 500),
          editorExists: editorEl !== null,
          editorInnerText: editorInnerText,
          editorInnerTextLength: editorInnerText?.length ?? 0,
          editorTextContent: editorTextContent,
          editorTextContentLength: editorTextContent?.length ?? 0,
          foundInInnerText: foundInInner,
          foundInTextContent: foundInTextContent,
          allFound: [...new Set([...foundInInner, ...foundInTextContent])],
        };
      }, TARGET_TERMS);

      results.push({ elapsedMs: ms, ...snapshot });

      console.log(`\n=== Snapshot at +${ms}ms ===`);
      console.log(`body.innerText:         ${snapshot.bodyInnerTextLength} chars`);
      console.log(`body.textContent:       ${snapshot.bodyTextContentLength} chars`);
      console.log(`editor exists:          ${snapshot.editorExists}`);
      console.log(`editor.innerText:       ${snapshot.editorInnerTextLength} chars`);
      console.log(`editor.textContent:     ${snapshot.editorTextContentLength} chars`);
      console.log(`Found in innerText:     ${snapshot.foundInInnerText.join(', ') || '(none)'}`);
      console.log(`Found in textContent:   ${snapshot.foundInTextContent.join(', ') || '(none)'}`);
      console.log(`--- body.innerText[:500] ---`);
      console.log(snapshot.bodyInnerTextFirst500);
    }

    const lastResult = results[results.length - 1];
    console.log(`\n=== FINAL SUMMARY ===`);
    console.log(`Target terms: ${TARGET_TERMS.join(', ')}`);
    console.log(`Found at 15s: ${lastResult.allFound.join(', ') || 'NOTHING FOUND'}`);

    for (const r of results) {
      console.log(`+${r.elapsedMs}ms: found=[${r.allFound.join(', ')}]  body.innerText=${r.bodyInnerTextLength}  body.textContent=${r.bodyTextContentLength}  editor=${r.editorExists}(${r.editorInnerTextLength})`);
    }

    expect(typeof lastResult.bodyInnerTextLength).toBe('number');
  });

  test('extractGoogleDocsText function extracts all target terms from DOCS_modelChunk', async ({ page }) => {
    test.setTimeout(30_000);

    await page.goto(GOOGLE_DOC_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

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

    console.log(`\n=== Google Docs Extraction Validation ===`);
    console.log(`Extracted text:\n${extracted}`);
    console.log(`\nExtracted length: ${extracted.length} chars`);

    expect(extracted).toContain('Kontakt');
    expect(extracted).toContain('parking mesto');
    expect(extracted).toContain('TRAŽIM PARKING MESTO ZA IZNAJMLJIVANJE');
  });
});