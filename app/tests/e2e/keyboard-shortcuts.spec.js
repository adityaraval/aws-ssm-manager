const { expect } = require('@playwright/test');
const { test, clearAppState, createConnection } = require('./fixtures');

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

  test('should reset form with Cmd/Ctrl+N', async ({ page }) => {
    await createConnection(page, { name: 'Existing' });

    // Load the connection
    await page.click('.connection-item[data-name="Existing"]');
    await expect(page.locator('#connectionName')).toHaveValue('Existing');

    // Press Cmd+N
    await page.keyboard.press(`${modKey}+n`);

    // Form should be reset
    await expect(page.locator('#connectionName')).toHaveValue('');
    await expect(page.locator('.form-header h1')).toHaveText('New Connection');
  });

  test('should focus search with Cmd/Ctrl+K', async ({ page }) => {
    // Press Cmd+K
    await page.keyboard.press(`${modKey}+k`);

    // Search input should be focused
    const searchInput = page.locator('#connectionSearch');
    await expect(searchInput).toBeFocused();
  });

  test('should close modal with Escape', async ({ page }) => {
    // Open group modal
    await page.click('#addGroupBtn');
    await expect(page.locator('#groupModal')).not.toHaveClass(/hidden/);

    // Press Escape
    await page.keyboard.press('Escape');

    // Modal should be closed
    await expect(page.locator('#groupModal')).toHaveClass(/hidden/);
  });

  test('should allow Cmd/Ctrl+K even when input is focused', async ({ page }) => {
    // Focus the connection name input
    await page.click('#connectionName');
    await expect(page.locator('#connectionName')).toBeFocused();

    // Press Cmd+K
    await page.keyboard.press(`${modKey}+k`);

    // Search should be focused instead
    await expect(page.locator('#connectionSearch')).toBeFocused();
  });

  test('should not trigger Cmd/Ctrl+N when input is focused', async ({ page }) => {
    // Type something in connection name
    await page.fill('#connectionName', 'Test Name');

    // Focus and press Cmd+N while input is focused
    await page.click('#connectionName');
    await page.keyboard.press(`${modKey}+n`);

    // Form should NOT be reset since input was focused
    await expect(page.locator('#connectionName')).toHaveValue('Test Name');
  });
});
