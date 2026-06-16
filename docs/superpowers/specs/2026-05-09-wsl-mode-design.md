# WSL Mode for Windows — Design Spec

**Date:** 2026-05-09
**Status:** Approved

---

## Overview

Introduce an opt-in WSL Mode toggle for Windows users. When enabled, all command execution (session spawning) and prerequisite checks are routed through `wsl.exe --` instead of running native Windows binaries, and AWS profiles are read from the WSL Linux home's `~/.aws/`. The toggle is only rendered on Windows and is invisible on macOS/Linux.

---

## Decisions

| Question | Decision |
|---|---|
| WSL distribution | Default distro only (`wsl.exe --`) |
| Credentials/profiles source | WSL's `~/.aws/` (Linux side) when WSL mode is on |
| Platform availability | Toggle only rendered on Windows (`process.platform === 'win32'`) |
| Toggle persistence | `localStorage` key `ssmWslMode` (`'true'`/`'false'`) |
| UI placement | Settings panel + onboarding prerequisites modal |
| Process termination | `taskkill` unchanged; `wsl.exe` is a Windows process with a Windows PID |
| Detached flag | Remains `false` on Windows regardless of WSL mode |

---

## Architecture

### Platform detection in renderer (`renderer.js`)

Add a `get-platform` IPC handler in `main.js`, expose it via `preload.js`. On `DOMContentLoaded`, call it once and store in a module-level `let platform`. Use it to show/hide WSL-specific UI elements.

```js
// renderer.js
let platform = 'unknown';

// inside DOMContentLoaded:
platform = await window.electronAPI.getPlatform();
if (platform === 'win32') {
  document.getElementById('wslModeContainer').classList.remove('hidden');
  document.getElementById('wslModeOnboardingContainer').classList.remove('hidden');
}
```

### New IPC channel (`preload.js` + `main.js`)

```js
// preload.js — add to contextBridge expose
getPlatform: () => ipcRenderer.invoke('get-platform'),
```

```js
// main.js
ipcMain.handle('get-platform', () => process.platform);
```

### WSL mode storage (`renderer.js`)

```js
function getWslMode() {
  return localStorage.getItem('ssmWslMode') === 'true';
}
function setWslMode(enabled) {
  safeSetItem('ssmWslMode', String(enabled));
}
```

### Profile parsing helper (`main.js`)

Extract the existing profile-parsing regex from `get-profiles` into a shared `parseProfiles(text)` helper so it can be reused for both the Windows file-read path and the WSL stdout path:

```js
function parseProfiles(text) {
  const profiles = new Set();
  const regex = /\[(?:profile )?([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    if (name !== 'default') profiles.add(name);
  }
  if (/\[default\]/.test(text)) profiles.add('default');
  return Array.from(profiles);
}
```

### `get-profiles` IPC — read from WSL (`main.js`)

The existing handler reads `~/.aws/config` and `~/.aws/credentials` via `fs.readFileSync`. When `wslMode` is true, run the same files through `wsl.exe` and parse the stdout:

```js
ipcMain.handle('get-profiles', async (event, { wslMode } = {}) => {
  if (wslMode && process.platform === 'win32') {
    const { stdout } = await execFileAsync('wsl.exe', [
      '--', 'sh', '-c',
      'cat ~/.aws/config 2>/dev/null; echo ""; cat ~/.aws/credentials 2>/dev/null'
    ]);
    return parseProfiles(stdout);
  }
  // existing Windows/macOS/Linux file-read path (refactored to use parseProfiles)
});
```

### `check-prerequisites` IPC — run checks through WSL (`main.js`)

The handler must accept `{ wslMode }` as an argument. When `wslMode` is true, skip `resolveExecutable` and run all checks through `wsl.exe`:

```js
ipcMain.handle('check-prerequisites', async (event, { wslMode } = {}) => {
  const result = { awsCli: {}, ssmPlugin: {}, credentials: {} };

  if (wslMode && process.platform === 'win32') {
    // AWS CLI
    try {
      const { stdout } = await execFileAsync('wsl.exe', ['--', 'aws', '--version']);
      result.awsCli.installed = true;
      result.awsCli.version = stdout.trim();
    } catch {
      result.awsCli.installed = false;
    }

    // SSM Plugin
    try {
      await execFileAsync('wsl.exe', ['--', 'session-manager-plugin', '--version']);
      result.ssmPlugin.installed = true;
    } catch {
      result.ssmPlugin.installed = false;
    }

    // Credentials
    try {
      const { stdout } = await execFileAsync('wsl.exe', [
        '--', 'sh', '-c',
        'cat ~/.aws/config 2>/dev/null; cat ~/.aws/credentials 2>/dev/null'
      ]);
      const profiles = parseProfiles(stdout);
      result.credentials.configured = profiles.length > 0;
      result.credentials.profileCount = profiles.length;
    } catch {
      result.credentials.configured = false;
      result.credentials.profileCount = 0;
    }

    return result;
  }

  // existing non-WSL path unchanged below
});
```

### `SSMSession` — command routing through WSL (`ssm-session.js`)

The constructor already receives the full `config` object. Add a branch in `start()` before the existing `spawn` call:

```js
// ssm-session.js — inside start()
if (this.config.wslMode && process.platform === 'win32') {
  this.process = spawn('wsl.exe', ['--', 'aws', ...args], {
    detached: false,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      TEMP: process.env.TEMP,
      TMP: process.env.TMP
    }
  });
} else {
  // existing path unchanged
  const awsExecutable = resolveExecutable('aws', extraCandidates);
  this.process = spawn(awsExecutable, args, {
    detached: process.platform !== 'win32',
    env: safeEnv
  });
}
```

The `env` for WSL mode is stripped to Windows-level vars only — `wsl.exe` is a Windows process; AWS credentials and PATH inside WSL are managed by the Linux environment. Profile and region are already passed as CLI args (`--profile`, `--region`), so no AWS env vars need to cross the boundary.

Process termination is unchanged — `taskkill /pid <pid> /T /F` works because the spawned process is `wsl.exe`, a Windows process with a normal Windows PID.

### Passing `wslMode` through the call chain (`renderer.js`)

```js
// Session start
const config = { ...formConfig, wslMode: getWslMode() };
window.electronAPI.startSSMSession(config);

// Profile loading (all call sites)
window.electronAPI.getProfiles({ wslMode: getWslMode() });

// Prerequisite checks
window.electronAPI.checkPrerequisites({ wslMode: getWslMode() });
```

---

## UI

### Settings panel (`index.html`)

Add a WSL Mode row after the session timeout row, hidden by default:

```html
<div id="wslModeContainer" class="hidden flex items-center justify-between py-2">
  <div>
    <span class="text-sm font-medium">WSL Mode</span>
    <p class="text-xs text-base-content/60">Run AWS commands inside WSL</p>
  </div>
  <input type="checkbox" id="wslModeToggle" class="toggle toggle-primary toggle-sm" />
</div>
```

### Onboarding / prerequisites modal (`index.html`)

Add a WSL Mode toggle before the "Run Checks" button in the onboarding modal, hidden by default:

```html
<div id="wslModeOnboardingContainer" class="hidden mb-3">
  <label class="flex items-center gap-2 cursor-pointer">
    <input type="checkbox" id="wslModeOnboardingToggle" class="toggle toggle-primary toggle-sm" />
    <span class="text-sm">Use WSL for AWS commands (Windows only)</span>
  </label>
</div>
```

Both toggles share `ssmWslMode` via `setWslMode()` and mirror each other — changing one updates the other.

---

## Critical Files

| File | Change |
|---|---|
| `app/main.js` | Add `get-platform` handler; extract `parseProfiles()` helper; update `get-profiles` and `check-prerequisites` to accept and act on `wslMode` |
| `app/ssm-session.js` | Branch on `config.wslMode` in `start()` to spawn `wsl.exe -- aws ...` with stripped env |
| `app/preload.js` | Expose `getPlatform`; update `getProfiles` and `checkPrerequisites` signatures to forward `{ wslMode }` |
| `app/renderer.js` | Detect platform on startup; show/hide WSL UI; `getWslMode`/`setWslMode` helpers; sync both toggles; pass `wslMode` to all IPC calls |
| `app/index.html` | WSL toggle in settings panel (after session timeout row) and onboarding modal (before Run Checks button) |

---

## E2E Mock IPC Handlers

The E2E test block in `main.js` (`E2E_TEST === '1'`) must be updated for the three affected channels.

**`get-platform`** — new mock, always returns `'win32'` so the WSL toggle is visible in all E2E test runs regardless of the host OS:

```js
ipcMain.handle('get-platform', () => 'win32');
```

**`get-profiles`** — update to accept `{ wslMode }` and return a distinct profile list when WSL mode is on, so tests can assert the correct source is used:

```js
// Before
ipcMain.handle('get-profiles', async () => ['default', 'dev', 'staging']);

// After
ipcMain.handle('get-profiles', async (event, { wslMode } = {}) => {
  return wslMode
    ? ['wsl-default', 'wsl-dev']   // sentinel values identifying the WSL path
    : ['default', 'dev', 'staging'];
});
```

**`check-prerequisites`** — update to accept `{ wslMode }` and return results that reflect the WSL path when the flag is set (version string differs so tests can assert on it):

```js
// Before
ipcMain.handle('check-prerequisites', async () => ({
  awsCli:      { installed: true, version: 'aws-cli/2.x.x' },
  ssmPlugin:   { installed: true },
  credentials: { configured: true, profileCount: 3 }
}));

// After
ipcMain.handle('check-prerequisites', async (event, { wslMode } = {}) => ({
  awsCli:      { installed: true, version: wslMode ? 'aws-cli/2.x.x (wsl)' : 'aws-cli/2.x.x' },
  ssmPlugin:   { installed: true },
  credentials: { configured: true, profileCount: wslMode ? 2 : 3 }
}));
```

`start-ssm-session` — no mock change required; `wslMode` is an extra field on the config object that the mock ignores, and the terminal/status flow is unchanged.

---

## E2E Test Cases

New file: `app/tests/e2e/wsl-mode.spec.js`

```js
test.describe('WSL Mode', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  // ── Visibility ──────────────────────────────────────────────────────────────

  test('wsl toggle is visible in settings panel on windows', async ({ page }) => {
    // E2E mock returns 'win32' for get-platform
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
    // null (never set) or 'false' both mean off
    expect(stored === null || stored === 'false').toBe(true);
    await expect(page.locator('#wslModeToggle')).not.toBeChecked();
  });

  // ── Persistence ─────────────────────────────────────────────────────────────

  test('wsl mode persists as enabled after page reload', async ({ page }) => {
    await page.click('#wslModeToggle');
    await expect(page.locator('#wslModeToggle')).toBeChecked();

    await page.reload();
    await page.waitForSelector('#connectionGroups', { state: 'attached' });

    const stored = await page.evaluate(() => localStorage.getItem('ssmWslMode'));
    expect(stored).toBe('true');
    await expect(page.locator('#wslModeToggle')).toBeChecked();
  });

  test('wsl mode persists as disabled after page reload', async ({ page }) => {
    // Turn on then off
    await page.click('#wslModeToggle');
    await page.click('#wslModeToggle');

    await page.reload();
    await page.waitForSelector('#connectionGroups', { state: 'attached' });

    await expect(page.locator('#wslModeToggle')).not.toBeChecked();
  });

  // ── Toggle sync ─────────────────────────────────────────────────────────────

  test('enabling wsl in settings panel syncs to onboarding toggle', async ({ page }) => {
    await page.click('#wslModeToggle');
    await expect(page.locator('#wslModeOnboardingToggle')).toBeChecked();
  });

  test('enabling wsl in onboarding modal syncs to settings toggle', async ({ page }) => {
    await page.click('#wslModeOnboardingToggle');
    await expect(page.locator('#wslModeToggle')).toBeChecked();
  });

  // ── Profile loading ─────────────────────────────────────────────────────────

  test('profiles come from wsl source when wsl mode is on', async ({ page }) => {
    await page.click('#wslModeToggle');

    // Trigger profile reload (open form for a new connection)
    await page.click('#newConnectionBtnFooter');
    await page.waitForSelector('#connectionProfile', { state: 'attached' });

    const options = await page.locator('#connectionProfile option').allTextContents();
    // Mock returns 'wsl-default', 'wsl-dev' when wslMode is true
    expect(options.some(o => o.includes('wsl-'))).toBe(true);
  });

  test('profiles come from native source when wsl mode is off', async ({ page }) => {
    await page.click('#newConnectionBtnFooter');
    await page.waitForSelector('#connectionProfile', { state: 'attached' });

    const options = await page.locator('#connectionProfile option').allTextContents();
    expect(options.some(o => o.includes('wsl-'))).toBe(false);
  });

  // ── Prerequisites check ─────────────────────────────────────────────────────

  test('prerequisites check reflects wsl source when wsl mode is on', async ({ page }) => {
    await page.click('#wslModeOnboardingToggle');

    // Open onboarding and run checks
    await page.evaluate(() => {
      localStorage.removeItem('ssmOnboardingComplete');
    });
    await page.reload();
    await page.waitForSelector('#onboardingModal', { state: 'visible' });

    await page.click('#runChecksBtn');
    await page.waitForSelector('#awsCliStatus', { state: 'visible' });

    // Mock returns 'aws-cli/2.x.x (wsl)' when wslMode is true
    const cliText = await page.locator('#awsCliStatus').textContent();
    expect(cliText).toContain('wsl');
  });
});
```

---

## Testing

1. **Non-Windows (real device)**: Toggle never appears; no behaviour change for macOS/Linux users. Verified by code inspection — the E2E mock always returns `'win32'` so this path is not covered by automated tests.
2. **Windows, WSL mode off**: Existing behaviour unchanged — native `aws.exe` is spawned directly.
3. **Windows, WSL mode on, prerequisites check**: Executes `wsl.exe -- aws --version` and `wsl.exe -- session-manager-plugin --version`; results display correctly.
4. **Windows, WSL mode on, profiles**: Profile dropdown is populated from WSL's `~/.aws/`.
5. **Windows, WSL mode on, session start**: Terminal streams output from `wsl.exe -- aws ssm start-session ...`; "Stop" terminates successfully via `taskkill`.
6. **Toggle persistence**: WSL mode state survives app restart.
7. **Toggle sync**: Changing either toggle reflects immediately in the other.
