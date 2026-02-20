const { expect } = require('@playwright/test');
const { test } = require('./fixtures');

/** Clear state without setting onboarding complete flag */
async function clearForOnboarding(page) {
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.waitForSelector('#connectionGroups', { state: 'attached' });
}

test.describe('Onboarding', () => {
  test('should show onboarding wizard on first launch', async ({ page }) => {
    await clearForOnboarding(page);

    // Onboarding modal should be visible
    await expect(page.locator('#onboardingModal')).not.toHaveClass(/hidden/);

    // Should show all prerequisite checks
    await expect(page.locator('#checkAwsCli')).toBeVisible();
    await expect(page.locator('#checkSsmPlugin')).toBeVisible();
    await expect(page.locator('#checkCredentials')).toBeVisible();

    // Mock returns all passing - wait for checks to complete
    await expect(page.locator('#checkAwsCli .onboarding-icon.pass')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#checkSsmPlugin .onboarding-icon.pass')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#checkCredentials .onboarding-icon.pass')).toBeVisible({ timeout: 5000 });
  });

  test('should dismiss onboarding and set localStorage flag', async ({ page }) => {
    await clearForOnboarding(page);

    await expect(page.locator('#onboardingModal')).not.toHaveClass(/hidden/);

    // Click "Get Started"
    await page.click('#onboardingDismiss');

    // Modal should close
    await expect(page.locator('#onboardingModal')).toHaveClass(/hidden/);

    // localStorage flag should be set
    const flag = await page.evaluate(() => localStorage.getItem('ssmOnboardingComplete'));
    expect(flag).toBe('true');
  });

  test('should not show onboarding when flag is already set', async ({ page }) => {
    // Set the flag before reload
    await page.evaluate(() => localStorage.setItem('ssmOnboardingComplete', 'true'));
    await page.reload();
    await page.waitForSelector('#connectionGroups', { state: 'attached' });

    // Onboarding should be hidden
    await expect(page.locator('#onboardingModal')).toHaveClass(/hidden/);
  });
});
