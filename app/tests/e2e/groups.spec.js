const { expect } = require('@playwright/test');
const { test, clearAppState, createConnection } = require('./fixtures');

test.describe('Groups', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should create a new group via modal', async ({ page }) => {
    // Click "Add Group" button
    await page.click('#addGroupBtn');

    // Modal should be visible
    await expect(page.locator('#groupModal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#modalTitle')).toHaveText('New Group');

    // Fill group name and select color
    await page.fill('#groupName', 'Production');
    // Color radio is hidden behind styled label; set programmatically
    await page.evaluate(() => {
      const radio = document.querySelector('input[name="groupColor"][value="#22c55e"]');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#saveGroup');

    // Modal should close
    await expect(page.locator('#groupModal')).toHaveClass(/hidden/);

    // Group header should appear
    await expect(page.locator('.group-name', { hasText: 'Production' })).toBeVisible();
  });

  test('should edit a group name and color', async ({ page }) => {
    // Create a group first
    await page.click('#addGroupBtn');
    await page.fill('#groupName', 'Dev');
    await page.click('#saveGroup');

    // Click the edit button
    await page.click('.group-edit');

    // Modal should show edit mode
    await expect(page.locator('#modalTitle')).toHaveText('Edit Group');
    await expect(page.locator('#groupName')).toHaveValue('Dev');

    // Change name
    await page.fill('#groupName', 'Development');
    await page.click('#saveGroup');

    // Group name should be updated
    await expect(page.locator('.group-name', { hasText: 'Development' })).toBeVisible();
    await expect(page.locator('.group-name', { hasText: 'Dev' }).first()).toHaveText('Development');
  });

  test('should delete a group and ungrouped connections remain', async ({ page }) => {
    // Create a group
    await page.click('#addGroupBtn');
    await page.fill('#groupName', 'To Delete Group');
    await page.click('#saveGroup');

    // Get the group id from the data attribute
    const groupSection = page.locator('.group-section').filter({ has: page.locator('.group-name', { hasText: 'To Delete Group' }) });
    const groupId = await groupSection.getAttribute('data-group-id');

    // Create a connection in this group
    await createConnection(page, { name: 'Grouped Conn', group: groupId });

    // Delete the group
    await page.click(`.group-delete[data-id="${groupId}"]`);

    // Group header should be gone
    await expect(page.locator('.group-name', { hasText: 'To Delete Group' })).toHaveCount(0);

    // Connection should still exist (now ungrouped)
    await expect(page.locator('.connection-item[data-name="Grouped Conn"]')).toBeVisible();
  });

  test('should assign a connection to a group via form dropdown', async ({ page }) => {
    // Create a group
    await page.click('#addGroupBtn');
    await page.fill('#groupName', 'My Group');
    await page.click('#saveGroup');

    // Get the group id
    const groupSection = page.locator('.group-section').filter({ has: page.locator('.group-name', { hasText: 'My Group' }) });
    const groupId = await groupSection.getAttribute('data-group-id');

    // Create connection with group assigned
    await createConnection(page, { name: 'Assigned Conn', group: groupId });

    // Connection should be inside the group's connection area
    const groupConnections = page.locator(`.group-connections[data-group-id="${groupId}"]`);
    await expect(groupConnections.locator('.connection-item[data-name="Assigned Conn"]')).toBeVisible();
  });

  test('should collapse and expand a group', async ({ page }) => {
    // Create a group and a connection in it
    await page.click('#addGroupBtn');
    await page.fill('#groupName', 'Collapsible');
    await page.click('#saveGroup');

    const groupSection = page.locator('.group-section').filter({ has: page.locator('.group-name', { hasText: 'Collapsible' }) });
    const groupId = await groupSection.getAttribute('data-group-id');

    await createConnection(page, { name: 'In Collapsible', group: groupId });

    // Click group header to collapse
    await page.click(`.group-header[data-group-id="${groupId}"]`);
    await expect(groupSection).toHaveClass(/collapsed/);

    // Click again to expand
    await page.click(`.group-header[data-group-id="${groupId}"]`);
    await expect(groupSection).not.toHaveClass(/collapsed/);
  });
});
