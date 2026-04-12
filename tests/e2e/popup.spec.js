/**
 * Playwright E2E Tests for Simple Tab Summarizer
 * 
 * Run with: npx playwright test tests/e2e/
 * 
 * Prerequisites:
 *   npm init -y
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../..');

test.describe('Simple Tab Summarizer - Popup', () => {
  test('popup loads with correct title', async ({ page }) => {
    // Load the popup HTML directly
    await page.goto(`file://${EXTENSION_PATH}/popup.html`);
    
    // Verify the page title
    await expect(page).toHaveTitle('Tab Group Summarizer');
    
    // Verify main elements are present
    await expect(page.locator('h1')).toHaveText('Simple Tab Summarizer');
    await expect(page.locator('#auth-section')).toBeVisible();
    await expect(page.locator('#connect-btn')).toBeVisible();
    await expect(page.locator('#summarize-btn')).toBeVisible();
  });

  test('popup shows not connected state initially', async ({ page }) => {
    await page.goto(`file://${EXTENSION_PATH}/popup.html`);
    
    // Wait for DOMContentLoaded
    await page.waitForLoadState('load');
    await page.waitForTimeout(500); // Give JS time to run
    
    // Check auth text (may need to wait for JS execution)
    const authText = page.locator('#auth-text');
    await expect(authText).toBeVisible();
  });

  test('language selector has options', async ({ page }) => {
    await page.goto(`file://${EXTENSION_PATH}/popup.html`);
    
    const select = page.locator('#language-select');
    await expect(select).toBeVisible();
    
    // Check English is selected by default
    await expect(select).toHaveValue('English');
    
    // Check options are present
    const options = select.locator('option');
    await expect(options).toHaveCount(41); // 41 languages
  });

  test('source selector has correct options', async ({ page }) => {
    await page.goto(`file://${EXTENSION_PATH}/popup.html`);
    
    const select = page.locator('#source-select');
    await expect(select).toBeVisible();
    
    // Check default value
    await expect(select).toHaveValue('currentTab');
    
    // Verify all options exist
    await expect(select.locator('option[value="currentTab"]')).toBeVisible();
    await expect(select.locator('option[value="tabGroup"]')).toBeVisible();
    await expect(select.locator('option[value="readingList"]')).toBeVisible();
  });

  test('debug console is hidden by default', async ({ page }) => {
    await page.goto(`file://${EXTENSION_PATH}/popup.html`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
    
    const debugSection = page.locator('#debug-section');
    await expect(debugSection).toHaveClass(/hidden/);
  });

  test('debug toggle shows/hides console', async ({ page }) => {
    await page.goto(`file://${EXTENSION_PATH}/popup.html`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
    
    const debugToggle = page.locator('#debug-toggle');
    const debugSection = page.locator('#debug-section');
    
    // Initially hidden
    await expect(debugSection).toHaveClass(/hidden/);
    
    // Toggle on
    await debugToggle.check();
    await expect(debugSection).not.toHaveClass(/hidden/);
    
    // Toggle off
    await debugToggle.uncheck();
    await expect(debugSection).toHaveClass(/hidden/);
  });
});

test.describe('Simple Tab Summarizer - Sidebar', () => {
  test('sidebar loads with correct title', async ({ page }) => {
    await page.goto(`file://${EXTENSION_PATH}/sidebar.html`);
    
    await expect(page).toHaveTitle('Tab Group Summarizer');
    await expect(page.locator('h1')).toHaveText('Simple Tab Summarizer');
  });

  test('sidebar has same structure as popup', async ({ page }) => {
    await page.goto(`file://${EXTENSION_PATH}/sidebar.html`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
    
    // Verify key elements exist
    await expect(page.locator('#auth-section')).toBeVisible();
    await expect(page.locator('#language-select')).toBeVisible();
    await expect(page.locator('#source-select')).toBeVisible();
    await expect(page.locator('#summarize-btn')).toBeVisible();
    await expect(page.locator('#debug-toggle')).toBeVisible();
  });
});
