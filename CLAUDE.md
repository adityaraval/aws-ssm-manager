# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

From the `app/` directory:

```bash
cd app
npm install          # Install dependencies
npm start            # Run in development mode (Electron)
npm run build        # Build for current platform
npm run build:mac    # Build for macOS
npm run build:win    # Build for Windows
npm run build:linux  # Build for Linux
```

Or from root via workspace scripts: `npm run app:start`, `npm run app:build`, etc.

Build output goes to `dist/` directory. No tests are configured.

## Architecture

Electron desktop app for AWS SSM port forwarding. The `website/` directory contains a separate static marketing site (not part of the Electron app).

### Process Model

```
main.js (Main Process)
    ├── Creates BrowserWindow
    ├── Handles IPC from renderer
    ├── Spawns SSMSession instances
    └── Manages AWS profile reading from ~/.aws/

preload.js (Preload Script)
    └── Bridges IPC between main and renderer via contextBridge

renderer.js (Renderer Process)
    ├── UI logic and DOM manipulation (~1000+ lines)
    ├── Connection/group management (localStorage)
    └── Terminal display (xterm.js)

ssm-session.js (Session Handler)
    └── Spawns AWS CLI `aws ssm start-session` as child process
```

### Key Files

| File | Purpose |
|------|---------|
| `app/main.js` | Electron main process, IPC handlers, CSP headers, import/export with validation |
| `app/renderer.js` | UI logic, form validation, connection CRUD, localStorage persistence |
| `app/ssm-session.js` | AWS CLI spawning, input validation, session lifecycle management |
| `app/preload.js` | Secure IPC bridge exposing `electronAPI` and `darkMode` to renderer |
| `app/index.html` | Main UI with xterm.js terminal, uses Tailwind CSS + DaisyUI via CDN |
| `app/styles.css` | All styling including dark mode via CSS custom properties |

### IPC Channels

Defined in `preload.js`, used across main.js and renderer.js:

- `get-profiles` — returns AWS profiles from ~/.aws/
- `start-ssm-session` / `stop-ssm-session` — session lifecycle
- `terminal-output` / `session-status` — main→renderer streaming callbacks
- `export-connections` / `import-connections` — file I/O with validation
- `dark-mode:toggle` / `dark-mode:set` / `dark-mode:get` — theme management

### Data Flow

1. User configures connection in UI (renderer.js)
2. Form validated against `validationPatterns` (renderer.js)
3. Config sent via IPC `start-ssm-session` to main process
4. main.js creates `SSMSession` instance with callbacks for output/status
5. ssm-session.js validates inputs again (defense-in-depth), spawns `aws ssm start-session` CLI
6. CLI output streamed back via IPC to xterm.js terminal in renderer

### Data Model

Connection object shape (stored in localStorage as JSON array):
```
{ name, service, target (instance ID), host, region, profile, portNumber, localPortNumber, groupId }
```

Group object shape: `{ id (timestamp string), name, color (hex) }`

### Storage

- **Connections**: `localStorage.getItem('ssmConnections')` - JSON array
- **Groups**: `localStorage.getItem('ssmGroups')` - JSON array with id, name, color
- **Collapsed state**: `localStorage.getItem('ssmCollapsedGroups')` - group IDs
- **Theme**: `localStorage.getItem('theme')` - 'light', 'dark', or 'system'

### Security Model

- `nodeIntegration: false`, `contextIsolation: true` in BrowserWindow
- All user input sanitized with `escapeHtml()` before innerHTML
- AWS parameters validated with regex patterns in both renderer.js (`validationPatterns`) and ssm-session.js (duplicate validation)
- Child processes spawned without `shell: true`, receive minimal env vars (PATH, HOME, AWS_*)
- CSP headers set via `webRequest.onHeadersReceived`
- Import validation: 1MB file size limit, max 500 connections, max 50 groups

### Supported Services

Defined in `renderer.js` serviceConfig object:
- OpenSearch (port 443 → 5601)
- Aurora PostgreSQL (port 5432)
- ElastiCache Redis (port 6379)
- Amazon MQ/RabbitMQ (port 443 → 15672)

## Prerequisites

Requires AWS CLI v2 and Session Manager Plugin installed on the user's system. The app reads profiles from `~/.aws/config` and `~/.aws/credentials`.
