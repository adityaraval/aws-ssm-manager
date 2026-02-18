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
- [x] **Cross-Platform** - Works on macOS, Windows, and Linux

### Supported Services
- [x] **Amazon OpenSearch** - Port 443 → localhost:5601 with Dashboards URL
- [x] **Amazon Aurora PostgreSQL** - Port 5432 with connection string
- [x] **Amazon ElastiCache Redis** - Port 6379 with Redis URL
- [x] **Amazon MQ (RabbitMQ)** - Port 443 → localhost:15672 with management UI URL

### Connection Management
- [x] **Save Connections** - Persist connection configurations locally
- [x] **Edit Connections** - Modify existing saved connections
- [x] **Delete Connections** - Remove connections with confirmation dialog
- [x] **Connection Groups** - Organize connections into color-coded groups
- [x] **Drag & Drop** - Move connections between groups by dragging
- [x] **Group Management** - Create, edit, and delete groups
- [x] **Collapsible Groups** - Expand/collapse groups in sidebar
- [x] **Search Connections** - Filter connections by name, profile, region, host, or service
- [x] **Import/Export** - Backup and restore connections as JSON files

### User Interface
- [x] **Modern UI** - Clean interface with Tailwind CSS and DaisyUI
- [x] **Dark Mode** - Light, dark, and system theme options
- [x] **Sidebar Navigation** - Browse connections and groups in sidebar
- [x] **Connection Form** - Configure all connection parameters
- [x] **Region Selector** - Dropdown with all major AWS regions
- [x] **Editable Local Port** - Customize local port for each connection
- [x] **Toast Notifications** - Feedback for user actions
- [x] **Active Connection Indicator** - Visual indicator for currently connected session

### Terminal & Session
- [x] **Live Terminal Output** - Real-time AWS CLI output via xterm.js
- [x] **Terminal Modal** - Floating terminal window with minimize option
- [x] **Session Status** - Visual status indicator (connecting, connected, error, disconnected)
- [x] **Session Timer** - 10-minute countdown with visual warnings (3 min, 1 min)
- [x] **Auto-Timeout** - Sessions automatically close after 10 minutes
- [x] **Copy URL** - One-click copy service URL to clipboard
- [x] **Session Info Display** - Shows local port and session ID

### Security (Recently Added)
- [x] **Input Validation** - Validates instance IDs, regions, ports, profiles, hostnames
- [x] **XSS Prevention** - HTML escaping for all user-controlled content
- [x] **Command Injection Protection** - Safe process spawning without shell interpolation
- [x] **Content Security Policy** - Strict CSP headers in Electron
- [x] **Context Isolation** - Secure IPC bridge between main and renderer
- [x] **Import Sanitization** - Validates and sanitizes imported connection files
- [x] **Export Warning** - Security notice before exporting connection data
- [x] **Environment Protection** - Minimal environment variables passed to child processes

### Data Storage
- [x] **Local Storage** - Connections, groups, and preferences stored in browser localStorage
- [x] **Collapsed State Persistence** - Remember which groups are collapsed
- [x] **Theme Persistence** - Remember selected theme preference

---

## Future Enhancements

## Priority 1: High Value Features

### 1.1 Port Conflict Detection
- [ ] Check if local port is already in use before starting session
- [ ] Show clear error message with the process using the port
- [ ] Suggest next available port

### 1.2 Custom Service Types
- [ ] Allow users to define custom services beyond the 4 built-in types
- [ ] Fields: name, icon (upload or select), default remote port, default local port, URL template
- [ ] Store custom services in localStorage or separate config file
- [ ] Import/export should include custom service definitions

### 1.3 Duplicate Connection
- [ ] Add "Duplicate" button/menu item for connections
- [ ] Pre-fill form with copied values and append "(Copy)" to name
- [ ] Quick way to create variations of existing connections

### 1.4 Configurable Session Timeout
- [ ] Add timeout selector: 5, 10, 15, 30 minutes, or "No timeout"
- [ ] Per-connection setting with global default
- [ ] Warning notification at 1 minute remaining
- [ ] Option to extend session before it expires

### 1.5 Multiple Simultaneous Sessions
- [ ] Allow multiple active sessions at once
- [ ] Tabbed terminal interface to switch between sessions
- [ ] Show all active sessions in sidebar with status indicators
- [ ] Manage local port allocation to avoid conflicts

---

## Priority 2: Quick Wins

### 2.1 Connection Notes
- [ ] Add optional "Notes" textarea field to connection form
- [ ] Display notes in connection details or tooltip
- [ ] Useful for documenting purpose, credentials location, etc.

### 2.2 Favorites
- [ ] Add star/favorite toggle on connections
- [ ] Show favorites section at top of sidebar
- [ ] Persist favorites in localStorage

### 2.3 Recently Used
- [ ] Track last 5-10 used connections with timestamps
- [ ] Show "Recent" section in sidebar
- [ ] Clear recent history option

### 2.4 Keyboard Shortcuts
- [ ] `Cmd/Ctrl+N` - New connection
- [ ] `Cmd/Ctrl+S` - Save connection
- [ ] `Cmd/Ctrl+Enter` - Start session
- [ ] `Cmd/Ctrl+W` - Stop session
- [ ] `Cmd/Ctrl+K` - Focus search
- [ ] `Escape` - Close modals
- [ ] Add keyboard shortcut hints in UI

### 2.5 Open URL in Browser
- [ ] Add "Open in Browser" button next to "Copy URL"
- [ ] Use Electron's `shell.openExternal()` to open default browser
- [ ] Only enable when session is connected

### 2.6 Connection Status Badge
- [ ] Show green dot indicator on active connection in sidebar
- [ ] Pulse animation while connecting
- [ ] Red dot on error state

---

## Priority 3: Advanced Features

### 3.1 System Tray Integration
- [ ] Minimize to system tray instead of closing
- [ ] Tray icon shows connection status (connected/disconnected)
- [ ] Right-click menu with recent connections for quick connect
- [ ] Notification badge for active sessions

### 3.2 Auto-Reconnect
- [ ] Option to automatically retry if session drops unexpectedly
- [ ] Configurable retry attempts (1, 3, 5, unlimited)
- [ ] Exponential backoff between retries
- [ ] User notification on reconnect attempts

### 3.3 Desktop Notifications
- [ ] Notify when session is about to expire (1 min warning)
- [ ] Notify when session disconnects unexpectedly
- [ ] Notify on successful connection
- [ ] Make notifications optional in settings

### 3.4 Session History
- [ ] Log past sessions: connection name, start time, end time, duration, status
- [ ] View history in a dedicated panel
- [ ] Export history as CSV
- [ ] Configurable retention (last 50, 100, or all)

### 3.5 AWS Resource Discovery
- [ ] Fetch EC2 instances for selected profile/region
- [ ] Show instance picker dropdown with Name tag, instance ID, state
- [ ] Discover RDS endpoints for Aurora connections
- [ ] Discover ElastiCache endpoints
- [ ] Requires additional IAM permissions (document in README)

### 3.6 Connection Testing
- [ ] After session starts, verify tunnel is working
- [ ] Attempt TCP connection to remote host through tunnel
- [ ] Show "Tunnel verified" or "Tunnel may not be working" status
- [ ] Optional HTTP health check for web services

### 3.7 SSH Tunnel Support
- [ ] Alternative connection method using direct SSH
- [ ] For environments without SSM agent
- [ ] Support SSH key authentication
- [ ] Support SSH through bastion host

---

## Priority 4: UX Improvements

### 4.1 Onboarding Wizard
- [ ] First-run experience to verify prerequisites
- [ ] Check AWS CLI installed and version
- [ ] Check Session Manager plugin installed
- [ ] Check AWS credentials configured
- [ ] Link to documentation for missing prerequisites

### 4.2 Drag to Reorder Connections
- [ ] Allow reordering connections within a group
- [ ] Persist order in localStorage
- [ ] Visual feedback during drag

### 4.3 Bulk Operations
- [ ] Multi-select connections with checkboxes
- [ ] Bulk delete selected connections
- [ ] Bulk move to group
- [ ] Bulk export selected connections

### 4.4 Advanced Search & Filters
- [ ] Filter connections by group
- [ ] Filter by service type
- [ ] Filter by region
- [ ] Filter by profile
- [ ] Save filter presets

### 4.5 Connection Sorting
- [ ] Sort by name (A-Z, Z-A)
- [ ] Sort by recently used
- [ ] Sort by service type
- [ ] Remember sort preference

---

## Priority 5: Code Quality & Technical Debt

### 5.1 Testing
- [ ] Set up Jest or Vitest for unit tests
- [ ] Unit tests for validation functions
- [ ] Unit tests for data sanitization
- [ ] Integration tests for IPC handlers
- [ ] E2E tests with Playwright or Spectron

### 5.2 TypeScript Migration
- [ ] Convert renderer.js to TypeScript
- [ ] Convert main.js to TypeScript
- [ ] Convert ssm-session.js to TypeScript
- [ ] Add type definitions for IPC messages

### 5.3 State Management
- [ ] Extract connection state to dedicated module
- [ ] Extract group state to dedicated module
- [ ] Extract session state to dedicated module
- [ ] Consider using a simple store pattern

### 5.4 Build System
- [ ] Replace CDN dependencies (Tailwind, DaisyUI) with local build
- [ ] Set up Vite or Webpack for bundling
- [ ] Minify CSS and JS for production
- [ ] Tree-shaking for smaller bundle size

### 5.5 Logging
- [ ] Add structured logging with levels (debug, info, warn, error)
- [ ] Log to file for debugging (optional)
- [ ] Include timestamps and context
- [ ] Rotate log files

### 5.6 Error Handling
- [ ] Centralized error handling
- [ ] User-friendly error messages
- [ ] Error reporting/feedback mechanism
- [ ] Graceful degradation

---

## Feature Requests Template

When adding new feature requests, use this template:

```markdown
### Feature Name
- **Priority**: P1/P2/P3/P4/P5
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
| 2025-02-18 | Initial roadmap created with implemented features and future enhancements |
