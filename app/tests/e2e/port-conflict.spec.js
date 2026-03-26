const { expect } = require('@playwright/test');
const { test, clearAppState, createConnection, fillConnectionForm } = require('./fixtures');

test.describe('Port Conflict Detection', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('shows warning when local port conflicts with an existing connection', async ({ page }) => {
    // Create a connection on port 5601
    await createConnection(page, { name: 'OpenSearch Prod', localPort: '5601' });

    // Start a new connection form with the same port
    await page.click('#newConnectionBtnFooter');
    await page.fill('#localPort', '5601');

    // Warning should appear and mention the conflicting connection
    const warning = page.locator('#portConflictWarning');
    await expect(warning).not.toHaveClass(/hidden/);
    await expect(warning).toContainText('OpenSearch Prod');
  });

  test('warning disappears when port is changed to a non-conflicting value', async ({ page }) => {
    await createConnection(page, { name: 'OpenSearch Prod', localPort: '5601' });

    await page.click('#newConnectionBtnFooter');
    await page.fill('#localPort', '5601');

    // Confirm warning is visible
    const warning = page.locator('#portConflictWarning');
    await expect(warning).not.toHaveClass(/hidden/);

    // Change to a different port
    await page.fill('#localPort', '5602');
    await expect(warning).toHaveClass(/hidden/);
  });

  test('no warning shown when no other connection uses the same port', async ({ page }) => {
    // Port 9000 is unused
    await page.fill('#localPort', '9000');
    const warning = page.locator('#portConflictWarning');
    await expect(warning).toHaveClass(/hidden/);
  });

  test('no warning when editing the same connection with its own port', async ({ page }) => {
    await createConnection(page, { name: 'Self Edit', localPort: '5601' });

    // Load the same connection (editingConnectionName = 'Self Edit')
    await page.click('.connection-item[data-name="Self Edit"]');

    // The port is 5601 — but it's the same connection being edited, so no warning
    const warning = page.locator('#portConflictWarning');
    await expect(warning).toHaveClass(/hidden/);
  });

  test('warning lists all connections that share the conflicting port', async ({ page }) => {
    // Save two connections on port 5601 (app allows saving duplicates, just warns)
    await createConnection(page, { name: 'Alpha', localPort: '5601' });
    await page.click('#newConnectionBtnFooter');
    // Save Beta on 5601 — warning will show Alpha during form fill, but save anyway
    await fillConnectionForm(page, {
      name: 'Beta',
      localPort: '5601',
      host: 'beta.us-east-1.es.amazonaws.com'
    });
    await page.click('#saveBtn');
    await page.waitForSelector('.toast', { state: 'attached', timeout: 3000 });

    // Now on a new form, type 5601 — warning should list both Alpha and Beta
    await page.click('#newConnectionBtnFooter');
    await page.fill('#localPort', '5601');

    const warning = page.locator('#portConflictWarning');
    await expect(warning).not.toHaveClass(/hidden/);
    // Warning shows first conflicting name; additional conflicts shown as "+N more"
    await expect(warning).toContainText('Alpha');
    await expect(warning).toContainText('+1 more');
  });

  test('warning appears when loading a connection whose port conflicts with another', async ({ page }) => {
    // Create two connections on the same port
    await createConnection(page, { name: 'Conn A', localPort: '6379' });
    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, {
      name: 'Conn B',
      localPort: '6379',
      service: 'elasticache',
      host: 'redis.us-east-1.cache.amazonaws.com'
    });
    await page.click('#saveBtn');
    await page.waitForSelector('.toast', { state: 'attached', timeout: 3000 });

    // Load Conn A — warning should show Conn B as a conflict
    await page.click('.connection-item[data-name="Conn A"]');
    const warning = page.locator('#portConflictWarning');
    await expect(warning).not.toHaveClass(/hidden/);
    await expect(warning).toContainText('Conn B');
  });

  test('warning is hidden after resetting the form', async ({ page }) => {
    await createConnection(page, { name: 'Existing', localPort: '5601' });

    // Type a conflicting port on a new form
    await page.click('#newConnectionBtnFooter');
    await page.fill('#localPort', '5601');
    await expect(page.locator('#portConflictWarning')).not.toHaveClass(/hidden/);

    // Reset form
    await page.click('#newConnectionBtnFooter');
    await expect(page.locator('#portConflictWarning')).toHaveClass(/hidden/);
  });

  test('warning updates in real-time as the user types', async ({ page }) => {
    await createConnection(page, { name: 'Port 5432 Conn', localPort: '5432' });

    await page.click('#newConnectionBtnFooter');
    const warning = page.locator('#portConflictWarning');

    // Type a non-conflicting port first
    await page.fill('#localPort', '1234');
    await expect(warning).toHaveClass(/hidden/);

    // Type the conflicting port
    await page.fill('#localPort', '5432');
    await expect(warning).not.toHaveClass(/hidden/);

    // Clear the field
    await page.fill('#localPort', '');
    await expect(warning).toHaveClass(/hidden/);
  });
});
