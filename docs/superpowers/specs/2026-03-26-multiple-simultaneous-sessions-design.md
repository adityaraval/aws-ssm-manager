# Multiple Simultaneous Sessions — Design Spec

**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Allow up to 5 AWS SSM port-forwarding sessions to run simultaneously. Each session is independently managed. The terminal modal gains a tab bar so users can switch between session outputs. The sidebar shows status indicators for all active sessions at once.

---

## Decisions

| Question | Decision |
|---|---|
| Terminal layout | Tabs inside the modal header |
| Max simultaneous sessions | 5 |
| Tab × button | Stops that session immediately |
| Main modal × button | Stops all sessions and closes modal |
| Connect button when cap reached | Disabled, shows "Max sessions reached" |
| Session Map key | `connection.id` (not name — names are not unique) |

---

## Architecture

### State changes in `renderer.js`

Replace the four single-session globals with a `sessions` Map keyed by `connection.id`, and an active-tab pointer:

```js
// Before (single session)
let isSessionActive = false;
let connectionState = 'idle';
let activeConnectionName = null;
let activeConnectionConfig = null;
let terminal = null;
let fitAddon = null;

// After (multiple sessions)
const MAX_SESSIONS = 5;
const sessions = new Map();
// sessions Map shape per entry:
// key: connection.id (stable string, e.g. "conn-1234-abc")
// value: {
//   state: 'connecting' | 'connected' | 'error' | 'disconnecting',
//   config: Object,          // full connection config including .id and .name
//   terminal: Terminal,      // xterm.js instance
//   fitAddon: FitAddon,
//   mountEl: HTMLElement,    // <div> inside #terminalContainer for this session
//   timerInterval: number|null,
//   sessionStartTime: number|null,
//   sessionDuration: number|null,
//   sessionId: string|null,  // AWS session ID returned from CLI
// }
let activeTabId = null; // connection.id of the session whose output is shown
```

The legacy globals `isSessionActive`, `connectionState`, `activeConnectionName`, `activeConnectionConfig`, `terminal`, `fitAddon` are removed. All callers are updated to read from `sessions`.

`checkSessionStatus()` in renderer currently reads `result.active` and `result.sessionId`. This function is fully rewritten to consume the new `{ sessions: [...] }` shape returned by the updated IPC handler.

### IPC changes in `main.js`

Replace the `currentSession` singleton with a `sessions` Map keyed by `connection.id`:

```js
// Before
let currentSession = null;

// After
const sessions = new Map(); // key: connection.id, value: SSMSession instance
```

**`start-ssm-session`**: Receives `config` (which includes `config.id`). Returns an error if `sessions.size >= 5` or if `sessions.has(config.id)`. Stores the new `SSMSession` under `config.id`. IPC events include the session key:

```js
onOutput:  (text)   => mainWindow.webContents.send('terminal-output', { id: config.id, text }),
onStatus:  (status) => mainWindow.webContents.send('session-status',  { id: config.id, status }),
// 'disconnected' status also triggers:
mainWindow.webContents.send('session-closed', { id: config.id })
```

**`stop-ssm-session`**: Accepts `{ id }`. Stops and deletes the named entry. If `id === '__all__'`, iterates and stops all sessions.

**`check-session-status`**: Returns `{ sessions: [{ id, name, sessionId, state }] }`.

**Window close cleanup**: The `before-quit` / `window-all-closed` handler iterates `sessions` and `await`s `.stop()` on each entry before the process exits (preserving the current async stop behaviour).

### Preload bridge (`preload.js`)

**IPC listeners are registered once at startup** (not per-session). The single callback per channel routes to the correct session by `id`. `removeTerminalListeners` is removed — there is nothing to remove individually since the listeners live for the full app lifetime.

```js
// Registered once in renderer.js DOMContentLoaded:
window.electronAPI.onTerminalOutput((id, text)   => { sessions.get(id)?.terminal.write(text); });
window.electronAPI.onSessionStatus( (id, status) => { updateSessionState(id, status); });
window.electronAPI.onSessionClosed( (id)         => { handleSessionClosed(id); });
```

Preload shape:

```js
onTerminalOutput: (cb) => ipcRenderer.on('terminal-output', (e, { id, text })   => cb(id, text)),
onSessionStatus:  (cb) => ipcRenderer.on('session-status',  (e, { id, status }) => cb(id, status)),
onSessionClosed:  (cb) => ipcRenderer.on('session-closed',  (e, { id })         => cb(id)),
stopSSMSession:   (id) => ipcRenderer.invoke('stop-ssm-session', { id }),
```

---

## Terminal Modal UI

### HTML structure

The existing single-terminal layout gains a tab bar between the modal chrome and the terminal body. The terminal body becomes a container of per-session xterm mount points.

```
┌─────────────────────────────────────────┐
│ [● Prod OpenSearch ×] [● Staging MQ ×]  │  ← #terminalTabs (tab bar)  − ×
├─────────────────────────────────────────┤
│  #terminalContainer                     │
│   └── <div data-session-id="conn-…">    │  ← mount point, visible
│   └── <div data-session-id="conn-…">   │  ← mount point, display:none
├─────────────────────────────────────────┤
│ Port: 5601  Copy URL  Open   09:42  ... │  ← footer (reflects active tab)
└─────────────────────────────────────────┘
```

**Tab appearance:**
- Active tab: bottom border in session status colour (green = connected, blue = connecting, red = error), text at full opacity.
- Inactive tabs: dimmed text, no bottom border.
- Each tab's × calls `stopSession(id)`.
- Main modal × calls `stopAllSessions()` then `hideTerminal()`.

**Footer** (`#terminalInfo`, `#sessionTimer`, `#terminalSessionId`, Copy URL, Open): all read from `sessions.get(activeTabId)?.config`. These must be updated on every tab switch.

### xterm.js lifecycle per session

On `startSession()`:
1. Create a new `Terminal` + `FitAddon` for the session.
2. Create a `<div>` mount point inside `#terminalContainer` with `data-session-id`.
3. **Set mount point to `display:block` before calling `terminal.open(mountEl)` and `fitAddon.fit()`** — xterm reads `offsetWidth`/`offsetHeight`; calling `fit()` on a hidden element produces a 0-column terminal that never recovers.
4. Hide all other mount points (`display:none`).
5. Set `activeTabId` to the new session's `id`.
6. Add a tab element to `#terminalTabs`.

On `setActiveTab(id)`:
1. Hide current active mount point (`display:none`).
2. Show new mount point (`display:block`) — **must happen before `fitAddon.fit()`**.
3. Call `sessions.get(id).fitAddon.fit()`.
4. Update footer fields from the newly active session.
5. Set `activeTabId = id`.

On `stopSession(id)` / `handleSessionClosed(id)`:
1. Stop timer for that session.
2. Call `sessions.get(id).terminal.dispose()`.
3. Remove mount point from DOM.
4. Remove tab from `#terminalTabs`.
5. Call `sessions.delete(id)`.
6. If `activeTabId === id`, switch to another open tab or call `hideTerminal()` if none remain.

---

## Sidebar

`renderConnectionItem` reads session state from the Map using `conn.id`:

```js
const sess = sessions.get(conn.id);
const isActive     = sess?.state === 'connected';
const isConnecting = sess?.state === 'connecting';
const isError      = sess?.state === 'error';
```

No structural HTML changes to connection items needed — existing dot and highlight classes work unchanged.

---

## Connect Button

`updateSessionButton()` reads from `sessions` using the `id` of the connection currently loaded in the form:

| Condition | Button label | Enabled |
|---|---|---|
| Loaded connection has an active/connecting session | "Stop Session" | ✅ |
| Loaded connection is idle, `sessions.size < 5` | "Start Session" | ✅ |
| Loaded connection is idle, `sessions.size >= 5` | "Max sessions reached" | ❌ |

---

## Session Timer

Each sessions Map entry stores its own `timerInterval`, `sessionStartTime`, and `sessionDuration`. The timer display in the footer only reflects the active tab's session. `startSessionTimer(id)` and `stopSessionTimer(id)` are updated to scope their work to the named entry.

---

## Error Handling

- **Duplicate session for same connection**: `startSession()` guards — if `sessions.has(config.id)`, focus the existing tab and return early (no toast needed).
- **Cap reached**: `startSession()` shows a toast "Maximum 5 sessions reached" and returns early.
- **IPC start failure**: Session entry is removed from the Map; the tab is removed; error shown via toast.
- **Unexpected close**: `handleSessionClosed(id)` removes the entry, removes the tab, re-renders sidebar. If no sessions remain, hides the modal.

---

## E2E Mock IPC Handlers

The E2E test block in `main.js` (`E2E_TEST === '1'`) currently sends flat payloads:

```js
mainWindow.webContents.send('session-status', 'connected');
mainWindow.webContents.send('terminal-output', 'Starting session...');
```

These must be updated to include `id`:

```js
mainWindow.webContents.send('session-status', { id: config.id, status: 'connected' });
mainWindow.webContents.send('terminal-output', { id: config.id, text: 'Starting session...' });
mainWindow.webContents.send('session-closed',  { id: config.id });
```

The mock `stop-ssm-session` handler must accept `{ id }` (or `'__all__'`). The mock `check-session-status` handler must return `{ sessions: [] }` instead of `{ active: false }`.

---

## Testing

Existing E2E tests continue to pass because the single-session user flow is unchanged and the mock handlers are updated alongside the IPC contract.

New tests to add in `session.spec.js`:

- Start two connections simultaneously; both show active dots in sidebar.
- Switch between tabs; footer updates to reflect the correct session (port, timer, session ID).
- Click a tab × ; that session stops and its tab is removed; other session remains active.
- Click main modal × ; all sessions stop, modal closes.
- Attempt to start a 6th session; "Max sessions reached" toast appears, button is disabled.
- Unexpected server-side close of one session; remaining sessions are unaffected.
- Load a connection that already has an active session; existing tab is focused, no duplicate started.
