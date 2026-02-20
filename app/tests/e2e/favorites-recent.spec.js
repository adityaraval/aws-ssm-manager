const { expect } = require('@playwright/test');
const { test, clearAppState, createConnection } = require('./fixtures');

test.describe('Favorites and Recent', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should toggle favorite and show Favorites section', async ({ page }) => {
    await createConnection(page, { name: 'Fav Test' });

    // Click the favorite button (star)
    await page.click('.connection-favorite[data-name="Fav Test"]');

    // Favorites section should appear
    await expect(page.locator('.favorites-header .group-name')).toHaveText('Favorites');

    // The connection should appear in the Favorites section
    const favSection = page.locator('.group-connections[data-group-id="__favorites__"]');
    await expect(favSection.locator('.connection-item[data-name="Fav Test"]')).toBeVisible();
  });

  test('should unfavorite and hide Favorites section when empty', async ({ page }) => {
    await createConnection(page, { name: 'Unfav Test' });

    // Favorite then unfavorite
    await page.click('.connection-favorite[data-name="Unfav Test"]');
    await expect(page.locator('.favorites-header')).toBeVisible();

    // Click favorite again to remove
    // The connection appears in both Favorites and its regular group, click the one in favorites
    await page.locator('.group-connections[data-group-id="__favorites__"] .connection-favorite[data-name="Unfav Test"]').click();

    // Favorites section should disappear
    await expect(page.locator('.favorites-header')).toHaveCount(0);
  });

  test('should show Recent section after loading a connection', async ({ page }) => {
    await createConnection(page, { name: 'Recent Test' });

    // Click to "load" the connection (this sets lastUsedAt)
    await page.click('.connection-item[data-name="Recent Test"]');

    // Recent section should appear
    await expect(page.locator('.recent-header .group-name')).toHaveText('Recent');

    const recentSection = page.locator('.group-connections[data-group-id="__recent__"]');
    await expect(recentSection.locator('.connection-item[data-name="Recent Test"]')).toBeVisible();
  });

  test('should limit Recent section to 5 entries', async ({ page }) => {
    // Create 7 connections and load them all
    for (let i = 1; i <= 7; i++) {
      await createConnection(page, {
        name: `Conn ${i}`,
        host: `host${i}.us-east-1.es.amazonaws.com`,
      });
      // Reset form for next
      if (i < 7) {
        await page.click('#newConnectionBtnFooter');
      }
    }

    // Load each connection to set lastUsedAt (click in order)
    for (let i = 1; i <= 7; i++) {
      // Find the item in ungrouped section (not recent or favorites)
      await page.locator(`.group-connections[data-group-id="ungrouped"] .connection-item[data-name="Conn ${i}"]`).click();
      // Small wait to ensure different timestamps
      await page.waitForTimeout(50);
    }

    // Recent section should have at most 5 items
    const recentItems = page.locator('.group-connections[data-group-id="__recent__"] .connection-item');
    await expect(recentItems).toHaveCount(5);
  });

  test('should allow collapsing the Favorites section', async ({ page }) => {
    await createConnection(page, { name: 'Collapsible Fav' });
    await page.click('.connection-favorite[data-name="Collapsible Fav"]');

    // Click favorites header to collapse
    const favHeader = page.locator('.favorites-header');
    await expect(favHeader).toBeVisible();
    await favHeader.click();

    // Section should be collapsed
    const favSection = page.locator('.group-section[data-group-id="__favorites__"]');
    await expect(favSection).toHaveClass(/collapsed/);
  });
});
