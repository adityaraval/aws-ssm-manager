# Multiple Simultaneous Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow up to 5 SSM port-forwarding sessions to run simultaneously, each with its own tab in the terminal modal and independent status indicator in the sidebar.

**Architecture:** Replace the single-session globals (`isSessionActive`, `connectionState`, `activeConnectionName`, `activeConnectionConfig`, `terminal`, `fitAddon`) in renderer.js with a `sessions` Map keyed by `connection.id`. Do the same in main.js (replace `currentSession` singleton). IPC events include `id` so each side routes output to the right session. The terminal modal gains a `#terminalTabs` tab bar; each session gets its own xterm mount point div inside `#terminalContainer`.

**Tech Stack:** Electron (main/renderer/preload), xterm.js + FitAddon, Playwright E2E tests (existing `app/tests/e2e/session.spec.js`)

**Spec:** `docs/superpowers/specs/2026-03-26-multiple-simultaneous-sessions-design.md`

---

## File Map

| File | Change |
|---|---|
| `app/preload.js` | Update 3 IPC listeners to pass `id`; update `stopSSMSession(id)`; remove `removeTerminalListeners` |
| `app/main.js` | Replace `currentSession` with `sessions` Map in both real and E2E mock handlers; update all 3 session IPC handlers + window-all-closed cleanup |
| `app/index.html` | Add `<div id="terminalTabs">` between terminal header and body |
| `app/styles.css` | Tab bar styles + per-tab status colour classes |
| `app/renderer.js` | Remove 6 single-session globals; add `sessions` Map + `activeTabId`; rewrite setupTerminal, showTerminal, hideTerminal, startSession, stopSession, handleSessionClosed, setActiveTab, updateSessionButton, renderConnectionItem (sidebar state), checkSessionStatus, startSessionTimer, stopSessionTimer, copyActiveUrl, openActiveUrl |
| `app/tests/e2e/session.spec.js` | Add 7 new multi-session tests; update existing 4 tests to work with tabbed UI |

---

## Task 1: Update preload.js IPC bridge

**Files:**
- Modify: `app/preload.js`

- [ ] **Step 1: Update the three session IPC listeners and stopSSMSession**

Replace the entire session-related block in `app/preload.js`:

```js
// BEFORE
stopSSMSession: () => ipcRenderer.invoke('stop-ssm-session'),
onSessionClosed: (callback) => ipcRenderer.on('session-closed', callback),
onTerminalOutput: (callback) => ipcRenderer.on('terminal-output', (event, text) => callback(text)),
onSessionStatus: (callback) => ipcRenderer.on('session-status', (event, status) => callback(status)),
removeTerminalListeners: () => {
  ipcRenderer.removeAllListeners('terminal-output');
  ipcRenderer.removeAllListeners('session-status');
},

// AFTER
stopSSMSession: (id) => ipcRenderer.invoke('stop-ssm-session', { id }),
onSessionClosed: (callback) => ipcRenderer.on('session-closed', (event, { id }) => callback(id)),
onTerminalOutput: (callback) => ipcRenderer.on('terminal-output', (event, { id, text }) => callback(id, text)),
onSessionStatus: (callback) => ipcRenderer.on('session-status', (event, { id, status }) => callback(id, status)),
// removeTerminalListeners is removed — listeners are registered once for the app lifetime
```

- [ ] **Step 2: Commit**

```bash
git add app/preload.js
git commit -m "refactor(ipc): add session id to terminal event payloads"
```

---

## Task 2: Update main.js E2E mock handlers

The E2E tests use mock IPC handlers in `main.js` when `E2E_TEST=1`. These must send the new `{ id, ... }` payload shape or all existing session tests will fail.

**Files:**
- Modify: `app/main.js` lines 71–109 (the `if (isE2ETest)` block)

- [ ] **Step 1: Replace mock session state and the three mock handlers**

Replace the mock session variables and handlers (lines 73–109 in `app/main.js`):

```js
// Replace this block:
let mockSessionActive = false;

ipcMain.handle('start-ssm-session', async (event, config) => {
  mockSessionActive = true;
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-status', 'connecting');
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal-output', 'Starting session with SessionId: test-session-123\r\n');
          mainWindow.webContents.send('session-status', 'connected');
        }
      }, 100);
    }
  }, 50);
  return { success: true, sessionId: 'test-session-123' };
});

ipcMain.handle('stop-ssm-session', async () => {
  mockSessionActive = false;
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-status', 'disconnected');
      mainWindow.webContents.send('session-closed', { code: 0 });
    }
  }, 50);
  return { success: true };
});

ipcMain.handle('check-session-status', async () => {
  return { active: mockSessionActive, sessionId: mockSessionActive ? 'test-session-123' : null };
});

// With this:
const mockSessions = new Map(); // key: config.id, value: { sessionId }

ipcMain.handle('start-ssm-session', async (event, config) => {
  if (mockSessions.size >= 5) {
    return { success: false, error: 'Maximum sessions reached' };
  }
  if (mockSessions.has(config.id)) {
    return { success: false, error: 'Session already active for this connection' };
  }
  const sessionId = 'test-session-123';
  mockSessions.set(config.id, { sessionId });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-status', { id: config.id, status: 'connecting' });
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal-output', { id: config.id, text: 'Starting session with SessionId: test-session-123\r\n' });
          mainWindow.webContents.send('session-status', { id: config.id, status: 'connected' });
        }
      }, 100);
    }
  }, 50);
  return { success: true, sessionId };
});

ipcMain.handle('stop-ssm-session', async (event, { id }) => {
  if (id === '__all__') {
    const ids = [...mockSessions.keys()];
    mockSessions.clear();
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        ids.forEach(sid => {
          mainWindow.webContents.send('session-status', { id: sid, status: 'disconnected' });
          mainWindow.webContents.send('session-closed', { id: sid });
        });
      }
    }, 50);
    return { success: true };
  }
  if (!mockSessions.has(id)) return { success: false, error: 'No active session' };
  mockSessions.delete(id);
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-status', { id, status: 'disconnected' });
      mainWindow.webContents.send('session-closed', { id });
    }
  }, 50);
  return { success: true };
});

ipcMain.handle('check-session-status', async () => {
  const list = [...mockSessions.entries()].map(([id, s]) => ({ id, sessionId: s.sessionId, state: 'connected' }));
  return { sessions: list };
});
```

- [ ] **Step 2: Run existing session tests to confirm they still pass**

```bash
cd app && E2E_TEST=1 npx playwright test tests/e2e/session.spec.js --reporter=line
```

Expected: all 4 existing tests pass (the user-visible flow is unchanged).

- [ ] **Step 3: Commit**

```bash
git add app/main.js
git commit -m "refactor(e2e-mock): update mock session handlers for multi-session IPC shape"
```

---

## Task 3: Update main.js real IPC handlers

**Files:**
- Modify: `app/main.js` lines 11, 53–61, 220–291

- [ ] **Step 1: Replace `currentSession` singleton with `sessions` Map**

```js
// Line 11 — replace:
let currentSession = null;
// With:
const sessions = new Map(); // key: connection.id, value: SSMSession instance
```

- [ ] **Step 2: Replace the real `start-ssm-session` handler**

```js
ipcMain.handle('start-ssm-session', async (event, config) => {
  if (sessions.size >= 5) {
    return { success: false, error: 'Maximum sessions reached' };
  }
  if (sessions.has(config.id)) {
    return { success: false, error: 'Session already active for this connection' };
  }

  const { target, portNumber, localPortNumber, host, region, profile, sessionTimeoutMinutes } = config;
  const parsedTimeoutMinutes = Number.parseInt(sessionTimeoutMinutes, 10);
  const sessionTimeout = sessionTimeoutMinutes == null
    ? null
    : (Number.isInteger(parsedTimeoutMinutes) && parsedTimeoutMinutes > 0
      ? parsedTimeoutMinutes * 60 * 1000
      : null);

  const localPortCheck = await checkLocalPortAvailability(localPortNumber);
  if (!localPortCheck.available) {
    return { success: false, error: localPortCheck.error };
  }

  const onOutput = (text) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-output', { id: config.id, text });
    }
  };

  const onStatus = (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-status', { id: config.id, status });
      if (status === 'disconnected') {
        mainWindow.webContents.send('session-closed', { id: config.id });
        sessions.delete(config.id);
      }
    }
  };

  const session = new SSMSession({ target, portNumber, localPortNumber, host, region, profile, sessionTimeout }, onOutput, onStatus);
  sessions.set(config.id, session);

  const result = await session.start();

  if (!result.success) {
    result.error = normalizePortError(result.error, localPortNumber);
    sessions.delete(config.id);
  }

  return result;
});
```

- [ ] **Step 3: Replace the real `stop-ssm-session` handler**

```js
ipcMain.handle('stop-ssm-session', async (event, { id }) => {
  if (id === '__all__') {
    await Promise.all([...sessions.values()].map(s => s.stop()));
    sessions.clear();
    return { success: true };
  }
  const session = sessions.get(id);
  if (!session) return { success: false, error: 'No active session' };
  await session.stop();
  sessions.delete(id);
  return { success: true };
});
```

- [ ] **Step 4: Replace the real `check-session-status` handler**

```js
ipcMain.handle('check-session-status', async () => {
  const list = [...sessions.entries()].map(([id, s]) => {
    const status = s.getStatus();
    return { id, sessionId: status.sessionId, state: status.connected ? 'connected' : 'connecting' };
  });
  return { sessions: list };
});
```

- [ ] **Step 5: Update `window-all-closed` cleanup**

```js
app.on('window-all-closed', async () => {
  if (sessions.size > 0) {
    await Promise.all([...sessions.values()].map(s => s.stop()));
    sessions.clear();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

- [ ] **Step 6: Commit**

```bash
git add app/main.js
git commit -m "feat(main): replace currentSession singleton with multi-session Map"
```

---

## Task 4: Add tab bar HTML and CSS

**Files:**
- Modify: `app/index.html` (terminal modal, ~line 447)
- Modify: `app/styles.css`

- [ ] **Step 1: Add `#terminalTabs` div to the terminal modal**

In `app/index.html`, inside `<div class="terminal-modal-content">`, add `#terminalTabs` between the `.terminal-header` div and `#terminalContainer`:

```html
<!-- BEFORE -->
<div class="terminal-header">...</div>
<div id="terminalContainer" class="terminal-body"></div>

<!-- AFTER -->
<div class="terminal-header">...</div>
<div id="terminalTabs" class="terminal-tabs"></div>
<div id="terminalContainer" class="terminal-body"></div>
```

- [ ] **Step 2: Add tab bar CSS to `app/styles.css`**

```css
/* Terminal tabs */
.terminal-tabs {
  display: flex;
  align-items: stretch;
  background: var(--terminal-bg, #0f172a);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  min-height: 32px;
  overflow-x: auto;
  scrollbar-width: none;
}
.terminal-tabs:empty {
  display: none;
}
.terminal-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  font-size: 11px;
  color: #64748b;
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: color 0.15s;
  user-select: none;
}
.terminal-tab:hover {
  color: #94a3b8;
}
.terminal-tab.active {
  color: #e2e8f0;
  border-bottom-color: var(--tab-color, #22c55e);
}
.terminal-tab-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tab-color, #22c55e);
  flex-shrink: 0;
}
.terminal-tab-close {
  background: none;
  border: none;
  color: #475569;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  margin-left: 2px;
}
.terminal-tab-close:hover {
  color: #94a3b8;
}
/* Per-session xterm mount points */
.terminal-mount {
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/index.html app/styles.css
git commit -m "feat(ui): add terminal tab bar structure and styles"
```

---

## Task 5: Update renderer.js — globals, IPC listeners, resize handler

**Files:**
- Modify: `app/renderer.js` (top of file, `setupTerminal()`)

- [ ] **Step 1: Replace single-session globals (top of renderer.js)**

```js
// Remove these 6 lines:
let isSessionActive = false;
let connectionState = 'idle';
let activeConnectionName = null;
let activeConnectionConfig = null;
let terminal = null;
let fitAddon = null;

// Add these:
const MAX_SESSIONS = 5;
const sessions = new Map(); // key: connection.id → { state, config, terminal, fitAddon, mountEl, timerInterval, sessionStartTime, sessionDuration, sessionId }
let activeTabId = null;
```

Also remove the three timer globals that are now per-session:
```js
// Remove:
let sessionStartTime = null;
let sessionDuration = DEFAULT_SESSION_TIMEOUT_MINUTES * 60 * 1000;
let timerInterval = null;
```

- [ ] **Step 2: Rewrite `setupTerminal()` — remove xterm init, register lifetime IPC listeners**

The old `setupTerminal()` created a single `Terminal` instance and registered per-listener callbacks. The new version only registers the three lifetime IPC listeners and sets up button handlers. Xterm instances are now created per-session in `startSession()`.

```js
function setupTerminal() {
  // Register once-per-app-lifetime IPC listeners (route by id)
  window.electronAPI.onTerminalOutput((id, text) => {
    sessions.get(id)?.terminal.write(text);
  });

  window.electronAPI.onSessionStatus((id, status) => {
    updateSessionState(id, status);
  });

  window.electronAPI.onSessionClosed((id) => {
    handleSessionClosed(id);
  });

  // Minimize button
  document.getElementById('terminalMinimize').addEventListener('click', () => {
    const modal = document.getElementById('terminalModal');
    modal.classList.toggle('minimized');
    const toastContainer = document.getElementById('toastContainer');
    if (toastContainer) {
      if (modal.classList.contains('minimized')) {
        toastContainer.classList.remove('terminal-visible');
        toastContainer.classList.add('terminal-minimized');
      } else {
        toastContainer.classList.remove('terminal-minimized');
        toastContainer.classList.add('terminal-visible');
      }
    }
    // Re-fit active terminal after minimize toggle
    if (activeTabId && !modal.classList.contains('minimized')) {
      sessions.get(activeTabId)?.fitAddon.fit();
    }
  });

  // Main modal × — stop all sessions
  document.getElementById('terminalClose').addEventListener('click', async () => {
    await stopAllSessions();
    hideTerminal();
  });

  // Resize — fit only the active terminal
  window.addEventListener('resize', () => {
    if (activeTabId && !document.getElementById('terminalModal').classList.contains('hidden')) {
      sessions.get(activeTabId)?.fitAddon.fit();
    }
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/renderer.js
git commit -m "refactor(renderer): replace single-session globals with sessions Map and rewrite setupTerminal"
```

---

## Task 6: Implement per-session terminal lifecycle — showTerminal, hideTerminal, setActiveTab

**Files:**
- Modify: `app/renderer.js`

- [ ] **Step 1: Rewrite `showTerminal(config)`**

This function is now called once per new session from `startSession()`. It creates the xterm instance and mount point, switches the active tab.

```js
function showTerminal(config) {
  const modal = document.getElementById('terminalModal');
  const container = document.getElementById('terminalContainer');

  // Create xterm instance for this session
  const term = new Terminal({
    theme: { background: '#0f172a', foreground: '#e2e8f0', cursor: '#e2e8f0' },
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    cursorBlink: true,
    scrollback: 1000,
    convertEol: true
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);

  // Create mount div — must be visible before terminal.open()
  const mountEl = document.createElement('div');
  mountEl.className = 'terminal-mount';
  mountEl.dataset.sessionId = config.id;

  // Hide all existing mount points
  container.querySelectorAll('.terminal-mount').forEach(el => { el.style.display = 'none'; });

  // Show new mount point first, then open terminal
  mountEl.style.display = 'block';
  container.appendChild(mountEl);
  term.open(mountEl);
  fit.fit();

  // Write welcome banner
  term.writeln('\x1b[1;36m╭─────────────────────────────────────────────────────╮\x1b[0m');
  term.writeln('\x1b[1;36m│\x1b[0m       \x1b[1;33m⚡ AWS SSM Port Forwarding Session\x1b[0m          \x1b[1;36m│\x1b[0m');
  term.writeln('\x1b[1;36m╰─────────────────────────────────────────────────────╯\x1b[0m');
  term.writeln('');

  // Store in sessions Map (session entry already created by startSession before this call)
  const sess = sessions.get(config.id);
  if (sess) {
    sess.terminal = term;
    sess.fitAddon = fit;
    sess.mountEl = mountEl;
  }

  // Add tab
  addTab(config);

  // Show modal and offset toasts
  modal.classList.remove('hidden', 'minimized');
  const toastContainer = document.getElementById('toastContainer');
  if (toastContainer) {
    toastContainer.classList.remove('terminal-minimized');
    toastContainer.classList.add('terminal-visible');
  }

  // Switch active tab
  setActiveTab(config.id);
}
```

- [ ] **Step 2: Implement `addTab(config)`**

```js
function addTab(config) {
  const tabsEl = document.getElementById('terminalTabs');
  const tab = document.createElement('div');
  tab.className = 'terminal-tab';
  tab.dataset.id = config.id;

  const dot = document.createElement('span');
  dot.className = 'terminal-tab-dot';
  dot.style.setProperty('--tab-color', '#3b82f6'); // blue while connecting

  const label = document.createElement('span');
  label.textContent = config.name;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'terminal-tab-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Stop session';
  closeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await stopSession(config.id);
  });

  tab.appendChild(dot);
  tab.appendChild(label);
  tab.appendChild(closeBtn);
  tab.addEventListener('click', () => setActiveTab(config.id));
  tabsEl.appendChild(tab);
}
```

- [ ] **Step 3: Implement `setActiveTab(id)`**

```js
function setActiveTab(id) {
  const container = document.getElementById('terminalContainer');
  const tabsEl = document.getElementById('terminalTabs');

  // Hide all mount points first
  container.querySelectorAll('.terminal-mount').forEach(el => { el.style.display = 'none'; });

  // Show target mount point (must be before fitAddon.fit())
  const sess = sessions.get(id);
  if (sess?.mountEl) {
    sess.mountEl.style.display = 'block';
    sess.fitAddon.fit();
  }

  // Update tab active state
  tabsEl.querySelectorAll('.terminal-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.id === id);
  });

  activeTabId = id;
  updateTerminalFooter(id);
}
```

- [ ] **Step 4: Implement `updateTerminalFooter(id)`**

```js
function updateTerminalFooter(id) {
  const sess = sessions.get(id);
  if (!sess) return;
  const { config, sessionId, sessionStartTime, sessionDuration } = sess;

  document.getElementById('terminalInfo').textContent = `Local: localhost:${config.localPortNumber}`;
  document.getElementById('terminalSessionId').textContent = sessionId
    ? `Session: ${sessionId.substring(0, 20)}...`
    : 'Session: Initializing...';

  // Timer display will be updated by the per-session timer interval
  updateTimerDisplay(id);
}
```

- [ ] **Step 5: Rewrite `hideTerminal()`**

```js
function hideTerminal() {
  const modal = document.getElementById('terminalModal');
  modal.classList.add('hidden');
  const toastContainer = document.getElementById('toastContainer');
  if (toastContainer) {
    toastContainer.classList.remove('terminal-visible', 'terminal-minimized');
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add app/renderer.js
git commit -m "feat(renderer): per-session xterm lifecycle — showTerminal, addTab, setActiveTab"
```

---

## Task 7: Implement startSession, stopSession, stopAllSessions, handleSessionClosed

**Files:**
- Modify: `app/renderer.js`

- [ ] **Step 1: Rewrite `handleSessionToggle()`**

```js
async function handleSessionToggle() {
  // Use current editing connection's id to decide stop vs start
  const currentId = getEditingConnectionId();
  if (currentId && sessions.has(currentId)) {
    await stopSession(currentId);
  } else {
    await startSession();
  }
}

function getEditingConnectionId() {
  if (!editingConnectionName) return null;
  const conn = savedConnections.find(c => c.name === editingConnectionName);
  return conn?.id || null;
}
```

- [ ] **Step 2: Rewrite `startSession()`**

```js
async function startSession() {
  if (!validateForm()) return;

  if (sessions.size >= MAX_SESSIONS) {
    showToast('Maximum 5 sessions reached', 'error');
    return;
  }

  const { profile, region, target, host, name, groupId, notes, sessionTimeoutMinutes, customServiceName } = getConnectionConfig();
  const displayName = selectedService === 'custom' && customServiceName
    ? customServiceName
    : serviceConfig[selectedService].name;

  const config = {
    name: name || `${displayName} - ${new Date().toLocaleString()}`,
    service: selectedService,
    customServiceName: selectedService === 'custom' ? customServiceName : '',
    groupId,
    target,
    host,
    portNumber: document.getElementById('remotePort').value,
    localPortNumber: document.getElementById('localPort').value,
    region,
    profile,
    notes,
    sessionTimeoutMinutes
  };

  // Auto-save (assigns config.id if not already set)
  saveConnection(config, false);

  // Guard: already have a session for this connection
  if (sessions.has(config.id)) {
    setActiveTab(config.id);
    document.getElementById('terminalModal').classList.remove('hidden', 'minimized');
    return;
  }

  // Create session entry (terminal/fitAddon/mountEl filled in by showTerminal)
  sessions.set(config.id, {
    state: 'connecting',
    config,
    terminal: null,
    fitAddon: null,
    mountEl: null,
    timerInterval: null,
    sessionStartTime: null,
    sessionDuration: config.sessionTimeoutMinutes == null ? null : config.sessionTimeoutMinutes * 60 * 1000,
    sessionId: null
  });

  renderGroupsWithConnections(); // show connecting dot
  showTerminal(config);
  updateSessionButton();

  const connectBtn = document.getElementById('connectBtn');
  const saveBtn = document.getElementById('saveBtn');
  connectBtn.disabled = true;
  saveBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';

  const result = await window.electronAPI.startSSMSession(config);

  connectBtn.disabled = false;
  saveBtn.disabled = false;

  if (result.success) {
    const sess = sessions.get(config.id);
    if (sess) {
      sess.state = 'connected';
      sess.sessionId = result.sessionId;
    }
    updateTabDot(config.id, 'connected');
    updateTerminalFooter(config.id);
    updateSessionButton();
    renderGroupsWithConnections();
    startSessionTimer(config.id);
  } else {
    const sess = sessions.get(config.id);
    if (sess) sess.state = 'error';
    updateTabDot(config.id, 'error');
    showToast('Connection failed: ' + (result.error || 'Unknown error'), 'error');
    sessions.get(config.id)?.terminal?.writeln(`\x1b[1;31m✗ Error: ${result.error || 'Unknown error'}\x1b[0m`);
    updateSessionButton();
    renderGroupsWithConnections();
  }
}
```

- [ ] **Step 3: Implement `updateTabDot(id, state)`**

```js
function updateTabDot(id, state) {
  const tab = document.querySelector(`#terminalTabs .terminal-tab[data-id="${CSS.escape(id)}"]`);
  if (!tab) return;
  const dot = tab.querySelector('.terminal-tab-dot');
  if (!dot) return;
  const colours = { connecting: '#3b82f6', connected: '#22c55e', error: '#ef4444', disconnecting: '#3b82f6' };
  const colour = colours[state] || '#64748b';
  dot.style.setProperty('--tab-color', colour);
  tab.style.setProperty('--tab-color', colour);
}
```

- [ ] **Step 4: Implement `stopSession(id)`**

```js
async function stopSession(id) {
  const sess = sessions.get(id);
  if (!sess) return;

  sess.state = 'disconnecting';
  updateTabDot(id, 'disconnecting');
  sess.terminal?.writeln('\x1b[1;33m→ Stopping session...\x1b[0m');

  const result = await window.electronAPI.stopSSMSession(id);

  if (result.success) {
    cleanupSession(id);
    showToast('Session stopped');
  } else {
    showToast('Failed to stop session', 'error');
  }
  updateSessionButton();
}
```

- [ ] **Step 5: Implement `stopAllSessions()`**

```js
async function stopAllSessions() {
  if (sessions.size === 0) return;
  await window.electronAPI.stopSSMSession('__all__');
  [...sessions.keys()].forEach(id => cleanupSession(id));
  updateSessionButton();
}
```

- [ ] **Step 6: Implement `cleanupSession(id)`** — shared cleanup for both user-stop and server-close

```js
function cleanupSession(id) {
  const sess = sessions.get(id);
  if (!sess) return;

  stopSessionTimer(id);
  sess.terminal?.dispose();

  // Remove mount point
  sess.mountEl?.remove();

  // Remove tab
  document.querySelector(`#terminalTabs .terminal-tab[data-id="${CSS.escape(id)}"]`)?.remove();

  sessions.delete(id);

  // If this was the active tab, switch to another or hide modal
  if (activeTabId === id) {
    const remaining = [...sessions.keys()];
    if (remaining.length > 0) {
      setActiveTab(remaining[0]);
    } else {
      activeTabId = null;
      hideTerminal();
    }
  }

  renderGroupsWithConnections();
}
```

- [ ] **Step 7: Implement `handleSessionClosed(id)` — server-initiated close**

```js
function handleSessionClosed(id) {
  cleanupSession(id);
  showToast('Session closed');
  updateSessionButton();
}
```

- [ ] **Step 8: Implement `updateSessionState(id, status)` — called by onSessionStatus listener**

```js
function updateSessionState(id, status) {
  const sess = sessions.get(id);
  if (!sess) return;
  sess.state = status;
  updateTabDot(id, status);
  // If this is the active tab, update the footer status text
  if (activeTabId === id) {
    const statusEl = document.getElementById('terminalStatus');
    if (statusEl) {
      statusEl.classList.remove('connecting', 'connected', 'error', 'disconnected');
      const map = {
        connecting: ['Connecting...', 'connecting'],
        connected: ['Connected', 'connected'],
        error: ['Error', 'error'],
        disconnecting: ['Disconnecting...', 'connecting'],
        disconnected: ['Disconnected', 'disconnected']
      };
      const [text, cls] = map[status] || [status, ''];
      statusEl.textContent = text;
      if (cls) statusEl.classList.add(cls);
    }
  }
}
```

- [ ] **Step 9: Commit**

```bash
git add app/renderer.js
git commit -m "feat(renderer): multi-session start/stop/cleanup and tab dot state"
```

---

## Task 8: Update renderer.js — connect button, sidebar, checkSessionStatus, timers, URL actions

**Files:**
- Modify: `app/renderer.js`

- [ ] **Step 1: Rewrite `updateSessionButton()`**

```js
function updateSessionButton() {
  const connectBtn = document.getElementById('connectBtn');
  const saveBtn = document.getElementById('saveBtn');

  const id = getEditingConnectionId();
  const sess = id ? sessions.get(id) : null;
  const isActive = sess && (sess.state === 'connected' || sess.state === 'connecting');

  if (isActive) {
    connectBtn.textContent = 'Stop Session';
    connectBtn.classList.add('btn-stop');
    connectBtn.classList.remove('btn-disabled-session');
    connectBtn.disabled = false;
    saveBtn.disabled = false;
  } else if (sessions.size >= MAX_SESSIONS) {
    connectBtn.textContent = 'Max sessions reached';
    connectBtn.classList.remove('btn-stop');
    connectBtn.classList.add('btn-disabled-session');
    connectBtn.disabled = true;
    saveBtn.disabled = false;
  } else {
    connectBtn.textContent = 'Start Session';
    connectBtn.classList.remove('btn-stop', 'btn-disabled-session');
    connectBtn.disabled = false;
    saveBtn.disabled = false;
  }
}
```

- [ ] **Step 2: Update `renderConnectionItem()` sidebar state (one line change)**

Find the block that sets `isActive`, `isConnecting`, `isError` and replace:

```js
// Remove:
const isActive = isSessionActive && activeConnectionName === conn.name;
const isConnecting = connectionState === 'connecting' && activeConnectionName === conn.name;
const isError = connectionState === 'error' && activeConnectionName === conn.name;

// Add:
const sess = sessions.get(conn.id);
const isActive     = sess?.state === 'connected';
const isConnecting = sess?.state === 'connecting';
const isError      = sess?.state === 'error';
```

- [ ] **Step 3: Rewrite `checkSessionStatus()`**

```js
async function checkSessionStatus() {
  const result = await window.electronAPI.checkSessionStatus();
  if (!result.sessions || result.sessions.length === 0) return;

  // Restore any sessions that were active before a page reload
  result.sessions.forEach(({ id, sessionId, state }) => {
    if (!sessions.has(id)) {
      const conn = savedConnections.find(c => c.id === id);
      if (conn) {
        sessions.set(id, {
          state,
          config: conn,
          terminal: null, fitAddon: null, mountEl: null,
          timerInterval: null, sessionStartTime: null, sessionDuration: null,
          sessionId
        });
        showTerminal(conn);
        updateTabDot(id, state);
        updateTerminalFooter(id);
      }
    }
  });
  updateSessionButton();
  renderGroupsWithConnections();
}
```

- [ ] **Step 4: Update `startSessionTimer(id)` and `stopSessionTimer(id)`**

```js
function startSessionTimer(id) {
  const sess = sessions.get(id);
  if (!sess) return;
  sess.sessionStartTime = Date.now();
  updateTimerDisplay(id);
  if (sess.sessionDuration == null) return;
  sess.timerInterval = setInterval(() => updateTimerDisplay(id), 1000);
}

function stopSessionTimer(id) {
  const sess = sessions.get(id);
  if (!sess) return;
  if (sess.timerInterval) {
    clearInterval(sess.timerInterval);
    sess.timerInterval = null;
  }
  sess.sessionStartTime = null;
}
```

- [ ] **Step 5: Update `updateTimerDisplay(id)` — only updates footer if id === activeTabId**

```js
function updateTimerDisplay(id) {
  if (id !== activeTabId) return;
  const sess = sessions.get(id);
  if (!sess || !sess.sessionStartTime) return;

  const timerValue = document.getElementById('timerValue');
  const timerContainer = document.getElementById('sessionTimer');

  if (sess.sessionDuration == null) {
    if (timerValue) timerValue.textContent = 'No timeout';
    if (timerContainer) timerContainer.classList.remove('warning', 'danger');
    return;
  }

  const elapsed = Date.now() - sess.sessionStartTime;
  const remaining = Math.max(0, sess.sessionDuration - elapsed);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  if (timerValue) timerValue.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  if (timerContainer) {
    timerContainer.classList.toggle('warning', remaining < 120000 && remaining > 60000);
    timerContainer.classList.toggle('danger', remaining <= 60000);
  }

  if (remaining === 0) {
    stopSessionTimer(id);
    stopSession(id);
  }
}
```

- [ ] **Step 6: Update `copyActiveUrl()` and `openActiveUrl()` to read from active tab**

Find both functions. Replace `activeConnectionConfig` with `sessions.get(activeTabId)?.config`:

```js
function copyActiveUrl() {
  const activeConfig = sessions.get(activeTabId)?.config;
  if (!activeConfig) {
    showToast('No active session', 'error');
    return;
  }
  // rest of function uses activeConfig instead of activeConnectionConfig
}

function openActiveUrl() {
  const activeConfig = sessions.get(activeTabId)?.config;
  if (!activeConfig) {
    showToast('No active session', 'error');
    return;
  }
  // rest of function uses activeConfig instead of activeConnectionConfig
}
```

- [ ] **Step 7: Update `updateSessionTimerDefaultDisplay()` — remove any references to removed globals**

This function shows the global default timeout when no session is active. It should still work as-is; just make sure it doesn't reference the removed `sessionDuration` global. If it does, remove that reference.

- [ ] **Step 8: Run full test suite to check existing tests pass**

```bash
cd app && E2E_TEST=1 npx playwright test --reporter=line
```

Expected: all existing 80 tests pass.

- [ ] **Step 9: Commit**

```bash
git add app/renderer.js
git commit -m "feat(renderer): connect button, sidebar state, timers, and URL actions for multi-session"
```

---

## Task 9: Write new multi-session E2E tests

New tests go at the bottom of `app/tests/e2e/session.spec.js`.

The E2E mock creates two connections that need different IDs. Use `createConnection` (which calls saveConnection and assigns an `id`) for both, then start sessions for each.

**Files:**
- Modify: `app/tests/e2e/session.spec.js`

- [ ] **Step 1: Write the 7 failing tests**

Add this block to the bottom of `session.spec.js`:

```js
test.describe('Multiple Simultaneous Sessions', () => {
  test.beforeEach(async ({ page }) => {
    await clearAppState(page);
  });

  test('two sessions can be active simultaneously with independent sidebar dots', async ({ page }) => {
    // Create and start first connection
    await fillConnectionForm(page, { name: 'Session One', localPort: '5601' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);
    await expect(page.locator('.connection-item[data-name="Session One"] .connection-active-dot')).toBeVisible();

    // Start second connection without stopping first
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

    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, { name: 'Close This', localPort: '5602', host: 'two.us-east-1.es.amazonaws.com' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    // Close the second tab
    const closeThis = page.locator('#terminalTabs .terminal-tab', { hasText: 'Close This' });
    await closeThis.locator('.terminal-tab-close').click();
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
    // Start 5 sessions
    const ports = ['5601', '5602', '5603', '5604', '5605'];
    for (let i = 0; i < 5; i++) {
      await page.click('#newConnectionBtnFooter');
      await fillConnectionForm(page, {
        name: `MaxSess${i}`,
        localPort: ports[i],
        host: `sess${i}.us-east-1.es.amazonaws.com`
      });
      await page.click('#connectBtn');
      await page.waitForTimeout(300);
    }

    // Click a 6th connection form
    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, { name: 'Sixth', localPort: '5606', host: 'six.us-east-1.es.amazonaws.com' });

    await expect(page.locator('#connectBtn')).toHaveText('Max sessions reached');
    await expect(page.locator('#connectBtn')).toBeDisabled();
  });

  test('loading a connection with an active session focuses its tab instead of starting a new one', async ({ page }) => {
    await fillConnectionForm(page, { name: 'Focus Tab' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    // Navigate away
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

    await page.click('#newConnectionBtnFooter');
    await fillConnectionForm(page, { name: 'Closes', localPort: '5602', host: 'two.us-east-1.es.amazonaws.com' });
    await page.click('#connectBtn');
    await page.waitForTimeout(300);

    // Simulate server-side close for the second session via IPC
    const closesId = await page.evaluate(() => {
      const conn = window._savedConnections?.find(c => c.name === 'Closes');
      return conn?.id;
    });

    // Fire a synthetic session-closed event from the renderer side for testing
    await page.evaluate((id) => {
      // Trigger handleSessionClosed directly (exposed via test hook)
      if (typeof handleSessionClosed === 'function') handleSessionClosed(id);
    }, closesId);
    await page.waitForTimeout(200);

    // Surviving session should still be active
    await expect(page.locator('.connection-item[data-name="Survives"] .connection-active-dot')).toBeVisible();
    await expect(page.locator('.connection-item[data-name="Closes"] .connection-active-dot')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail (not crash)**

```bash
cd app && E2E_TEST=1 npx playwright test tests/e2e/session.spec.js --reporter=line
```

Expected: existing 4 tests pass; new tests fail with element-not-found or assertion errors (not crashes).

- [ ] **Step 3: Run all new tests after implementation is complete and confirm they pass**

```bash
cd app && E2E_TEST=1 npx playwright test tests/e2e/session.spec.js --reporter=line
```

Expected: all 11 tests pass.

- [ ] **Step 4: Run full suite to confirm no regressions**

```bash
cd app && E2E_TEST=1 npx playwright test --reporter=line
```

Expected: all 87 tests pass (80 existing + 7 new).

- [ ] **Step 5: Commit**

```bash
git add app/tests/e2e/session.spec.js
git commit -m "test(e2e): multi-session scenarios — tabs, close, cap, server-close, focus"
```

---

## Task 10: Update ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Mark 1.3 as implemented**

In `ROADMAP.md`, under `### 1.3 Multiple Simultaneous Sessions`, change all `- [ ]` to `- [x]` and add the ✅ prefix to the heading:

```markdown
### ~~1.3 Multiple Simultaneous Sessions~~ ✅ Implemented
- [x] Allow multiple active sessions at once
- [x] Tabbed terminal interface to switch between sessions
- [x] Show all active sessions in sidebar with status indicators
- [x] Manage local port allocation to avoid conflicts
```

- [ ] **Step 2: Move to Currently Implemented section and add changelog entry**

Add to the Testing section in Currently Implemented:
- `[x] **Multiple Simultaneous Sessions** — Up to 5 sessions at once, tabbed terminal, independent sidebar indicators, per-session timers`

Add changelog row:
```
| 2026-03-26 | Implemented: multiple simultaneous sessions (up to 5), tabbed terminal modal, independent sidebar status dots, per-session timers |
```

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark multiple simultaneous sessions as implemented in ROADMAP"
```
