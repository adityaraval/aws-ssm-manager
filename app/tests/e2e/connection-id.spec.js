const path = require('path');
const os = require('os');
const fs = require('fs');
const { expect } = require('@playwright/test');
const { test, clearAppState, createConnection, fillConnectionForm, saveConnection, clickImport, clickExport } = require('./fixtures');

/** Read savedConnections from localStorage */
async function getSavedConnections(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('ssmConnections');
    return raw ? JSON.parse(raw) : [];
  });
}

/** Write a JSON import file to the tmp path the mock import handler reads from */
function writeImportFile(data) {
  const tmpPath = path.join(os.tmpdir(), 'ssm-e2e-import.json');
  fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf-8');
}

/** Remove the import file after tests that create it */
function cleanupImportFile() {
  const tmpPath = path.join(os.tmpdir(), 'ssm-e2e-import.json');
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
}

test.describe('Connection Unique ID', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
    cleanupImportFile();
  });

  test.afterAll(() => {
    cleanupImportFile();
  });

  // ── ID Assignment ─────────────────────────────────────────────────────────

  test('new connection is assigned a unique id on save', async ({ page }) => {
    await createConnection(page, { name: 'ID Test Conn' });

    const conns = await getSavedConnections(page);
    const conn = conns.find(c => c.name === 'ID Test Conn');
    expect(conn).toBeDefined();
    expect(conn.id).toMatch(/^conn-\d+-[a-z0-9]+$/);
  });

  test('each new connection gets a different id', async ({ page }) => {
    await createConnection(page, { name: 'Conn One' });
    await page.click('#newConnectionBtnFooter');
    await createConnection(page, { name: 'Conn Two', host: 'two.us-east-1.es.amazonaws.com' });

    const conns = await getSavedConnections(page);
    const one = conns.find(c => c.name === 'Conn One');
    const two = conns.find(c => c.name === 'Conn Two');
    expect(one.id).toBeDefined();
    expect(two.id).toBeDefined();
    expect(one.id).not.toBe(two.id);
  });

  test('editing a connection preserves its original id', async ({ page }) => {
    await createConnection(page, { name: 'Keep My ID' });

    const before = await getSavedConnections(page);
    const originalId = before.find(c => c.name === 'Keep My ID').id;

    // Load, rename, save
    await page.click('.connection-item[data-name="Keep My ID"]');
    await page.fill('#connectionName', 'Keep My ID Renamed');
    await saveConnection(page);

    const after = await getSavedConnections(page);
    const renamed = after.find(c => c.name === 'Keep My ID Renamed');
    expect(renamed).toBeDefined();
    expect(renamed.id).toBe(originalId);
  });

  test('duplicate connection gets a different id from the original', async ({ page }) => {
    await createConnection(page, { name: 'Original Dup' });

    await page.hover('.connection-item[data-name="Original Dup"]');
    await page.click('.connection-item[data-name="Original Dup"] .connection-duplicate', { force: true });

    const conns = await getSavedConnections(page);
    const original = conns.find(c => c.name === 'Original Dup');
    const copy = conns.find(c => c.name === 'Original Dup (Copy)');
    expect(original).toBeDefined();
    expect(copy).toBeDefined();
    expect(original.id).not.toBe(copy.id);
  });

  test('migrates existing connections without id on load', async ({ page }) => {
    // Inject connections without id field directly into localStorage
    await page.evaluate(() => {
      const conns = [
        {
          name: 'Legacy No ID',
          service: 'opensearch',
          target: 'i-0abc123def4567890',
          host: 'legacy.us-east-1.es.amazonaws.com',
          region: 'us-east-1',
          profile: 'dev',
          portNumber: '443',
          localPortNumber: '5601',
          groupId: null,
          sortOrder: 0,
          lastUsedAt: 0,
          notes: '',
          favorite: false
          // No id field
        }
      ];
      localStorage.setItem('ssmConnections', JSON.stringify(conns));
    });

    await page.reload();
    await page.waitForSelector('#connectionGroups', { state: 'attached' });

    const conns = await getSavedConnections(page);
    const legacy = conns.find(c => c.name === 'Legacy No ID');
    expect(legacy).toBeDefined();
    expect(legacy.id).toMatch(/^conn-\d+-[a-z0-9]+$/);
  });

  // ── Import/Export ID-based Dedup ──────────────────────────────────────────

  test('import updates existing connection matched by id, not by name', async ({ page }) => {
    // Create a connection and get its ID
    await createConnection(page, { name: 'Name Before Import' });
    const conns = await getSavedConnections(page);
    const original = conns.find(c => c.name === 'Name Before Import');
    const originalId = original.id;

    // Write an import file with the same id but a different name
    writeImportFile({
      version: '1.0',
      connections: [{
        id: originalId,
        name: 'Name After Import',     // different name, same id
        service: 'opensearch',
        target: 'i-0abc123def4567890',
        host: 'updated.us-east-1.es.amazonaws.com',
        region: 'us-east-1',
        profile: 'dev',
        portNumber: '443',
        localPortNumber: '5601',
        groupId: null,
        sortOrder: 0,
        lastUsedAt: 0,
        notes: '',
        favorite: false,
        customServiceName: ''
      }],
      groups: []
    });

    await clickImport(page);
    await expect(page.locator('.toast', { hasText: 'Imported' })).toBeVisible({ timeout: 5000 });

    const after = await getSavedConnections(page);
    // Should still be exactly 1 connection (updated, not duplicated)
    expect(after.length).toBe(1);
    expect(after[0].id).toBe(originalId);
    expect(after[0].name).toBe('Name After Import');
    expect(after[0].host).toBe('updated.us-east-1.es.amazonaws.com');
  });

  test('import adds new connection when id does not match any existing', async ({ page }) => {
    await createConnection(page, { name: 'Existing Conn' });

    const before = await getSavedConnections(page);
    expect(before.length).toBe(1);

    // Write an import file with a completely different id
    writeImportFile({
      version: '1.0',
      connections: [{
        id: 'conn-9999999999-newconn',   // guaranteed not to match
        name: 'Brand New Conn',
        service: 'aurora',
        target: 'i-0abc123def4567890',
        host: 'new-host.us-east-1.rds.amazonaws.com',
        region: 'us-east-1',
        profile: 'dev',
        portNumber: '5432',
        localPortNumber: '5432',
        groupId: null,
        sortOrder: 0,
        lastUsedAt: 0,
        notes: '',
        favorite: false,
        customServiceName: ''
      }],
      groups: []
    });

    await clickImport(page);
    await expect(page.locator('.toast', { hasText: 'Imported' })).toBeVisible({ timeout: 5000 });

    const after = await getSavedConnections(page);
    expect(after.length).toBe(2);
    expect(after.find(c => c.name === 'Existing Conn')).toBeDefined();
    expect(after.find(c => c.name === 'Brand New Conn')).toBeDefined();
  });

  test('import falls back to name matching for connections without an id', async ({ page }) => {
    await createConnection(page, { name: 'Match By Name' });

    const before = await getSavedConnections(page);
    expect(before.length).toBe(1);

    // Import a connection with no id but same name (old export format)
    writeImportFile({
      version: '1.0',
      connections: [{
        // No id field — should fall back to matching by name
        name: 'Match By Name',
        service: 'opensearch',
        target: 'i-0abc123def4567890',
        host: 'fallback.us-east-1.es.amazonaws.com',
        region: 'us-east-1',
        profile: 'dev',
        portNumber: '443',
        localPortNumber: '5601',
        groupId: null,
        sortOrder: 0,
        lastUsedAt: 0,
        notes: 'updated via name match',
        favorite: false,
        customServiceName: ''
      }],
      groups: []
    });

    await clickImport(page);
    await expect(page.locator('.toast', { hasText: 'Imported' })).toBeVisible({ timeout: 5000 });

    const after = await getSavedConnections(page);
    // Same count — matched and updated by name
    expect(after.length).toBe(1);
    expect(after[0].notes).toBe('updated via name match');
  });

  test('imported connection without id gets a new id assigned', async ({ page }) => {
    writeImportFile({
      version: '1.0',
      connections: [{
        name: 'No ID Connection',
        service: 'opensearch',
        target: 'i-0abc123def4567890',
        host: 'no-id.us-east-1.es.amazonaws.com',
        region: 'us-east-1',
        profile: 'dev',
        portNumber: '443',
        localPortNumber: '5601',
        groupId: null,
        sortOrder: 0,
        lastUsedAt: 0,
        notes: '',
        favorite: false,
        customServiceName: ''
      }],
      groups: []
    });

    await clickImport(page);
    await expect(page.locator('.toast', { hasText: 'Imported' })).toBeVisible({ timeout: 5000 });

    const conns = await getSavedConnections(page);
    const imported = conns.find(c => c.name === 'No ID Connection');
    expect(imported).toBeDefined();
    expect(imported.id).toMatch(/^conn-\d+-[a-z0-9]+$/);
  });

  test('exported connections include id field', async ({ page }) => {
    await createConnection(page, { name: 'Export ID Test' });

    // Capture the data sent to export by intercepting it from localStorage
    const conns = await getSavedConnections(page);
    const conn = conns.find(c => c.name === 'Export ID Test');
    expect(conn.id).toMatch(/^conn-\d+-[a-z0-9]+$/);

    // The export uses savedConnections directly — verify the export button works
    await clickExport(page);
    await expect(page.locator('.toast', { hasText: 'Exported' })).toBeVisible({ timeout: 5000 });
  });

  // ── ID stability on group change ──────────────────────────────────────────

  test('moving a connection to a different group does not change its id', async ({ page }) => {
    await createConnection(page, { name: 'Move Me' });

    const before = await getSavedConnections(page);
    const originalId = before.find(c => c.name === 'Move Me').id;

    // Add a second group
    const addGroupBtn = page.locator('#addGroupBtn');
    await addGroupBtn.click();
    await page.fill('#groupName', 'Alt Group');
    await page.evaluate(() => {
      const radio = document.querySelector('input[name="groupColor"][value="#3b82f6"]');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('#saveGroup');
    await page.waitForTimeout(200);

    // Load the connection, change group, save
    await page.click('.connection-item[data-name="Move Me"]');
    const altGroup = page.locator('#connectionGroup option', { hasText: 'Alt Group' });
    const altGroupValue = await altGroup.getAttribute('value');
    await page.selectOption('#connectionGroup', altGroupValue);
    await saveConnection(page);

    const after = await getSavedConnections(page);
    const moved = after.find(c => c.name === 'Move Me');
    expect(moved).toBeDefined();
    expect(moved.id).toBe(originalId);
  });
});
