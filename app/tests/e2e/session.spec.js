const { expect } = require('@playwright/test');
const { test, clearAppState, fillConnectionForm } = require('./fixtures');

test.describe('Session', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('should start a session and show connected status', async ({ page }) => {
    await fillConnectionForm(page, { name: 'Session Test' });

    // Click Start Session
    await page.click('#connectBtn');

    // Wait for the session to connect (mock sends connected after 150ms)
    await page.waitForTimeout(300);

    // Terminal modal should be visible
    await expect(page.locator('#terminalModal')).not.toHaveClass(/hidden/);

    // Status should show connected
    await expect(page.locator('#terminalStatus')).toHaveText('Connected');
    await expect(page.locator('#terminalStatus')).toHaveClass(/connected/);

    // Connect button should change to "Stop Session"
    await expect(page.locator('#connectBtn')).toHaveText('Stop Session');

    // Connection should show active dot in sidebar
    await expect(page.locator('.connection-item[data-name="Session Test"] .connection-active-dot')).toBeVisible();
  });

  test('should stop a session and return to idle state', async ({ page }) => {
    await fillConnectionForm(page, { name: 'Stop Test' });

    // Start session
    await page.click('#connectBtn');
    await page.waitForTimeout(300);
    await expect(page.locator('#connectBtn')).toHaveText('Stop Session');

    // Minimize terminal so it doesn't overlay the button
    await page.click('#terminalMinimize');

    // Stop session
    await page.click('#connectBtn');
    await page.waitForTimeout(200);

    // Button should return to "Start Session"
    await expect(page.locator('#connectBtn')).toHaveText('Start Session');

    // Active dot should be gone
    await expect(page.locator('.connection-active-dot')).toHaveCount(0);
  });

  test('should show terminal with session info', async ({ page }) => {
    await fillConnectionForm(page, { name: 'Terminal Info', localPort: '9200' });

    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    // Terminal info should show local port
    await expect(page.locator('#terminalInfo')).toContainText('9200');
  });

  test('should show connecting dot while session starts', async ({ page }) => {
    await fillConnectionForm(page, { name: 'Connecting Dot' });

    // Start session - the connecting dot appears briefly
    await page.click('#connectBtn');

    // The connecting dot should appear (it's set synchronously before the await)
    await expect(page.locator('.connection-connecting-dot').or(page.locator('.connection-active-dot'))).toBeVisible({ timeout: 2000 });
  });
});
