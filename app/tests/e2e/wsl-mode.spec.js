const { expect } = require('@playwright/test');
const { test, clearAppState } = require('./fixtures');

// Click the visible track on the onboarding WSL toggle (always in sidebar footer)
const clickWslOnboardingToggle = (page) =>
  page.click('#wslModeOnboardingContainer .wsl-toggle-track');

// Click the visible track on the settings-panel WSL toggle (inside connection form)
const clickWslSettingsToggle = (page) =>
  page.click('#wslModeContainer .wsl-toggle-track');

test.describe('WSL Mode', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  // ── Visibility ──────────────────────────────────────────────────────────────

  test('wsl toggle is visible in settings panel on windows', async ({ page }) => {
    const container = page.locator('#wslModeContainer');
    await expect(container).not.toHaveClass(/hidden/);
  });

  test('wsl toggle is visible in onboarding modal on windows', async ({ page }) => {
    const container = page.locator('#wslModeOnboardingContainer');
    await expect(container).not.toHaveClass(/hidden/);
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

  // ── Toggle sync ─────────────────────────────────────────────────────────────

  test('enabling wsl in settings panel syncs to onboarding toggle', async ({ page }) => {
    await page.click('#newConnectionBtnFooter');
    await page.waitForSelector('#wslModeContainer', { state: 'visible' });
    await clickWslSettingsToggle(page);
    await expect(page.locator('#wslModeOnboardingToggle')).toBeChecked();
  });

  test('enabling wsl in onboarding modal syncs to settings toggle', async ({ page }) => {
    await clickWslOnboardingToggle(page);
    await page.click('#newConnectionBtnFooter');
    await page.waitForSelector('#wslModeContainer', { state: 'visible' });
    await expect(page.locator('#wslModeToggle')).toBeChecked();
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

  // ── Prerequisites check ─────────────────────────────────────────────────────

  test('prerequisites check reflects wsl source when wsl mode is on', async ({ page }) => {
    await clickWslOnboardingToggle(page);

    await page.evaluate(() => localStorage.removeItem('ssmOnboardingComplete'));
    await page.reload();
    await page.waitForSelector('#onboardingModal', { state: 'visible' });

    await page.click('#runChecksBtn');
    await page.waitForSelector('#awsCliStatus', { state: 'visible' });

    // E2E mock returns 'aws-cli/2.x.x (wsl)' when wslMode is true
    const cliText = await page.locator('#awsCliStatus').textContent();
    expect(cliText).toContain('wsl');
  });
});
