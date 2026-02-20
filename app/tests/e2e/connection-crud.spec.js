const { expect } = require('@playwright/test');
const { test, clearAppState, fillConnectionForm, saveConnection, createConnection } = require('./fixtures');

test.describe('Connection CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should save a new connection and show it in sidebar', async ({ page }) => {
    await createConnection(page, { name: 'My OpenSearch' });

    // Verify connection appears in sidebar
    const item = page.locator('.connection-item[data-name="My OpenSearch"]');
    await expect(item).toBeVisible();
    await expect(item.locator('.connection-name')).toContainText('My OpenSearch');
  });

  test('should load connection into form when clicked', async ({ page }) => {
    await createConnection(page, { name: 'Clickable Conn', host: 'click-host.us-east-1.es.amazonaws.com' });

    // Click the connection in the sidebar
    await page.click('.connection-item[data-name="Clickable Conn"]');

    // Verify form is populated
    await expect(page.locator('#connectionName')).toHaveValue('Clickable Conn');
    await expect(page.locator('#serviceHost')).toHaveValue('click-host.us-east-1.es.amazonaws.com');
    // Form header should show "Edit Connection"
    await expect(page.locator('.form-header h1')).toHaveText('Edit Connection');
  });

  test('should edit a connection name and update sidebar', async ({ page }) => {
    await createConnection(page, { name: 'Original Name' });

    // Click to load
    await page.click('.connection-item[data-name="Original Name"]');

    // Change the name
    await page.fill('#connectionName', 'Updated Name');
    await saveConnection(page);

    // Old name should be gone, new name should appear
    await expect(page.locator('.connection-item[data-name="Original Name"]')).toHaveCount(0);
    // May appear in multiple sections (Recent + Ungrouped), just check at least one exists
    await expect(page.locator('.connection-item[data-name="Updated Name"]').first()).toBeVisible();
  });

  test('should delete a connection via delete button and confirmation modal', async ({ page }) => {
    await createConnection(page, { name: 'To Delete' });

    // Click the delete button on the connection
    await page.click('.connection-item[data-name="To Delete"] .connection-delete');

    // Delete modal should appear
    await expect(page.locator('#deleteModal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#deleteConnectionName')).toHaveText('To Delete');

    // Confirm deletion
    await page.click('#confirmDelete');

    // Connection should be gone
    await expect(page.locator('.connection-item[data-name="To Delete"]')).toHaveCount(0);
  });

  test('should show validation error for invalid instance ID', async ({ page }) => {
    await fillConnectionForm(page, { name: 'Invalid', target: 'invalid-id' });
    await page.click('#saveBtn');

    // Should show error toast
    const toast = page.locator('.toast.error');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('instance ID');
  });

  test('should show validation error when profile is not selected', async ({ page }) => {
    await page.fill('#connectionName', 'No Profile');
    await page.evaluate(() => {
      const radio = document.querySelector('input[name="service"][value="opensearch"]');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.fill('#targetInstance', 'i-0abc123def4567890');
    await page.fill('#serviceHost', 'host.us-east-1.es.amazonaws.com');
    await page.selectOption('#region', 'us-east-1');
    // Don't select a profile
    await page.click('#saveBtn');

    const toast = page.locator('.toast.error');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('profile');
  });

  test('should persist connection notes', async ({ page }) => {
    await createConnection(page, { name: 'With Notes', notes: 'Important note here' });

    // Click to load and verify notes
    await page.click('.connection-item[data-name="With Notes"]');
    await expect(page.locator('#connectionNotes')).toHaveValue('Important note here');
  });

  test('should create multiple connections', async ({ page }) => {
    await createConnection(page, { name: 'Connection A' });

    // Reset form for new connection
    await page.click('#newConnectionBtnFooter');
    await createConnection(page, { name: 'Connection B', host: 'b-host.us-east-1.es.amazonaws.com' });

    // Both should be visible
    await expect(page.locator('.connection-item[data-name="Connection A"]')).toBeVisible();
    await expect(page.locator('.connection-item[data-name="Connection B"]')).toBeVisible();
  });
});
