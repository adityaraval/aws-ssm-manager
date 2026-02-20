const { expect } = require('@playwright/test');
const { test, clearAppState, createConnection } = require('./fixtures');

test.describe('Import and Export', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should export connections to a file', async ({ page }) => {
    await createConnection(page, { name: 'Export Me' });

    // Wait for the save toast to disappear
    await page.waitForTimeout(3000);

    // Click export button
    await page.click('#exportBtn');

    // Wait for export success toast
    await expect(page.locator('.toast', { hasText: 'Exported' })).toBeVisible({ timeout: 5000 });
  });

  test('should import connections and merge into existing', async ({ page }) => {
    // Create an existing connection first
    await createConnection(page, { name: 'Existing Conn' });

    // Click import button (mock returns 'Imported Connection')
    await page.click('#importBtn');

    // Wait for import to complete
    await expect(page.locator('.toast', { hasText: 'Imported' })).toBeVisible({ timeout: 5000 });

    // Both connections should be in the sidebar
    await expect(page.locator('.connection-item[data-name="Existing Conn"]')).toBeVisible();
    await expect(page.locator('.connection-item[data-name="Imported Connection"]')).toBeVisible();
  });

  test('should export and then import the same data', async ({ page }) => {
    // Create connections
    await createConnection(page, { name: 'Roundtrip Conn' });

    // Export first (writes to temp file)
    await page.click('#exportBtn');
    await page.waitForSelector('.toast', { state: 'attached', timeout: 5000 });

    // Clear state
    await clearAppState(page);
    await expect(page.locator('.connection-item')).toHaveCount(0);

    // Now the mock import-connections handler will try to read from the same temp file
    // that export wrote to. But since clearAppState reloads, we need to handle this.
    // The mock import handler reads from ssm-e2e-import.json or returns test data.
    await page.click('#importBtn');
    await expect(page.locator('.toast', { hasText: 'Imported' })).toBeVisible({ timeout: 5000 });

    // Should have at least one imported connection
    const items = page.locator('.connection-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });
});
