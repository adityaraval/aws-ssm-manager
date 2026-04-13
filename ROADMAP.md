# AWS SSM Manager - Roadmap

This document outlines currently implemented features and potential improvements for future development.

---

## Currently Implemented Features

### Core Functionality
- [x] **AWS SSM Port Forwarding** - Connect to private AWS resources via SSM Session Manager
- [x] **AWS CLI Integration** - Spawns `aws ssm start-session` for reliable connections
- [x] **AWS Profile Support** - Read and select from `~/.aws/config` and `~/.aws/credentials`
- [x] **Profile Refresh** - Reload AWS profiles without restarting the app
- [x] **Session Management** - Start and stop SSM sessions with process cleanup
- [x] **Port Conflict Detection** - Real-time warning when local port conflicts with another saved connection, with actionable guidance
- [x] **Custom Service Types** - Define custom services beyond built-in types with user-specified remote/local ports and service name
- [x] **Cross-Platform** - Works on macOS, Windows, and Linux

### Supported Services
- [x] **Amazon OpenSearch** - Port 443 → localhost:5601 with Dashboards URL
- [x] **Amazon Aurora PostgreSQL** - Port 5432 with connection string
- [x] **Amazon ElastiCache Redis** - Port 6379 with Redis URL
- [x] **Amazon MQ (RabbitMQ)** - Port 443 → localhost:15672 with management UI URL
- [x] **Custom Services** - User-defined service with custom name, remote port, and local port

### Connection Management
- [x] **Save Connections** - Persist connection configurations locally
- [x] **Edit Connections** - Modify existing saved connections
- [x] **Duplicate Connections** - Create connection copies for quick variations
- [x] **Delete Connections** - Remove connections with confirmation dialog
- [x] **Connection Groups** - Organize connections into color-coded groups
- [x] **Drag & Drop** - Move connections between groups by dragging
- [x] **Group Management** - Create, edit, and delete groups
- [x] **Collapsible Groups** - Expand/collapse groups in sidebar
- [x] **Search Connections** - Filter connections by name, profile, region, host, or service
- [x] **Import/Export** - Backup and restore connections as JSON files with unique ID-based deduplication
- [x] **Unique Connection IDs** - Each connection has a stable ID; import/export matches by ID first, falls back to name

### User Interface
- [x] **Modern UI** - Clean desktop interface with DM Sans font, local CSS (no CDN dependency)
- [x] **Dark Mode** - Light, dark, and system theme options
- [x] **Sidebar Navigation** - Browse connections and groups in sidebar
- [x] **Connection Form** - Configure all connection parameters
- [x] **Region Selector** - Dropdown with all major AWS regions
- [x] **Editable Local Port** - Customize local port for each connection
- [x] **Toast Notifications** - Feedback for user actions
- [x] **Active Connection Indicator** - Visual indicator for currently connected session
- [x] **Connection Status Badge** - Green dot (connected), blue pulse (connecting), red dot (error) in sidebar
- [x] **Connection Notes** - Optional notes textarea on connections, displayed in sidebar preview
- [x] **Open URL in Browser** - "Open" button in terminal footer to launch service URL in default browser
- [x] **Keyboard Shortcuts** - Cmd+N (new), Cmd+S (save), Cmd+Enter (connect), Cmd+W (close), Cmd+K (search), Escape (close modals), ? (shortcuts help)
- [x] **Keyboard Shortcuts Modal** - Press `?` to view all available shortcuts
- [x] **Inline Field Validation** - Real-time red border feedback on blur for instance ID, hostname, and port fields
- [x] **Required Field Indicators** - Orange dot markers on required form fields
- [x] **Auto-save on Connect** - Start Session automatically saves the connection before connecting
- [x] **Overflow Menu** - Import/Export buttons in a clean sidebar footer overflow menu
- [x] **Empty Group States** - Groups with no connections show helpful placeholder text
- [x] **Group Delete Confirmation** - Confirmation dialog before deleting groups, showing affected connection count

### Terminal & Session
- [x] **Live Terminal Output** - Real-time AWS CLI output via xterm.js
- [x] **Terminal Modal** - Floating terminal window with minimize option, toast offset awareness
- [x] **Session Status** - Visual status indicator (connecting, connected, error, disconnected)
- [x] **Configurable Session Timeout** - 5/10/15/30 minutes or no timeout (per connection with global default)
- [x] **Session Timer** - Countdown warnings for timed sessions and "No timeout" display for unlimited sessions
- [x] **Copy URL** - One-click copy service URL to clipboard
- [x] **Session Info Display** - Shows local port and session ID
- [x] **Multiple Simultaneous Sessions** - Up to 5 sessions running at once; tabbed terminal modal with per-session xterm instances; independent status dots in sidebar; tab × stops individual session; modal × stops all sessions

### Security
- [x] **Input Validation** - Validates instance IDs, regions, ports, profiles, hostnames (both on blur and on submit)
- [x] **XSS Prevention** - HTML escaping for all user-controlled content
- [x] **Command Injection Protection** - Safe process spawning without shell interpolation
- [x] **Content Security Policy** - Strict CSP headers in Electron
- [x] **Context Isolation** - Secure IPC bridge between main and renderer
- [x] **Import Sanitization** - Validates and sanitizes imported connection files
- [x] **Export Warning** - Security notice before exporting connection data
- [x] **Environment Protection** - Minimal environment variables passed to child processes

### UX Improvements
- [x] **Onboarding Wizard** - First-run prerequisite checks for AWS CLI, SSM plugin, and credentials
- [x] **Drag to Reorder** - Reorder connections within groups with visual feedback
- [x] **Bulk Operations** - Multi-select with bulk delete, move to group, and export
- [x] **Advanced Filters** - Filter by group, service type, region, and profile
- [x] **Connection Sorting** - Sort by name, recently used, service type, or manual order

### Testing
- [x] **E2E Tests with Playwright** - 80+ tests covering connection CRUD, groups, import/export, filters, sorting, session, keyboard shortcuts, theme, onboarding, port conflict detection, custom services, and connection ID handling

### Data Storage
- [x] **Local Storage** - Connections, groups, and preferences stored in browser localStorage
- [x] **Storage Quota Handling** - Graceful error handling when localStorage is full
- [x] **Collapsed State Persistence** - Remember which groups are collapsed
- [x] **Theme Persistence** - Remember selected theme preference

---

## Future Enhancements

## Priority 1: High Value Features

### 1.1 Sidebar Smart Sections
- [ ] Introduce optional "Favorites" section in sidebar
- [ ] Introduce optional "Recent" section (last used connections)
- [ ] Add setting to show/hide smart sections while keeping groups-only as default

### 1.2 Configurable Session Timeout (Enhancements)
- [ ] Warning notification at 1 minute remaining
- [ ] Option to extend session before it expires

---

## Priority 2: Advanced Features

### 2.1 System Tray Integration
- [ ] Minimize to system tray instead of closing
- [ ] Tray icon shows connection status (connected/disconnected)
- [ ] Right-click menu with recent connections for quick connect
- [ ] Notification badge for active sessions

### 2.2 Auto-Reconnect
- [ ] Option to automatically retry if session drops unexpectedly
- [ ] Configurable retry attempts (1, 3, 5, unlimited)
- [ ] Exponential backoff between retries
- [ ] User notification on reconnect attempts

### 2.3 Desktop Notifications
- [ ] Notify when session is about to expire (1 min warning)
- [ ] Notify when session disconnects unexpectedly
- [ ] Notify on successful connection
- [ ] Make notifications optional in settings

### 2.4 Session History
- [ ] Log past sessions: connection name, start time, end time, duration, status
- [ ] View history in a dedicated panel
- [ ] Export history as CSV
- [ ] Configurable retention (last 50, 100, or all)

### 2.5 AWS Resource Discovery
- [ ] Fetch EC2 instances for selected profile/region
- [ ] Show instance picker dropdown with Name tag, instance ID, state
- [ ] Discover RDS endpoints for Aurora connections
- [ ] Discover ElastiCache endpoints
- [ ] Requires additional IAM permissions (document in README)

### 2.6 Connection Testing
- [ ] After session starts, verify tunnel is working
- [ ] Attempt TCP connection to remote host through tunnel
- [ ] Show "Tunnel verified" or "Tunnel may not be working" status
- [ ] Optional HTTP health check for web services

### 2.7 SSH Tunnel Support
- [ ] Alternative connection method using direct SSH
- [ ] For environments without SSM agent
- [ ] Support SSH key authentication
- [ ] Support SSH through bastion host

### 2.8 Save Filter Presets
- [ ] Save current filter/sort configuration as named presets
- [ ] Quick-switch between saved filter presets

---

## Priority 3: Code Quality & Technical Debt

### 3.1 Unit & Integration Testing
- [ ] Set up Jest or Vitest for unit tests
- [ ] Unit tests for validation functions
- [ ] Unit tests for data sanitization
- [ ] Integration tests for IPC handlers

### 3.2 TypeScript Migration
- [ ] Convert renderer.js to TypeScript
- [ ] Convert main.js to TypeScript
- [ ] Convert ssm-session.js to TypeScript
- [ ] Add type definitions for IPC messages

### 3.3 State Management
- [ ] Extract connection state to dedicated module
- [ ] Extract group state to dedicated module
- [ ] Extract session state to dedicated module
- [ ] Consider using a simple store pattern

### 3.4 Build System
- [ ] Set up Vite or Webpack for bundling
- [ ] Minify CSS and JS for production
- [ ] Tree-shaking for smaller bundle size

### 3.5 Logging
- [ ] Add structured logging with levels (debug, info, warn, error)
- [ ] Log to file for debugging (optional)
- [ ] Include timestamps and context
- [ ] Rotate log files

### 3.6 Error Handling
- [ ] Centralized error handling
- [ ] User-friendly error messages
- [ ] Error reporting/feedback mechanism
- [ ] Graceful degradation

---

## Feature Requests Template

When adding new feature requests, use this template:

```markdown
### Feature Name
- **Priority**: P1/P2/P3
- **Effort**: Small/Medium/Large
- **Description**: Brief description of the feature
- **User Story**: As a user, I want to... so that...
- **Acceptance Criteria**:
  - [ ] Criterion 1
  - [ ] Criterion 2
- **Technical Notes**: Any implementation considerations
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-13 | Implemented: multiple simultaneous sessions (up to 5) with tabbed terminal, per-session status dots, per-session timers, and independent stop controls. Fixed safeSetItem infinite recursion bug. |
| 2026-03-25 | Implemented: custom service types, port conflict detection, unique connection IDs, import/export ID-based dedup, inline field validation, group delete confirmation, empty group states, auto-save on connect, overflow menu, keyboard shortcuts modal, toast/terminal offset, localStorage quota handling, DM Sans font, required field indicators. Added 37+ Playwright E2E tests. |
| 2026-02-20 | Updated roadmap to reflect current groups-only sidebar: moved Favorites/Recent from implemented to future enhancements |
| 2025-02-19 | Implemented Quick Wins: connection notes, favorites, recently used, keyboard shortcuts, open URL in browser, connection status badges |
| 2025-02-19 | Implemented UX improvements: onboarding wizard, drag-to-reorder, bulk operations, advanced filters, connection sorting |
| 2025-02-18 | Initial roadmap created with implemented features and future enhancements |
