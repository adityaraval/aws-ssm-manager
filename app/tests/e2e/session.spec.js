const { expect } = require('@playwright/test');
const { test, clearAppState, fillConnectionForm, saveConnection } = require('./fixtures');

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

test.describe('Multiple Simultaneous Sessions', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('two sessions can be active simultaneously with independent sidebar dots', async ({ page }) => {
    // Start first session
    await fillConnectionForm(page, { name: 'Session One', localPort: '5601' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);
    await expect(page.locator('.connection-item[data-name="Session One"] .connection-active-dot')).toBeVisible();

    // Minimize terminal to access the form
    await page.click('#terminalMinimize');

    // Start second session without stopping first
    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, { name: 'Session Two', localPort: '5602', host: 'two.us-east-1.es.amazonaws.com' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    // Both should show active dots
    await expect(page.locator('.connection-item[data-name="Session One"] .connection-active-dot')).toBeVisible();
    await expect(page.locator('.connection-item[data-name="Session Two"] .connection-active-dot')).toBeVisible();
  });

  test('terminal shows a tab for each active session', async ({ page }) => {
    await fillConnectionForm(page, { name: 'Tab One', localPort: '5601' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    await page.click('#terminalMinimize');
    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, { name: 'Tab Two', localPort: '5602', host: 'two.us-east-1.es.amazonaws.com' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    // Two tabs should be visible
    await expect(page.locator('#terminalTabs .terminal-tab')).toHaveCount(2);
    await expect(page.locator('#terminalTabs .terminal-tab', { hasText: 'Tab One' })).toBeVisible();
    await expect(page.locator('#terminalTabs .terminal-tab', { hasText: 'Tab Two' })).toBeVisible();
  });

  test('closing a tab stops that session; other session stays active', async ({ page }) => {
    await fillConnectionForm(page, { name: 'Keep This', localPort: '5601' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    await page.click('#terminalMinimize');
    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, { name: 'Close This', localPort: '5602', host: 'two.us-east-1.es.amazonaws.com' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    // Close the second tab
    const closeThisTab = page.locator('#terminalTabs .terminal-tab', { hasText: 'Close This' });
    await closeThisTab.locator('.terminal-tab-close').click();
    await page.waitForTimeout(300);

    // Only one tab remains
    await expect(page.locator('#terminalTabs .terminal-tab')).toHaveCount(1);

    // Closed session dot is gone; other session still active
    await expect(page.locator('.connection-item[data-name="Close This"] .connection-active-dot')).toHaveCount(0);
    await expect(page.locator('.connection-item[data-name="Keep This"] .connection-active-dot')).toBeVisible();
  });

  test('main modal × stops all sessions and closes modal', async ({ page }) => {
    await fillConnectionForm(page, { name: 'All Stop One', localPort: '5601' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    await page.click('#terminalMinimize');
    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, { name: 'All Stop Two', localPort: '5602', host: 'two.us-east-1.es.amazonaws.com' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    // Click main modal ×
    await page.click('#terminalClose');
    await page.waitForTimeout(300);

    // Modal should be hidden
    await expect(page.locator('#terminalModal')).toHaveClass(/hidden/);

    // Both active dots gone
    await expect(page.locator('.connection-active-dot')).toHaveCount(0);
  });

  test('shows "Max sessions reached" button when 5 sessions are active', async ({ page }) => {
    const ports = ['5601', '5602', '5603', '5604', '5605'];
    const hosts = [
      'test-host.us-east-1.es.amazonaws.com',
      'two.us-east-1.es.amazonaws.com',
      'three.us-east-1.es.amazonaws.com',
      'four.us-east-1.es.amazonaws.com',
      'five.us-east-1.es.amazonaws.com'
    ];

    // First session — no minimize needed
    await fillConnectionForm(page, { name: 'MaxSess0', localPort: ports[0], host: hosts[0] });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    for (let i = 1; i < 5; i++) {
      await page.click('#terminalMinimize');
      await page.click('#newConnectionBtnFooter');
      await fillConnectionForm(page, { name: `MaxSess${i}`, localPort: ports[i], host: hosts[i] });
      await page.click('#connectBtn');
      await page.waitForTimeout(300);
    }

    // Navigate to a new form
    await page.click('#terminalMinimize');
    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, { name: 'Sixth', localPort: '5606', host: 'six.us-east-1.es.amazonaws.com' });

    await expect(page.locator('#connectBtn')).toHaveText('Max sessions reached');
    await expect(page.locator('#connectBtn')).toBeDisabled();
  });

  test('loading a connection with an active session focuses its tab instead of starting a new one', async ({ page }) => {
    await fillConnectionForm(page, { name: 'Focus Tab', localPort: '5601' });
    await page.click('#saveBtn');
    await page.waitForTimeout(200);
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    // Minimize and navigate to a new form
    await page.click('#terminalMinimize');
    await page.click('#newConnectionBtnFooter');
    await expect(page.locator('#terminalTabs .terminal-tab')).toHaveCount(1);

    // Load the connection again
    await page.click('.connection-item[data-name="Focus Tab"]');
    await expect(page.locator('#connectBtn')).toHaveText('Stop Session');

    // Tab count should still be 1 (no duplicate)
    await expect(page.locator('#terminalTabs .terminal-tab')).toHaveCount(1);
  });

  test('unexpected server-side close of one session leaves the other intact', async ({ page }) => {
    await fillConnectionForm(page, { name: 'Survives', localPort: '5601' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    await page.click('#terminalMinimize');
    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, { name: 'Closes', localPort: '5602', host: 'two.us-east-1.es.amazonaws.com' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    // Get the ID of the 'Closes' session from the tab DOM
    const closesId = await page.evaluate(() => {
      const tabs = document.querySelectorAll('#terminalTabs .terminal-tab');
      for (const tab of tabs) {
        if (tab.textContent.includes('Closes')) return tab.dataset.id;
      }
      return null;
    });
    expect(closesId).toBeTruthy();

    // Simulate server-side close by calling handleSessionClosed directly
    await page.evaluate((id) => {
      if (typeof handleSessionClosed === 'function') handleSessionClosed(id);
    }, closesId);
    await page.waitForTimeout(200);

    // Surviving session should still be active
    await expect(page.locator('.connection-item[data-name="Survives"] .connection-active-dot')).toBeVisible();
    await expect(page.locator('.connection-item[data-name="Closes"] .connection-active-dot')).toHaveCount(0);
  });
});
