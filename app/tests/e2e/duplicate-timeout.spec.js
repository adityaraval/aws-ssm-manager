const { expect } = require('@playwright/test');
const { test, clearAppState, createConnection, fillConnectionForm, saveConnection } = require('./fixtures');

test.describe('Duplicate and Timeout', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should duplicate a connection and prefill the copied values', async ({ page }) => {
    await createConnection(page, {
      name: 'Primary OpenSearch',
      host: 'primary.us-east-1.es.amazonaws.com',
      localPort: '5605',
      sessionTimeout: '15'
    });

    await page.hover('.connection-item[data-name="Primary OpenSearch"]');
    await page.click('.connection-item[data-name="Primary OpenSearch"] .connection-duplicate', { force: true });

    const duplicateItem = page.locator('.connection-item[data-name="Primary OpenSearch (Copy)"]');
    await expect(duplicateItem.first()).toBeVisible();

    await expect(page.locator('#connectionName')).toHaveValue('Primary OpenSearch (Copy)');
    await expect(page.locator('#serviceHost')).toHaveValue('primary.us-east-1.es.amazonaws.com');
    await expect(page.locator('#localPort')).toHaveValue('5605');
    await expect(page.locator('#sessionTimeout')).toHaveValue('15');
  });

  test('should generate incremented duplicate names when copy already exists', async ({ page }) => {
    await createConnection(page, { name: 'Name Collision' });

    const originalDupBtn = page.locator('.connection-item[data-name="Name Collision"] .connection-duplicate');
    await originalDupBtn.click({ force: true });
    await originalDupBtn.click({ force: true });

    await expect(page.locator('.connection-item[data-name="Name Collision (Copy)"]').first()).toBeVisible();
    await expect(page.locator('.connection-item[data-name="Name Collision (Copy 2)"]').first()).toBeVisible();
  });

  test('should persist selected timeout per connection', async ({ page }) => {
    await fillConnectionForm(page, {
      name: 'Timeout 30',
      sessionTimeout: '30'
    });
    await saveConnection(page);

    await page.click('.connection-item[data-name="Timeout 30"]');
    await expect(page.locator('#sessionTimeout')).toHaveValue('30');

    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, {
      name: 'No Timeout Conn',
      sessionTimeout: 'none'
    });
    await saveConnection(page);

    await page.click('.connection-item[data-name="Timeout 30"]');
    await expect(page.locator('#sessionTimeout')).toHaveValue('30');
    await page.click('.connection-item[data-name="No Timeout Conn"]');
    await expect(page.locator('#sessionTimeout')).toHaveValue('none');
  });

  test('should show no-timeout label in session timer when timeout is disabled', async ({ page }) => {
    await fillConnectionForm(page, {
      name: 'No Timeout Session',
      sessionTimeout: 'none'
    });

    await expect(page.locator('#timerValue')).toHaveText('No timeout');

    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    await expect(page.locator('#terminalStatus')).toHaveText('Connected');
    await expect(page.locator('#timerValue')).toHaveText('No timeout');
  });
});
