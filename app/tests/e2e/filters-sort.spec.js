const { expect } = require('@playwright/test');
const { test, clearAppState, createConnection } = require('./fixtures');

test.describe('Filters and Sort', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);

    // Create multiple connections with different services and regions
    await createConnection(page, { name: 'OpenSearch US', service: 'opensearch', region: 'us-east-1', profile: 'dev' });
    await page.click('#newConnectionBtnFooter');
    await createConnection(page, { name: 'Aurora EU', service: 'aurora', region: 'eu-west-1', profile: 'staging', host: 'aurora.eu-west-1.rds.amazonaws.com', localPort: '5432' });
    await page.click('#newConnectionBtnFooter');
    await createConnection(page, { name: 'Redis US', service: 'elasticache', region: 'us-east-1', profile: 'prod', host: 'redis.us-east-1.cache.amazonaws.com', localPort: '6379' });

    // Reload so filter dropdowns populate from saved connections
    await page.reload();
    await page.waitForSelector('#connectionGroups', { state: 'attached' });
  });

  test('should filter connections by search term', async ({ page }) => {
    await page.fill('#connectionSearch', 'Aurora');

    // Only Aurora connection should be visible
    const visible = page.locator('.group-connections[data-group-id="ungrouped"] .connection-item');
    await expect(visible).toHaveCount(1);
    await expect(visible.first()).toHaveAttribute('data-name', 'Aurora EU');
  });

  test('should filter by service type', async ({ page }) => {
    // Open filter panel
    await page.click('#filterToggle');
    await expect(page.locator('#filterPanel')).not.toHaveClass(/hidden/);

    // Filter by elasticache
    await page.selectOption('#filterService', 'elasticache');

    const visible = page.locator('.group-connections[data-group-id="ungrouped"] .connection-item');
    await expect(visible).toHaveCount(1);
    await expect(visible.first()).toHaveAttribute('data-name', 'Redis US');
  });

  test('should sort connections by name A-Z and Z-A', async ({ page }) => {
    // Open filter panel
    await page.click('#filterToggle');

    // Sort A-Z (default)
    await page.selectOption('#sortSelect', 'name-asc');
    let items = page.locator('.group-connections[data-group-id="ungrouped"] .connection-item');
    const namesAsc = await items.evaluateAll(els => els.map(el => el.getAttribute('data-name')));
    expect(namesAsc).toEqual(['Aurora EU', 'OpenSearch US', 'Redis US']);

    // Sort Z-A
    await page.selectOption('#sortSelect', 'name-desc');
    items = page.locator('.group-connections[data-group-id="ungrouped"] .connection-item');
    const namesDesc = await items.evaluateAll(els => els.map(el => el.getAttribute('data-name')));
    expect(namesDesc).toEqual(['Redis US', 'OpenSearch US', 'Aurora EU']);
  });

  test('should clear filters and restore all connections', async ({ page }) => {
    // Open filter panel and apply a filter
    await page.click('#filterToggle');
    await page.selectOption('#filterService', 'opensearch');

    let visible = page.locator('.group-connections[data-group-id="ungrouped"] .connection-item');
    await expect(visible).toHaveCount(1);

    // Clear filters
    await page.click('#clearFilters');

    visible = page.locator('.group-connections[data-group-id="ungrouped"] .connection-item');
    await expect(visible).toHaveCount(3);
  });

  test('should show filter badge count', async ({ page }) => {
    // Open filter panel
    await page.click('#filterToggle');

    // Badge should be hidden initially
    await expect(page.locator('#filterBadge')).toHaveClass(/hidden/);

    // Apply a filter
    await page.selectOption('#filterService', 'aurora');

    // Badge should show "1"
    await expect(page.locator('#filterBadge')).not.toHaveClass(/hidden/);
    await expect(page.locator('#filterBadge')).toHaveText('1');

    // Apply a second filter
    await page.selectOption('#filterRegion', 'eu-west-1');
    await expect(page.locator('#filterBadge')).toHaveText('2');
  });
});
