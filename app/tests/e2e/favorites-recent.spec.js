const { expect } = require('@playwright/test');
const { test, clearAppState, createConnection } = require('./fixtures');

test.describe('Groups-only Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should not render Favorites or Recent sections', async ({ page }) => {
    await createConnection(page, { name: 'Sidebar Test' });
    await page.click('.connection-item[data-name="Sidebar Test"]');

    await expect(page.locator('.favorites-header')).toHaveCount(0);
    await expect(page.locator('.recent-header')).toHaveCount(0);
    await expect(page.locator('.group-section[data-group-id="__favorites__"]')).toHaveCount(0);
    await expect(page.locator('.group-section[data-group-id="__recent__"]')).toHaveCount(0);
  });

  test('should not show favorite control on connection cards', async ({ page }) => {
    await createConnection(page, { name: 'No Star Test' });
    await expect(page.locator('.connection-item[data-name="No Star Test"] .connection-favorite')).toHaveCount(0);
  });

  test('should keep all connections in group sections only', async ({ page }) => {
    await createConnection(page, { name: 'Conn 1' });
    await page.click('#newConnectionBtnFooter');
    await createConnection(page, { name: 'Conn 2' });

    const allConnections = page.locator('.connection-item');
    await expect(allConnections).toHaveCount(2);

    await expect(page.locator('.group-connections[data-group-id="ungrouped"]')).toHaveCount(0);
  });
});
