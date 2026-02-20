const { test: base } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');

// Extend Playwright's test with our Electron app fixture
const test = base.extend({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..', '..', 'main.js')],
      env: { ...process.env, E2E_TEST: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
    });
    await use(electronApp);
    await electronApp.close();
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    // Wait for the app to finish loading
    await page.waitForLoadState('domcontentloaded');
    // Wait for renderer.js DOMContentLoaded handler to run
    await page.waitForSelector('#connectionGroups', { state: 'attached' });
    await use(page);
  },
});

/**
 * Clear all app state from localStorage
 */
async function clearAppState(page) {
  await page.evaluate(() => {
    localStorage.clear();
    // Set onboarding complete so it doesn't block other tests
    localStorage.setItem('ssmOnboardingComplete', 'true');
  });
  // Reload so the app picks up the cleared state
  await page.reload();
  await page.waitForSelector('#connectionGroups', { state: 'attached' });
}

/**
 * Fill the connection form with test data
 */
async function fillConnectionForm(page, {
  name = 'Test Connection',
  profile = 'dev',
  service = 'opensearch',
  target = 'i-0abc123def4567890',
  host = 'test-host.us-east-1.es.amazonaws.com',
  region = 'us-east-1',
  localPort = '5601',
  notes = '',
  group = '',
} = {}) {
  await page.fill('#connectionName', name);
  await page.selectOption('#profileSelect', profile);
  // Radio input is hidden behind a styled label; set it programmatically
  await page.evaluate((svc) => {
    const radio = document.querySelector(`input[name="service"][value="${svc}"]`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }, service);
  await page.fill('#targetInstance', target);
  await page.fill('#serviceHost', host);
  await page.selectOption('#region', region);
  if (localPort) {
    await page.fill('#localPort', localPort);
  }
  if (notes) {
    await page.fill('#connectionNotes', notes);
  }
  if (group) {
    await page.selectOption('#connectionGroup', group);
  }
}

/**
 * Save the current form as a connection
 */
async function saveConnection(page) {
  await page.click('#saveBtn');
  // Wait for toast to confirm save
  await page.waitForSelector('.toast', { state: 'attached', timeout: 3000 });
}

/**
 * Create and save a connection in one step
 */
async function createConnection(page, options = {}) {
  await fillConnectionForm(page, options);
  await saveConnection(page);
}

module.exports = { test, clearAppState, fillConnectionForm, saveConnection, createConnection };
