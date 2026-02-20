const { expect } = require('@playwright/test');
const { test, clearAppState } = require('./fixtures');

test.describe('Theme', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should toggle to dark mode', async ({ page }) => {
    await page.click('button.mode-btn[data-theme="dark"]');

    // Dark button should be active
    await expect(page.locator('button.mode-btn[data-theme="dark"]')).toHaveClass(/active/);
    await expect(page.locator('button.mode-btn[data-theme="light"]')).not.toHaveClass(/active/);

    // localStorage should store dark
    const theme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(theme).toBe('dark');
  });

  test('should toggle to light mode', async ({ page }) => {
    // First set dark, then light
    await page.click('button.mode-btn[data-theme="dark"]');
    await page.click('button.mode-btn[data-theme="light"]');

    await expect(page.locator('button.mode-btn[data-theme="light"]')).toHaveClass(/active/);
    await expect(page.locator('button.mode-btn[data-theme="dark"]')).not.toHaveClass(/active/);

    const theme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(theme).toBe('light');
  });

  test('should persist theme in localStorage across reloads', async ({ page }) => {
    await page.click('button.mode-btn[data-theme="dark"]');

    // Reload
    await page.reload();
    await page.waitForSelector('#connectionGroups', { state: 'attached' });

    // Theme should still be dark
    const theme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(theme).toBe('dark');
    await expect(page.locator('button.mode-btn[data-theme="dark"]')).toHaveClass(/active/);
  });
});
