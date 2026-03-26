const { expect } = require('@playwright/test');
const { test, clearAppState, fillConnectionForm, saveConnection, createConnection } = require('./fixtures');

/** Helper: select the custom radio and optionally set the custom service name */
async function selectCustomService(page, customName = '') {
  await page.evaluate(() => {
    const radio = document.querySelector('input[name="service"][value="custom"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  });
  if (customName) {
    await page.fill('#customServiceName', customName);
  }
}

/** Create and save a custom-service connection */
async function createCustomConnection(page, {
  name = 'My Custom Service',
  customServiceName = 'Kafka',
  localPort = '9092',
  remotePort = '9092',
  host = 'kafka.us-east-1.amazonaws.com',
  region = 'us-east-1',
  profile = 'dev',
  target = 'i-0abc123def4567890',
} = {}) {
  await page.fill('#connectionName', name);
  await page.selectOption('#profileSelect', profile);
  await selectCustomService(page, customServiceName);
  await page.fill('#remotePort', remotePort);
  await page.fill('#localPort', localPort);
  await page.fill('#targetInstance', target);
  await page.fill('#serviceHost', host);
  await page.selectOption('#region', region);
  await saveConnection(page);
}

test.describe('Custom Service Types', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  // ── UI Behavior ──────────────────────────────────────────────────────────

  test('selecting Custom reveals the service name input', async ({ page }) => {
    await expect(page.locator('#customServiceGroup')).toHaveClass(/hidden/);
    await selectCustomService(page);
    await expect(page.locator('#customServiceGroup')).not.toHaveClass(/hidden/);
  });

  test('selecting Custom makes the remote port field editable', async ({ page }) => {
    // Initially readonly
    await expect(page.locator('#remotePort')).toHaveAttribute('readonly', '');

    await selectCustomService(page);
    // Should no longer be readonly
    await expect(page.locator('#remotePort')).not.toHaveAttribute('readonly', '');
  });

  test('switching away from Custom hides the service name input again', async ({ page }) => {
    await selectCustomService(page, 'Kafka');
    await expect(page.locator('#customServiceGroup')).not.toHaveClass(/hidden/);

    // Switch to OpenSearch
    await page.evaluate(() => {
      const radio = document.querySelector('input[name="service"][value="opensearch"]');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.locator('#customServiceGroup')).toHaveClass(/hidden/);
  });

  test('switching away from Custom restores remote port to readonly', async ({ page }) => {
    await selectCustomService(page);
    await expect(page.locator('#remotePort')).not.toHaveAttribute('readonly', '');

    await page.evaluate(() => {
      const radio = document.querySelector('input[name="service"][value="aurora"]');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.locator('#remotePort')).toHaveAttribute('readonly', '');
  });

  test('switching away from Custom clears the custom service name input', async ({ page }) => {
    await selectCustomService(page, 'Kafka');

    await page.evaluate(() => {
      const radio = document.querySelector('input[name="service"][value="opensearch"]');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.locator('#customServiceName')).toHaveValue('');
  });

  // ── Validation ───────────────────────────────────────────────────────────

  test('shows error when saving custom service without a service name', async ({ page }) => {
    await fillConnectionForm(page, { service: 'opensearch' }); // fill everything except custom name
    // Now switch to custom (leaves customServiceName empty)
    await selectCustomService(page);
    await page.fill('#remotePort', '9092');
    await page.fill('#localPort', '9092');
    await page.click('#saveBtn');

    const toast = page.locator('.toast.error');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('service name');
  });

  // ── Save and Display ──────────────────────────────────────────────────────

  test('saves a custom service connection and shows it in the sidebar', async ({ page }) => {
    await createCustomConnection(page, { name: 'Kafka Prod', customServiceName: 'Kafka' });

    const item = page.locator('.connection-item[data-name="Kafka Prod"]');
    await expect(item).toBeVisible();
  });

  test('custom service connection shows the service name badge in sidebar', async ({ page }) => {
    await createCustomConnection(page, { name: 'Kafka Prod', customServiceName: 'Kafka' });

    const badge = page.locator('.connection-item[data-name="Kafka Prod"] .connection-custom-service');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Kafka');
  });

  test('custom service uses the custom icon (not an AWS service img)', async ({ page }) => {
    await createCustomConnection(page, { name: 'My Redis', customServiceName: 'Redis' });

    const item = page.locator('.connection-item[data-name="My Redis"]');
    // Should have the custom icon div, not a service img
    await expect(item.locator('.connection-icon-custom-small')).toBeVisible();
    await expect(item.locator('.connection-icon-img')).toHaveCount(0);
  });

  // ── Load / Edit ───────────────────────────────────────────────────────────

  test('loading a custom connection restores the custom name input', async ({ page }) => {
    await createCustomConnection(page, { name: 'Kafka Prod', customServiceName: 'Kafka', localPort: '9092', remotePort: '9092' });

    await page.click('#newConnectionBtnFooter');
    await page.click('.connection-item[data-name="Kafka Prod"]');

    await expect(page.locator('#customServiceGroup')).not.toHaveClass(/hidden/);
    await expect(page.locator('#customServiceName')).toHaveValue('Kafka');
  });

  test('loading a custom connection keeps the remote port editable', async ({ page }) => {
    await createCustomConnection(page, { name: 'Kafka Prod', customServiceName: 'Kafka', localPort: '9092', remotePort: '9092' });

    await page.click('#newConnectionBtnFooter');
    await page.click('.connection-item[data-name="Kafka Prod"]');

    await expect(page.locator('#remotePort')).not.toHaveAttribute('readonly', '');
    await expect(page.locator('#remotePort')).toHaveValue('9092');
  });

  test('loading a custom connection restores the saved remote port value', async ({ page }) => {
    await createCustomConnection(page, { name: 'MySQL Conn', customServiceName: 'MySQL', remotePort: '3306', localPort: '3306' });

    await page.click('#newConnectionBtnFooter');
    await page.click('.connection-item[data-name="MySQL Conn"]');

    await expect(page.locator('#remotePort')).toHaveValue('3306');
  });

  test('loading a non-custom connection hides the custom service group', async ({ page }) => {
    await createCustomConnection(page, { name: 'Kafka Prod', customServiceName: 'Kafka' });
    await page.click('#newConnectionBtnFooter');
    await createConnection(page, { name: 'OpenSearch Prod' });

    // Load the custom one
    await page.click('.connection-item[data-name="Kafka Prod"]');
    await expect(page.locator('#customServiceGroup')).not.toHaveClass(/hidden/);

    // Load the built-in one — custom group should hide
    await page.click('.connection-item[data-name="OpenSearch Prod"]');
    await expect(page.locator('#customServiceGroup')).toHaveClass(/hidden/);
  });

  test('can edit a custom connection and update the service name', async ({ page }) => {
    await createCustomConnection(page, { name: 'Old Service', customServiceName: 'OldName' });

    await page.click('.connection-item[data-name="Old Service"]');
    await page.fill('#customServiceName', 'NewName');
    await saveConnection(page);

    // Reload the connection to verify persisted value
    await page.click('.connection-item[data-name="Old Service"]');
    await expect(page.locator('#customServiceName')).toHaveValue('NewName');
  });

  // ── Filter ────────────────────────────────────────────────────────────────

  test('custom service connections appear when filtering by custom', async ({ page }) => {
    await createCustomConnection(page, { name: 'Kafka Conn', customServiceName: 'Kafka' });
    await page.click('#newConnectionBtnFooter');
    await createConnection(page, { name: 'OpenSearch Conn' });

    // Reload so filter dropdowns populate
    await page.reload();
    await page.waitForSelector('#connectionGroups', { state: 'attached' });

    await page.click('#filterToggle');
    await page.selectOption('#filterService', 'custom');

    const visible = page.locator('.connection-item:visible');
    await expect(visible).toHaveCount(1);
    await expect(visible.first()).toHaveAttribute('data-name', 'Kafka Conn');
  });

  test('custom service connections are found by searching the custom service name', async ({ page }) => {
    await createCustomConnection(page, { name: 'My Service', customServiceName: 'Zookeeper' });

    await page.fill('#connectionSearch', 'Zookeeper');

    const visible = page.locator('.connection-item:visible');
    await expect(visible).toHaveCount(1);
    await expect(visible.first()).toHaveAttribute('data-name', 'My Service');
  });

  // ── Duplicate ─────────────────────────────────────────────────────────────

  test('duplicating a custom connection preserves the custom service name', async ({ page }) => {
    await createCustomConnection(page, { name: 'Kafka Original', customServiceName: 'Kafka' });

    await page.hover('.connection-item[data-name="Kafka Original"]');
    await page.click('.connection-item[data-name="Kafka Original"] .connection-duplicate', { force: true });

    // Load the duplicate
    await page.click('.connection-item[data-name="Kafka Original (Copy)"]');

    await expect(page.locator('#customServiceGroup')).not.toHaveClass(/hidden/);
    await expect(page.locator('#customServiceName')).toHaveValue('Kafka');
  });

  // ── Reset Form ────────────────────────────────────────────────────────────

  test('resetting the form hides custom service group and clears the name', async ({ page }) => {
    await selectCustomService(page, 'Mongo');
    await expect(page.locator('#customServiceGroup')).not.toHaveClass(/hidden/);

    await page.click('#newConnectionBtnFooter');

    await expect(page.locator('#customServiceGroup')).toHaveClass(/hidden/);
    await expect(page.locator('#customServiceName')).toHaveValue('');
  });
});
