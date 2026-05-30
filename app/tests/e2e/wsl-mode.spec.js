const { expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');
const { test, clearAppState } = require('./fixtures');

// Click the visible track on the onboarding WSL toggle (always in sidebar footer)
const clickWslOnboardingToggle = (page) =>
  page.click('#wslModeOnboardingContainer .wsl-toggle-track');

test.describe('WSL Mode', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  // ── Visibility ──────────────────────────────────────────────────────────────

  test('wsl toggle is visible in onboarding modal on windows', async ({ page }) => {
    const container = page.locator('#wslModeOnboardingContainer');
    await expect(container).not.toHaveClass(/hidden/);
  });

  test('wsl toggle is hidden on non-windows platforms', async () => {
    const app = await electron.launch({
      args: [path.join(__dirname, '..', '..', 'main.js')],
      env: { ...process.env, E2E_TEST: '1', MOCK_PLATFORM: 'darwin' },
    });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('#connectionGroups', { state: 'attached' });

      await expect(page.locator('#wslModeOnboardingContainer')).toHaveClass(/hidden/);
    } finally {
      await app.close();
    }
  });

  // ── Default state ───────────────────────────────────────────────────────────

  test('wsl mode is off by default', async ({ page }) => {
    const stored = await page.evaluate(() => localStorage.getItem('ssmWslMode'));
    expect(stored === null || stored === 'false').toBe(true);
    await expect(page.locator('#wslModeOnboardingToggle')).not.toBeChecked();
  });

  // ── Persistence ─────────────────────────────────────────────────────────────

  test('wsl mode persists as enabled after page reload', async ({ page }) => {
    await clickWslOnboardingToggle(page);
    await expect(page.locator('#wslModeOnboardingToggle')).toBeChecked();

    await page.reload();
    await page.waitForSelector('#connectionGroups', { state: 'attached' });

    const stored = await page.evaluate(() => localStorage.getItem('ssmWslMode'));
    expect(stored).toBe('true');
    await expect(page.locator('#wslModeOnboardingToggle')).toBeChecked();
  });

  test('wsl mode persists as disabled after page reload', async ({ page }) => {
    await clickWslOnboardingToggle(page); // enable
    await clickWslOnboardingToggle(page); // disable

    await page.reload();
    await page.waitForSelector('#connectionGroups', { state: 'attached' });

    await expect(page.locator('#wslModeOnboardingToggle')).not.toBeChecked();
  });

  // ── Profile loading ─────────────────────────────────────────────────────────

  test('profiles come from wsl source when wsl mode is on', async ({ page }) => {
    await clickWslOnboardingToggle(page);

    await page.click('#newConnectionBtnFooter');
    await page.waitForSelector('#profileSelect', { state: 'attached' });

    const options = await page.locator('#profileSelect option').allTextContents();
    // E2E mock returns 'wsl-default', 'wsl-dev' when wslMode is true
    expect(options.some(o => o.includes('wsl-'))).toBe(true);
  });

  test('profiles come from native source when wsl mode is off', async ({ page }) => {
    await page.click('#newConnectionBtnFooter');
    await page.waitForSelector('#profileSelect', { state: 'attached' });

    const options = await page.locator('#profileSelect option').allTextContents();
    expect(options.some(o => o.includes('wsl-'))).toBe(false);
  });

  // ── WSL unavailability ──────────────────────────────────────────────────────

  test('shows error toast when WSL is unavailable and toggle is enabled', async () => {
    const app = await electron.launch({
      args: [path.join(__dirname, '..', '..', 'main.js')],
      env: { ...process.env, E2E_TEST: '1', MOCK_WSL_UNAVAILABLE: '1' },
    });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('#connectionGroups', { state: 'attached' });
      await page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('ssmOnboardingComplete', 'true');
      });
      await page.reload();
      await page.waitForSelector('#connectionGroups', { state: 'attached' });
      await clickWslOnboardingToggle(page);
      await expect(page.locator('.toast.error')).toBeVisible({ timeout: 3000 });
      await expect(page.locator('.toast.error')).toContainText('WSL is not available');
    } finally {
      await app.close();
    }
  });

  test('toggle stays unchecked when WSL is unavailable', async () => {
    const app = await electron.launch({
      args: [path.join(__dirname, '..', '..', 'main.js')],
      env: { ...process.env, E2E_TEST: '1', MOCK_WSL_UNAVAILABLE: '1' },
    });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('#connectionGroups', { state: 'attached' });
      await page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('ssmOnboardingComplete', 'true');
      });
      await page.reload();
      await page.waitForSelector('#connectionGroups', { state: 'attached' });
      await clickWslOnboardingToggle(page);
      await expect(page.locator('#wslModeOnboardingToggle')).not.toBeChecked({ timeout: 3000 });
    } finally {
      await app.close();
    }
  });

  test('wsl mode is not saved to localStorage when WSL is unavailable', async () => {
    const app = await electron.launch({
      args: [path.join(__dirname, '..', '..', 'main.js')],
      env: { ...process.env, E2E_TEST: '1', MOCK_WSL_UNAVAILABLE: '1' },
    });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('#connectionGroups', { state: 'attached' });
      await page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('ssmOnboardingComplete', 'true');
      });
      await page.reload();
      await page.waitForSelector('#connectionGroups', { state: 'attached' });
      await clickWslOnboardingToggle(page);
      // Wait for async revert to complete before reading localStorage
      await expect(page.locator('#wslModeOnboardingToggle')).not.toBeChecked({ timeout: 3000 });
      const stored = await page.evaluate(() => localStorage.getItem('ssmWslMode'));
      expect(stored === null || stored === 'false').toBe(true);
    } finally {
      await app.close();
    }
  });
});
