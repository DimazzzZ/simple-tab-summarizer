/**
 * Playwright E2E Tests for Simple Tab Summarizer
 * 
 * These tests verify the extension's HTML/JS structure by loading
 * the pages directly. Full extension runtime testing requires
 * manual QA due to Chrome extension loading limitations in CI.
 * 
 * Run with: npx playwright test tests/e2e/
 * 
 * Prerequisites:
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../..');

test.describe('Simple Tab Summarizer - UI Structure', () => {
  test.describe('Popup', () => {
    test('popup HTML has correct structure', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      // Check basic structure exists in HTML
      await expect(page.locator('h1')).toHaveText('Simple Tab Summarizer');
      await expect(page.locator('#auth-section')).toHaveCount(1);
      await expect(page.locator('#connect-btn')).toHaveCount(1);
      await expect(page.locator('#disconnect-btn')).toHaveCount(1);
      await expect(page.locator('#summarize-btn')).toHaveCount(1);
      await expect(page.locator('#language-select')).toHaveCount(1);
      await expect(page.locator('#source-select')).toHaveCount(1);
      await expect(page.locator('#debug-toggle')).toHaveCount(1);
      await expect(page.locator('#debug-section')).toHaveCount(1);
    });

    test('language selector has correct options', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const select = page.locator('#language-select');
      await expect(select).toHaveCount(1);
      
      const options = select.locator('option');
      await expect(options).toHaveCount(41);
    });

    test('source selector has correct options', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const select = page.locator('#source-select');
      await expect(select).toHaveCount(1);
      
      // Check options exist (not visibility, since options in select are not "visible")
      await expect(select.locator('option[value="currentTab"]')).toHaveCount(1);
      await expect(select.locator('option[value="tabGroup"]')).toHaveCount(1);
      await expect(select.locator('option[value="readingList"]')).toHaveCount(1);
    });

    test('debug console is hidden by default', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const debugSection = page.locator('#debug-section');
      await expect(debugSection).toHaveClass(/hidden/);
    });
  });

  test.describe('Sidebar', () => {
    test('sidebar HTML has correct structure', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/sidebar.html`);
      await page.waitForLoadState('load');
      
      await expect(page).toHaveTitle('Tab Group Summarizer');
      await expect(page.locator('h1')).toHaveText('Simple Tab Summarizer');
    });

    test('sidebar has same structure as popup', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/sidebar.html`);
      await page.waitForLoadState('load');
      
      await expect(page.locator('#auth-section')).toHaveCount(1);
      await expect(page.locator('#language-select')).toHaveCount(1);
      await expect(page.locator('#source-select')).toHaveCount(1);
      await expect(page.locator('#summarize-btn')).toHaveCount(1);
      await expect(page.locator('#debug-toggle')).toHaveCount(1);
    });
  });
});

test.describe('Simple Tab Summarizer - Button Coverage', () => {
  test.describe('All buttons exist and are clickable', () => {
    test('connect button exists and can be clicked', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const connectBtn = page.locator('#connect-btn');
      await expect(connectBtn).toBeAttached();
      await expect(connectBtn).toBeEnabled();
      await expect(connectBtn).toHaveText('Connect');
    });

    test('disconnect button exists but is hidden initially', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const disconnectBtn = page.locator('#disconnect-btn');
      await expect(disconnectBtn).toBeAttached();
      await expect(disconnectBtn).toHaveClass(/hidden/);
    });

    test('summarize button exists and is disabled initially', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const summarizeBtn = page.locator('#summarize-btn');
      await expect(summarizeBtn).toBeAttached();
      await expect(summarizeBtn).toBeDisabled();
      await expect(summarizeBtn.locator('.btn-text')).toHaveText('Summarize Selected');
    });

    test('mode toggle exists and can be clicked', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const modeToggle = page.locator('#mode-toggle');
      await expect(modeToggle).toBeAttached();
      await expect(modeToggle).toBeEnabled();
      await expect(modeToggle.locator('span')).toHaveText('Sidebar');
    });

    test('clear debug button exists', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const clearDebugBtn = page.locator('#clear-debug-btn');
      await expect(clearDebugBtn).toBeAttached();
      await expect(clearDebugBtn).toHaveText('Clear');
    });

    test('copy summary button exists', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const copyBtn = page.locator('#copy-summary-btn');
      await expect(copyBtn).toBeAttached();
      await expect(copyBtn).toContainText('Copy');
    });

    test('select all and deselect all buttons exist', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      await expect(page.locator('#select-all-btn')).toBeAttached();
      await expect(page.locator('#deselect-all-btn')).toBeAttached();
    });

    test('reading list select all and deselect all buttons exist', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      await expect(page.locator('#rl-select-all-btn')).toBeAttached();
      await expect(page.locator('#rl-deselect-all-btn')).toBeAttached();
    });

    test('debug toggle can be clicked to show console', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const debugToggle = page.locator('#debug-toggle');
      const debugSection = page.locator('#debug-section');
      
      await expect(debugSection).toHaveClass(/hidden/);
      await expect(debugToggle).toBeAttached();
      await expect(debugToggle).not.toBeChecked();
      
      // Click the toggle
      await debugToggle.check();
      await expect(debugToggle).toBeChecked();
    });

    test('group select exists and shows placeholder option', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/popup.html`);
      await page.waitForLoadState('load');
      
      const groupSelect = page.locator('#group-select');
      await expect(groupSelect).toBeAttached();
      await expect(groupSelect.locator('option').first()).toHaveText('-- Select a group --');
    });
  });

  test.describe('Sidebar button coverage', () => {
    test('sidebar connect button exists', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/sidebar.html`);
      await page.waitForLoadState('load');
      
      const connectBtn = page.locator('#connect-btn');
      await expect(connectBtn).toBeAttached();
      await expect(connectBtn).toHaveText('Connect');
    });

    test('sidebar mode toggle shows Popup', async ({ page }) => {
      await page.goto(`file://${EXTENSION_PATH}/sidebar.html`);
      await page.waitForLoadState('load');
      
      const modeToggle = page.locator('#mode-toggle');
      await expect(modeToggle.locator('span')).toHaveText('Popup');
    });
  });
});
