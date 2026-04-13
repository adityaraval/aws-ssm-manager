let selectedService = null;
let savedConnections = [];
let connectionGroups = [];
let editingGroupId = null;
let editingConnectionName = null; // Track the original name of connection being edited
let searchTerm = '';
let collapsedGroups = new Set();
let sortPreference = localStorage.getItem('ssmSortPreference') || 'name-asc';
let activeFilters = { group: '', service: '', region: '', profile: '' };
let filterPanelVisible = false;
let bulkSelectMode = false;
let selectedConnections = new Set();
const MAX_SESSIONS = 5;
const sessions = new Map(); // key: connection.id → { state, config, terminal, fitAddon, mountEl, timerInterval, sessionStartTime, sessionDuration, sessionId }
let activeTabId = null;
let pendingDeleteConnection = null; // Track connection pending deletion
let pendingDeleteGroupId = null; // Track group pending deletion

const DEFAULT_SESSION_TIMEOUT_MINUTES = 10;
const NO_TIMEOUT_VALUE = 'none';
const DEFAULT_TIMEOUT_STORAGE_KEY = 'ssmDefaultSessionTimeout';
const DEFAULT_GROUP_NAME = 'General';
const DEFAULT_GROUP_COLOR = '#6b7280';

// Safe localStorage write with quota handling (G3)
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      showToast('Storage full — cannot save. Try removing unused connections.', 'error');
    }
  }
}

// HTML escape function to prevent XSS attacks
function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Session timers are now per-session inside the sessions Map

const serviceConfig = {
  opensearch: {
    name: 'Amazon OpenSearch',
    icon: 'images/AmazonOpenSearch.svg',
    remotePort: '443',
    localPort: '5601',
    urlTemplate: (port) => `https://localhost:${port}/_dashboards`
  },
  aurora: {
    name: 'Amazon Aurora',
    icon: 'images/AmazonAurora.svg',
    remotePort: '5432',
    localPort: '5432',
    urlTemplate: (port) => `postgresql://localhost:${port}`
  },
  elasticache: {
    name: 'Amazon ElastiCache',
    icon: 'images/AmazonElastiCache.svg',
    remotePort: '6379',
    localPort: '6379',
    urlTemplate: (port) => `redis://localhost:${port}`
  },
  rabbitmq: {
    name: 'Amazon MQ',
    icon: 'images/AmazonMQ.svg',
    remotePort: '443',
    localPort: '15672',
    urlTemplate: (port) => `https://localhost:${port}`
  },
  custom: {
    name: 'Custom',
    icon: null,
    remotePort: '',
    localPort: '',
    urlTemplate: null
  }
};

function generateConnectionId() {
  return 'conn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

document.addEventListener('DOMContentLoaded', async () => {
  initializeSessionTimeout();
  await loadProfiles();
  loadGroups();
  loadSavedConnections();
  setupEventListeners();
  setupTerminal();
  setupKeyboardShortcuts();
  checkSessionStatus();
  initTheme();
  updateFilterDropdowns();
  checkOnboarding();
});

// Terminal Management
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

  // Store in sessions Map (entry created by startSession before this call)
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

function updateTerminalFooter(id) {
  const sess = sessions.get(id);
  if (!sess) return;
  const { config, sessionId } = sess;

  document.getElementById('terminalInfo').textContent = `Local: localhost:${config.localPortNumber}`;
  document.getElementById('terminalSessionId').textContent = sessionId
    ? `Session: ${sessionId.substring(0, 20)}...`
    : 'Session: Initializing...';

  updateTimerDisplay(id);
}

function hideTerminal() {
  const modal = document.getElementById('terminalModal');
  modal.classList.add('hidden');

  // Reset toast position
  const toastContainer = document.getElementById('toastContainer');
  if (toastContainer) {
    toastContainer.classList.remove('terminal-visible', 'terminal-minimized');
  }
}

function updateSessionState(id, status) {
  const sess = sessions.get(id);
  if (!sess) return;
  sess.state = status;
  updateTabDot(id, status);
  // If this is the active tab, update the header status text
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

// Profile Management
async function loadProfiles() {
  const result = await window.electronAPI.getProfiles();
  const profileSelect = document.getElementById('profileSelect');

  profileSelect.innerHTML = '<option value="">Select profile...</option>';

  if (result.success && result.profiles.length > 0) {
    result.profiles.forEach(profile => {
      const option = document.createElement('option');
      option.value = profile;
      option.textContent = profile;
      profileSelect.appendChild(option);
    });
  }
}

// Group Management
function ensureDefaultGroupId() {
  let defaultGroup = connectionGroups.find(group => group.name === DEFAULT_GROUP_NAME);
  if (!defaultGroup) {
    defaultGroup = {
      id: `group-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: DEFAULT_GROUP_NAME,
      color: DEFAULT_GROUP_COLOR
    };
    connectionGroups.push(defaultGroup);
    safeSetItem('ssmGroups', JSON.stringify(connectionGroups));
  }
  return defaultGroup.id;
}

function loadGroups() {
  const saved = localStorage.getItem('ssmGroups');
  connectionGroups = saved ? JSON.parse(saved) : [];
  ensureDefaultGroupId();

  const savedCollapsed = localStorage.getItem('ssmCollapsedGroups');
  if (savedCollapsed) {
    collapsedGroups = new Set(JSON.parse(savedCollapsed));
  } else {
    collapsedGroups = new Set();
    saveCollapsedState();
  }

  renderGroupsWithConnections();
  updateGroupDropdown();
}

function saveGroups() {
  safeSetItem('ssmGroups', JSON.stringify(connectionGroups));
  renderGroupsWithConnections();
  updateGroupDropdown();
}

function saveCollapsedState() {
  safeSetItem('ssmCollapsedGroups', JSON.stringify([...collapsedGroups]));
}

function toggleGroupCollapse(groupId) {
  if (collapsedGroups.has(groupId)) {
    collapsedGroups.delete(groupId);
  } else {
    collapsedGroups.add(groupId);
  }
  saveCollapsedState();
  renderGroupsWithConnections();
}

function addGroup(name, color) {
  const id = Date.now().toString();
  connectionGroups.push({ id, name, color });
  saveGroups();
}

function updateGroup(id, newName, newColor) {
  const group = connectionGroups.find(g => g.id === id);
  if (group && newName.trim()) {
    group.name = newName.trim();
    group.color = newColor;
    saveGroups();
  }
}

function deleteGroup(id) {
  connectionGroups = connectionGroups.filter(g => g.id !== id);
  const fallbackGroupId = connectionGroups.length > 0
    ? connectionGroups[0].id
    : ensureDefaultGroupId();
  savedConnections = savedConnections.map(c => {
    if (c.groupId === id) {
      return { ...c, groupId: fallbackGroupId };
    }
    return c;
  });
  safeSetItem('ssmConnections', JSON.stringify(savedConnections));
  saveGroups();
}

function renderGroupsWithConnections() {
  const container = document.getElementById('connectionGroups');

  // Filter connections by search term (starts with + contains, case-insensitive)
  let filtered = savedConnections;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = savedConnections.filter(conn => {
      const name = (conn.name || '').toLowerCase();
      const profile = (conn.profile || '').toLowerCase();
      const region = (conn.region || '').toLowerCase();
      const host = (conn.host || '').toLowerCase();
      const serviceName = conn.service === 'custom'
        ? (conn.customServiceName || 'custom').toLowerCase()
        : (serviceConfig[conn.service]?.name || '').toLowerCase();

      // Check if name starts with search term (primary match)
      if (name.startsWith(term)) return true;

      // Check if any field contains search term (secondary match)
      return name.includes(term) ||
        profile.includes(term) ||
        region.includes(term) ||
        host.includes(term) ||
        serviceName.includes(term);
    });
  }

  // Apply active filters
  if (activeFilters.group) {
    filtered = filtered.filter(conn => conn.groupId === activeFilters.group);
  }
  if (activeFilters.service) {
    filtered = filtered.filter(conn => conn.service === activeFilters.service);
  }
  if (activeFilters.region) {
    filtered = filtered.filter(conn => conn.region === activeFilters.region);
  }
  if (activeFilters.profile) {
    filtered = filtered.filter(conn => conn.profile === activeFilters.profile);
  }

  // Apply sort preference
  filtered = applySortPreference(filtered);

  let html = '';

  // Groups-only layout (no Favorites/Recent/Ungrouped sections).
  const groupedConnections = new Map();
  filtered.forEach(conn => {
    if (conn.groupId) {
      if (!groupedConnections.has(conn.groupId)) {
        groupedConnections.set(conn.groupId, []);
      }
      groupedConnections.get(conn.groupId).push(conn);
    }
  });

  // Render each group with its connections
  connectionGroups.forEach(group => {
    const connections = groupedConnections.get(group.id) || [];
    const isCollapsed = collapsedGroups.has(group.id);
    const count = connections.length;

    // Validate color is a safe CSS color value (hex format from radio buttons)
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(group.color) ? group.color : '#888888';

    html += `
      <div class="group-section ${isCollapsed ? 'collapsed' : ''}" data-group-id="${escapeHtml(group.id)}">
        <div class="group-header" data-group-id="${escapeHtml(group.id)}">
          <svg class="group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          <span class="group-color" style="background: ${safeColor}"></span>
          <span class="group-name">${escapeHtml(group.name)}</span>
          <span class="group-count">${count}</span>
          <div class="group-actions">
            <button class="group-edit" data-id="${escapeHtml(group.id)}" title="Edit">✎</button>
            ${group.name !== DEFAULT_GROUP_NAME ? `<button class="group-delete" data-id="${escapeHtml(group.id)}" title="Delete">×</button>` : ''}
          </div>
        </div>
        <div class="group-connections" data-group-id="${escapeHtml(group.id)}">
          ${connections.length > 0
            ? connections.map(conn => renderConnectionItem(conn, group)).join('')
            : '<div class="empty-group-state">No connections in this group</div>'}
        </div>
      </div>
    `;
  });

  if (filtered.length === 0) {
    if (savedConnections.length === 0) {
      html += '<div class="empty-state">No connections yet</div>';
    } else {
      html += '<div class="empty-state">No matching connections</div>';
    }
  }

  // Add group button
  html += `
    <div class="add-group-row" id="addGroupBtn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span>Add Group</span>
    </div>
  `;

  container.innerHTML = html;

  // Attach event listeners
  attachGroupEventListeners(container);
}

function attachGroupEventListeners(container) {
  // Group header click to toggle collapse
  container.querySelectorAll('.group-header:not(.ungrouped-header)').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.group-actions')) return;
      const groupId = header.dataset.groupId;
      toggleGroupCollapse(groupId);
    });
  });

  // Edit button
  container.querySelectorAll('.group-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openGroupModal(btn.dataset.id);
    });
  });

  // Delete button
  container.querySelectorAll('.group-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteGroupModal(btn.dataset.id);
    });
  });

  // Add group button
  const addGroupBtn = container.querySelector('#addGroupBtn');
  if (addGroupBtn) {
    addGroupBtn.addEventListener('click', () => openGroupModal());
  }

  // Connection items
  container.querySelectorAll('.connection-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('connection-delete')) return;
      if (e.target.classList.contains('connection-duplicate')) return;
      loadConnection(item.dataset.name);
    });
  });

  container.querySelectorAll('.connection-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteModal(btn.dataset.name);
    });
  });

  container.querySelectorAll('.connection-duplicate').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      duplicateConnection(btn.dataset.name);
    });
  });

  // Bulk select checkboxes
  container.querySelectorAll('.bulk-check-input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const name = cb.dataset.name;
      if (cb.checked) {
        selectedConnections.add(name);
      } else {
        selectedConnections.delete(name);
      }
      updateBulkActionBar();
    });
  });

  // Drag and drop for connections
  let draggedConnection = null;
  let draggedGroupId = null;

  container.querySelectorAll('.connection-item').forEach(item => {
    if (bulkSelectMode) return; // Disable drag in bulk mode

    item.addEventListener('dragstart', (e) => {
      draggedConnection = item.dataset.name;
      const conn = savedConnections.find(c => c.name === draggedConnection);
      draggedGroupId = conn ? (conn.groupId || 'ungrouped') : 'ungrouped';
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.name);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      draggedConnection = null;
      draggedGroupId = null;
      // Remove all drag-over states and drop indicators
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      container.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());
    });

    // Reorder within group: dragover on connection items
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';

      // Remove existing indicators
      container.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());

      // Determine if dropping above or below
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const insertBefore = e.clientY < midY;

      const indicator = document.createElement('div');
      indicator.className = 'drop-indicator-line';
      if (insertBefore) {
        item.parentNode.insertBefore(indicator, item);
      } else {
        item.parentNode.insertBefore(indicator, item.nextSibling);
      }
    });

    item.addEventListener('dragleave', (e) => {
      if (!item.contains(e.relatedTarget)) {
        // Don't remove indicators here — dragend handles cleanup
      }
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

      const connectionName = e.dataTransfer.getData('text/plain');
      if (!connectionName || connectionName === item.dataset.name) return;

      const targetConn = savedConnections.find(c => c.name === item.dataset.name);
      const draggedConn = savedConnections.find(c => c.name === connectionName);
      if (!targetConn || !draggedConn) return;

      const targetGroupId = targetConn.groupId || 'ungrouped';
      const sourceGroupId = draggedConn.groupId || 'ungrouped';

      const rect = item.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;

      if (sourceGroupId === targetGroupId) {
        reorderConnection(connectionName, item.dataset.name, insertBefore);
      } else {
        // Move to different group, then reorder
        moveConnectionToGroup(connectionName, targetGroupId);
        // After move, reorder within the new group
        reorderConnection(connectionName, item.dataset.name, insertBefore);
      }
    });
  });

  // Drop targets - group headers and group connections areas (for moving between groups)
  container.querySelectorAll('.group-section').forEach(section => {
    const groupId = section.dataset.groupId;
    const header = section.querySelector('.group-header');
    const connectionsArea = section.querySelector('.group-connections');

    const handleDragOver = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      section.classList.add('drag-over');
    };

    const handleDragLeave = (e) => {
      if (!section.contains(e.relatedTarget)) {
        section.classList.remove('drag-over');
      }
    };

    const handleDrop = (e) => {
      e.preventDefault();
      section.classList.remove('drag-over');
      container.querySelectorAll('.drop-indicator-line').forEach(el => el.remove());
      const connectionName = e.dataTransfer.getData('text/plain');
      if (connectionName && groupId) {
        moveConnectionToGroup(connectionName, groupId);
      }
    };

    if (header) {
      header.addEventListener('dragover', handleDragOver);
      header.addEventListener('dragleave', handleDragLeave);
      header.addEventListener('drop', handleDrop);
    }

    if (connectionsArea) {
      connectionsArea.addEventListener('dragover', handleDragOver);
      connectionsArea.addEventListener('dragleave', handleDragLeave);
      connectionsArea.addEventListener('drop', handleDrop);
    }
  });
}

function updateGroupDropdown() {
  const defaultGroupId = ensureDefaultGroupId();
  const select = document.getElementById('connectionGroup');
  const selectedValue = select.value;
  select.innerHTML = '';

  connectionGroups.forEach(group => {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.name;
    select.appendChild(option);
  });

  const hasPreviousSelection = [...select.options].some(option => option.value === selectedValue);
  select.value = hasPreviousSelection ? selectedValue : defaultGroupId;
}

function sanitizeTimeoutSelection(value) {
  const stringValue = String(value || DEFAULT_SESSION_TIMEOUT_MINUTES);
  if (stringValue === NO_TIMEOUT_VALUE) return NO_TIMEOUT_VALUE;
  const minutes = Number.parseInt(stringValue, 10);
  if ([5, 10, 15, 30].includes(minutes)) {
    return String(minutes);
  }
  return String(DEFAULT_SESSION_TIMEOUT_MINUTES);
}

function getSelectedSessionTimeoutValue() {
  const select = document.getElementById('sessionTimeout');
  return sanitizeTimeoutSelection(select ? select.value : DEFAULT_SESSION_TIMEOUT_MINUTES);
}

function getSelectedSessionTimeoutMinutes() {
  const timeoutValue = getSelectedSessionTimeoutValue();
  if (timeoutValue === NO_TIMEOUT_VALUE) return null;
  return Number.parseInt(timeoutValue, 10);
}

function updateSessionTimerDefaultDisplay() {
  if (sessions.size > 0) return;
  const timerValue = document.getElementById('timerValue');
  const timerContainer = document.getElementById('sessionTimer');
  if (!timerValue || !timerContainer) return;

  const timeoutValue = getSelectedSessionTimeoutValue();
  timerContainer.classList.remove('warning', 'danger');
  if (timeoutValue === NO_TIMEOUT_VALUE) {
    timerValue.textContent = 'No timeout';
    return;
  }

  const minutes = Number.parseInt(timeoutValue, 10);
  timerValue.textContent = `${minutes}:00`;
}

function initializeSessionTimeout() {
  const select = document.getElementById('sessionTimeout');
  if (!select) return;
  const savedDefault = localStorage.getItem(DEFAULT_TIMEOUT_STORAGE_KEY);
  const timeoutValue = sanitizeTimeoutSelection(savedDefault);
  select.value = timeoutValue;
  safeSetItem(DEFAULT_TIMEOUT_STORAGE_KEY, timeoutValue);
  updateSessionTimerDefaultDisplay();
}

// Connection Management
function loadSavedConnections() {
  const saved = localStorage.getItem('ssmConnections');
  savedConnections = saved ? JSON.parse(saved) : [];
  const validGroupIds = new Set(connectionGroups.map(group => group.id));
  const defaultGroupId = ensureDefaultGroupId();
  // Ensure sortOrder, lastUsedAt, favorite, id fields exist on all connections
  let needsSave = false;
  savedConnections.forEach((conn, idx) => {
    if (!conn.id) { conn.id = generateConnectionId(); needsSave = true; }
    if (conn.sortOrder == null) { conn.sortOrder = idx; needsSave = true; }
    if (conn.lastUsedAt == null) { conn.lastUsedAt = 0; needsSave = true; }
    if (conn.favorite == null) { conn.favorite = false; needsSave = true; }
    if (!conn.groupId || !validGroupIds.has(conn.groupId)) {
      conn.groupId = defaultGroupId;
      needsSave = true;
    }
    if (conn.sessionTimeoutMinutes !== null && conn.sessionTimeoutMinutes !== undefined) {
      const parsedTimeout = Number.parseInt(conn.sessionTimeoutMinutes, 10);
      if (![5, 10, 15, 30].includes(parsedTimeout)) {
        conn.sessionTimeoutMinutes = DEFAULT_SESSION_TIMEOUT_MINUTES;
        needsSave = true;
      } else {
        conn.sessionTimeoutMinutes = parsedTimeout;
      }
    }
  });
  if (needsSave) {
    safeSetItem('ssmConnections', JSON.stringify(savedConnections));
  }
  renderGroupsWithConnections();
}

function applySortPreference(connections) {
  const sorted = [...connections];
  switch (sortPreference) {
    case 'name-asc':
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
    case 'name-desc':
      sorted.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
      break;
    case 'recent':
      sorted.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
      break;
    case 'service':
      sorted.sort((a, b) => (a.service || '').localeCompare(b.service || ''));
      break;
    case 'manual':
      sorted.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      break;
    default:
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }
  return sorted;
}

function saveConnection(config, showNotification = true) {
  const resolvedGroupId = config.groupId && connectionGroups.some(group => group.id === config.groupId)
    ? config.groupId
    : ensureDefaultGroupId();
  config.groupId = resolvedGroupId;

  // Find existing connection: prefer by id, fall back to name (legacy)
  const lookupName = editingConnectionName || config.name;
  let existing = config.id ? savedConnections.findIndex(c => c.id === config.id) : -1;
  if (existing < 0) {
    existing = savedConnections.findIndex(c => c.name === lookupName);
  }

  if (existing >= 0) {
    // Preserve id and other fields if not set on new config
    if (!config.id) config.id = savedConnections[existing].id || generateConnectionId();
    if (config.sortOrder == null) config.sortOrder = savedConnections[existing].sortOrder || 0;
    if (config.lastUsedAt == null) config.lastUsedAt = savedConnections[existing].lastUsedAt || 0;
    if (config.notes == null) config.notes = savedConnections[existing].notes || '';
    if (config.favorite == null) config.favorite = savedConnections[existing].favorite || false;
    if (config.sessionTimeoutMinutes === undefined) {
      config.sessionTimeoutMinutes = savedConnections[existing].sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES;
    }
    savedConnections[existing] = config;
  } else {
    // Assign id and sortOrder for new connections
    if (!config.id) config.id = generateConnectionId();
    const maxOrder = savedConnections.reduce((max, c) => Math.max(max, c.sortOrder || 0), 0);
    if (config.sortOrder == null) config.sortOrder = maxOrder + 1;
    if (config.lastUsedAt == null) config.lastUsedAt = 0;
    if (config.favorite == null) config.favorite = false;
    if (config.sessionTimeoutMinutes === undefined) {
      config.sessionTimeoutMinutes = DEFAULT_SESSION_TIMEOUT_MINUTES;
    }
    savedConnections.push(config);
  }

  // Update editingConnectionName to the new name after save
  editingConnectionName = config.name;

  safeSetItem('ssmConnections', JSON.stringify(savedConnections));
  renderGroupsWithConnections();
  updateGroupDropdown();
  if (showNotification) {
    showToast('Connection saved');
  }
}

function deleteConnection(name) {
  savedConnections = savedConnections.filter(c => c.name !== name);
  safeSetItem('ssmConnections', JSON.stringify(savedConnections));
  renderGroupsWithConnections();
}

function getDuplicateConnectionName(baseName) {
  const trimmed = (baseName || '').trim() || 'Connection';
  const copyBase = `${trimmed} (Copy)`;
  const existingNames = new Set(savedConnections.map(c => c.name));
  if (!existingNames.has(copyBase)) {
    return copyBase;
  }

  let index = 2;
  while (existingNames.has(`${trimmed} (Copy ${index})`)) {
    index++;
  }
  return `${trimmed} (Copy ${index})`;
}

function duplicateConnection(name) {
  const source = savedConnections.find(c => c.name === name);
  if (!source) return;

  const duplicated = {
    ...source,
    id: generateConnectionId(), // New unique ID for the duplicate
    name: getDuplicateConnectionName(source.name),
    lastUsedAt: 0,
    favorite: false
  };

  editingConnectionName = null;
  saveConnection(duplicated, false);
  loadConnection(duplicated.name);
  showToast(`Duplicated: ${duplicated.name}`, 'success');
}

function renderConnectionItem(conn, group) {
  // Validate icon path - only allow known service icons
  const validIconServices = ['opensearch', 'aurora', 'elasticache', 'rabbitmq'];
  const isCustomService = conn.service === 'custom';
  const iconSrc = validIconServices.includes(conn.service) && serviceConfig[conn.service]?.icon
    ? serviceConfig[conn.service].icon
    : null;
  const sess = sessions.get(conn.id);
  const isActive     = sess?.state === 'connected';
  const isConnecting = sess?.state === 'connecting';
  const isError      = sess?.state === 'error';
  const isSelected = editingConnectionName === conn.name;
  const activeClass = isActive ? 'active-session' : '';
  const selectedClass = isSelected ? 'selected' : '';
  const bulkClass = bulkSelectMode ? 'bulk-mode' : '';
  let activeDot = '';
  if (isConnecting) {
    activeDot = '<span class="connection-connecting-dot" title="Connecting..."></span>';
  } else if (isError) {
    activeDot = '<span class="connection-error-dot" title="Connection error"></span>';
  } else if (isActive) {
    activeDot = '<span class="connection-active-dot" title="Session active"></span>';
  }
  const draggable = bulkSelectMode ? 'false' : 'true';
  const isChecked = selectedConnections.has(conn.name) ? 'checked' : '';

  const checkbox = bulkSelectMode ? `
    <label class="bulk-checkbox" onclick="event.stopPropagation()">
      <input type="checkbox" class="bulk-check-input" data-name="${escapeHtml(conn.name)}" ${isChecked}>
      <span class="bulk-checkmark"></span>
    </label>
  ` : '';

  const notesLine = conn.notes
    ? `<div class="connection-notes-preview">${escapeHtml(conn.notes.substring(0, 60))}${conn.notes.length > 60 ? '...' : ''}</div>`
    : '';

  const iconHtml = iconSrc
    ? `<img src="${escapeHtml(iconSrc)}" alt="" class="connection-icon-img">`
    : `<div class="connection-icon-custom-small" title="${escapeHtml(conn.customServiceName || 'Custom')}">⚙</div>`;

  const serviceLabel = isCustomService && conn.customServiceName
    ? `<span class="connection-custom-service">${escapeHtml(conn.customServiceName)}</span>`
    : '';

  const dragHandle = !bulkSelectMode ? '<span class="connection-drag-handle">⠿</span>' : '';

  return `
    <div class="connection-item ${activeClass} ${selectedClass} ${bulkClass}" data-name="${escapeHtml(conn.name)}" draggable="${draggable}">
      ${dragHandle}
      ${checkbox}
      ${iconHtml}
      <div class="connection-info">
        <div class="connection-name">${activeDot}<span class="connection-name-text">${escapeHtml(conn.name)}</span>${serviceLabel}</div>
        <div class="connection-meta">${escapeHtml(conn.profile)} · ${escapeHtml(conn.region)}${(searchTerm || activeFilters.group || activeFilters.service || activeFilters.region || activeFilters.profile) && group && group.name !== 'Default' ? ` · <span class="connection-group-label">${escapeHtml(group.name)}</span>` : ''}</div>
        ${notesLine}
      </div>
      <button class="connection-duplicate" data-name="${escapeHtml(conn.name)}" title="Duplicate">⧉</button>
      <button class="connection-delete" data-name="${escapeHtml(conn.name)}" title="Delete">×</button>
    </div>
  `;
}

// Toggle favorite status
function toggleFavorite(name) {
  const conn = savedConnections.find(c => c.name === name);
  if (conn) {
    conn.favorite = !conn.favorite;
    safeSetItem('ssmConnections', JSON.stringify(savedConnections));
    renderGroupsWithConnections();
  }
}

// Drag and Drop functionality
function moveConnectionToGroup(connectionName, newGroupId) {
  const conn = savedConnections.find(c => c.name === connectionName);
  if (conn) {
    conn.groupId = newGroupId === 'ungrouped' ? ensureDefaultGroupId() : newGroupId;
    safeSetItem('ssmConnections', JSON.stringify(savedConnections));
    // Sync form group selector if this connection is currently loaded in the form
    if (editingConnectionName === connectionName) {
      document.getElementById('connectionGroup').value = conn.groupId;
    }
    renderGroupsWithConnections();
  }
}

function reorderConnection(draggedName, targetName, insertBefore) {
  const draggedConn = savedConnections.find(c => c.name === draggedName);
  const targetConn = savedConnections.find(c => c.name === targetName);
  if (!draggedConn || !targetConn) return;

  // Get all connections in the same group
  const groupId = targetConn.groupId || null;
  const groupConns = savedConnections.filter(c => (c.groupId || null) === groupId);
  groupConns.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  // Remove dragged from list
  const filtered = groupConns.filter(c => c.name !== draggedName);

  // Find target index
  const targetIdx = filtered.findIndex(c => c.name === targetName);
  const insertIdx = insertBefore ? targetIdx : targetIdx + 1;

  // Insert dragged at the correct position
  filtered.splice(insertIdx, 0, draggedConn);

  // Reassign sortOrder values
  filtered.forEach((c, idx) => {
    c.sortOrder = idx;
  });

  // Switch to manual sort
  sortPreference = 'manual';
  safeSetItem('ssmSortPreference', 'manual');
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) sortSelect.value = 'manual';

  safeSetItem('ssmConnections', JSON.stringify(savedConnections));
  renderGroupsWithConnections();
}

function loadConnection(name) {
  const conn = savedConnections.find(c => c.name === name);
  if (!conn) return;

  // Update last used timestamp
  conn.lastUsedAt = Date.now();
  safeSetItem('ssmConnections', JSON.stringify(savedConnections));

  // Track the original name for editing
  editingConnectionName = conn.name;

  document.getElementById('connectionName').value = conn.name;
  document.getElementById('profileSelect').value = conn.profile;
  document.getElementById('connectionGroup').value = conn.groupId || ensureDefaultGroupId();
  document.getElementById('targetInstance').value = conn.target;
  document.getElementById('serviceHost').value = conn.host;
  document.getElementById('region').value = conn.region;

  const serviceRadio = document.querySelector(`input[name="service"][value="${conn.service}"]`);
  if (serviceRadio) {
    serviceRadio.checked = true;
    selectedService = conn.service;
    if (conn.service === 'custom') {
      document.getElementById('remotePort').value = conn.portNumber || '';
      document.getElementById('remotePort').readOnly = false;
      document.getElementById('remotePort').classList.remove('readonly', 'hidden');
      document.getElementById('remotePortDisplay').classList.add('hidden');
      document.getElementById('customServiceGroup').classList.remove('hidden');
      document.getElementById('customServiceName').value = conn.customServiceName || '';
    } else {
      document.getElementById('remotePort').value = serviceConfig[conn.service].remotePort;
      document.getElementById('remotePort').readOnly = true;
      document.getElementById('remotePort').classList.add('readonly', 'hidden');
      document.getElementById('remotePortDisplay').textContent = serviceConfig[conn.service].remotePort;
      document.getElementById('remotePortDisplay').classList.remove('hidden');
      document.getElementById('customServiceGroup').classList.add('hidden');
      document.getElementById('customServiceName').value = '';
    }
    // Use saved local port if available, otherwise use default
    document.getElementById('localPort').value = conn.localPortNumber || serviceConfig[conn.service].localPort || '';
  }

  // Check for port conflicts after loading
  checkLocalPortConflict(conn.localPortNumber);

  // Populate notes
  document.getElementById('connectionNotes').value = conn.notes || '';
  const sessionTimeout = document.getElementById('sessionTimeout');
  if (sessionTimeout) {
    const timeoutValue = conn.sessionTimeoutMinutes == null
      ? sanitizeTimeoutSelection(localStorage.getItem(DEFAULT_TIMEOUT_STORAGE_KEY))
      : sanitizeTimeoutSelection(conn.sessionTimeoutMinutes);
    sessionTimeout.value = timeoutValue;
  }
  updateSessionTimerDefaultDisplay();

  // Update form header to show edit mode
  updateFormHeader(conn.name);

  // Update sidebar to highlight selected connection
  renderGroupsWithConnections();

  // Update button state (might change if session is active on different connection)
  updateSessionButton();

  showToast(`Loaded: ${name}`);
}

// Update form header based on edit state
function updateFormHeader(connectionName = null) {
  const headerTitle = document.querySelector('.form-header h1');
  const headerDesc = document.querySelector('.form-header p');

  if (connectionName) {
    headerTitle.textContent = 'Edit Connection';
    headerDesc.innerHTML = `Editing: <strong>${escapeHtml(connectionName)}</strong>`;
  } else {
    headerTitle.textContent = 'New Connection';
    headerDesc.textContent = 'Configure your AWS SSM port forwarding session';
  }
}

// Bulk Operations
function toggleBulkSelectMode() {
  bulkSelectMode = !bulkSelectMode;
  selectedConnections.clear();
  document.getElementById('bulkSelectToggle').classList.toggle('active', bulkSelectMode);
  document.getElementById('bulkActionBar').classList.toggle('hidden', !bulkSelectMode);
  updateBulkActionBar();
  renderGroupsWithConnections();
}

function updateBulkActionBar() {
  const countEl = document.getElementById('bulkCount');
  if (countEl) {
    countEl.textContent = `${selectedConnections.size} selected`;
  }
  const deleteBtn = document.getElementById('bulkDeleteBtn');
  const moveBtn = document.getElementById('bulkMoveBtn');
  const exportBtn = document.getElementById('bulkExportBtn');
  const disabled = selectedConnections.size === 0;
  if (deleteBtn) deleteBtn.disabled = disabled;
  if (moveBtn) moveBtn.disabled = disabled;
  if (exportBtn) exportBtn.disabled = disabled;
}

function bulkSelectAll() {
  const allVisible = document.querySelectorAll('.bulk-check-input');
  const allChecked = selectedConnections.size > 0 && selectedConnections.size === allVisible.length;

  if (allChecked) {
    selectedConnections.clear();
  } else {
    allVisible.forEach(cb => {
      selectedConnections.add(cb.dataset.name);
    });
  }
  renderGroupsWithConnections();
  updateBulkActionBar();
}

function bulkDeleteSelected() {
  if (selectedConnections.size === 0) return;
  const count = selectedConnections.size;
  if (!confirm(`Delete ${count} connection${count > 1 ? 's' : ''}? This cannot be undone.`)) return;

  savedConnections = savedConnections.filter(c => !selectedConnections.has(c.name));
  safeSetItem('ssmConnections', JSON.stringify(savedConnections));
  selectedConnections.clear();
  updateBulkActionBar();
  renderGroupsWithConnections();
  updateFilterDropdowns();
  showToast(`Deleted ${count} connection${count > 1 ? 's' : ''}`);
}

function openBulkMoveModal() {
  if (selectedConnections.size === 0) return;
  const modal = document.getElementById('bulkMoveModal');
  const select = document.getElementById('bulkMoveGroup');
  select.innerHTML = '';
  connectionGroups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    select.appendChild(opt);
  });
  select.value = ensureDefaultGroupId();
  modal.classList.remove('hidden');
}

function confirmBulkMove() {
  const groupId = document.getElementById('bulkMoveGroup').value || ensureDefaultGroupId();
  savedConnections.forEach(c => {
    if (selectedConnections.has(c.name)) {
      c.groupId = groupId;
    }
  });
  safeSetItem('ssmConnections', JSON.stringify(savedConnections));
  const count = selectedConnections.size;
  selectedConnections.clear();
  document.getElementById('bulkMoveModal').classList.add('hidden');
  updateBulkActionBar();
  renderGroupsWithConnections();
  showToast(`Moved ${count} connection${count > 1 ? 's' : ''}`);
}

async function bulkExportSelected() {
  if (selectedConnections.size === 0) return;
  const conns = savedConnections.filter(c => selectedConnections.has(c.name));
  // Include groups that are referenced by selected connections
  const groupIds = new Set(conns.map(c => c.groupId).filter(Boolean));
  const groups = connectionGroups.filter(g => groupIds.has(g.id));

  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    connections: conns,
    groups: groups
  };

  const result = await window.electronAPI.exportConnections(exportData);
  if (result.success) {
    showToast(`Exported ${conns.length} connection${conns.length > 1 ? 's' : ''}`, 'success');
  } else if (!result.canceled) {
    showToast('Export failed: ' + (result.error || 'Unknown error'), 'error');
  }
}

// Filter Management
function updateFilterDropdowns() {
  const regions = new Set();
  const profiles = new Set();
  savedConnections.forEach(conn => {
    if (conn.region) regions.add(conn.region);
    if (conn.profile) profiles.add(conn.profile);
  });

  const regionSelect = document.getElementById('filterRegion');
  const profileSelect = document.getElementById('filterProfile');
  const groupSelect = document.getElementById('filterGroup');

  if (regionSelect) {
    const val = regionSelect.value;
    regionSelect.innerHTML = '<option value="">All Regions</option>';
    [...regions].sort().forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      regionSelect.appendChild(opt);
    });
    regionSelect.value = val;
  }

  if (profileSelect) {
    const val = profileSelect.value;
    profileSelect.innerHTML = '<option value="">All Profiles</option>';
    [...profiles].sort().forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      profileSelect.appendChild(opt);
    });
    profileSelect.value = val;
  }

  if (groupSelect) {
    const val = groupSelect.value;
    groupSelect.innerHTML = '<option value="">All Groups</option>';
    connectionGroups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      groupSelect.appendChild(opt);
    });
    groupSelect.value = val;
  }
}

function updateFilterBadge() {
  const badge = document.getElementById('filterBadge');
  if (!badge) return;
  const count = Object.values(activeFilters).filter(v => v !== '').length;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

function clearAllFilters() {
  activeFilters = { group: '', service: '', region: '', profile: '' };
  document.getElementById('filterGroup').value = '';
  document.getElementById('filterService').value = '';
  document.getElementById('filterRegion').value = '';
  document.getElementById('filterProfile').value = '';
  updateFilterBadge();
  renderGroupsWithConnections();
}

// Event Listeners
function setupEventListeners() {
  document.getElementById('refreshProfiles').addEventListener('click', async () => {
    await loadProfiles();
    showToast('Profiles refreshed');
  });

  document.querySelectorAll('input[name="service"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      selectedService = e.target.value;
      const config = serviceConfig[selectedService];
      if (selectedService === 'custom') {
        document.getElementById('remotePort').value = '';
        document.getElementById('remotePort').readOnly = false;
        document.getElementById('remotePort').classList.remove('readonly', 'hidden');
        document.getElementById('remotePortDisplay').classList.add('hidden');
        document.getElementById('customServiceGroup').classList.remove('hidden');
        document.getElementById('customServiceName').focus();
      } else {
        document.getElementById('remotePort').value = config.remotePort;
        document.getElementById('remotePort').readOnly = true;
        document.getElementById('remotePort').classList.add('readonly', 'hidden');
        document.getElementById('remotePortDisplay').textContent = config.remotePort;
        document.getElementById('remotePortDisplay').classList.remove('hidden');
        document.getElementById('customServiceGroup').classList.add('hidden');
        document.getElementById('customServiceName').value = '';
        document.getElementById('localPort').value = config.localPort;
      }
      checkLocalPortConflict(document.getElementById('localPort').value);
    });
  });

  document.getElementById('localPort').addEventListener('input', (e) => {
    checkLocalPortConflict(e.target.value);
  });

  const timeoutSelect = document.getElementById('sessionTimeout');
  if (timeoutSelect) {
    timeoutSelect.addEventListener('change', () => {
      const timeoutValue = getSelectedSessionTimeoutValue();
      safeSetItem(DEFAULT_TIMEOUT_STORAGE_KEY, timeoutValue);
      updateSessionTimerDefaultDisplay();
    });
  }

  // Save Connection button
  document.getElementById('saveBtn').addEventListener('click', () => {
    handleSaveConnection();
  });

  // Start/Stop Session button (form submit)
  document.getElementById('ssmForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleSessionToggle();
  });

  document.getElementById('newConnectionBtnFooter').addEventListener('click', () => {
    resetForm();
  });

  // Group Modal (addGroupBtn is now dynamically rendered in renderGroupsWithConnections)
  document.getElementById('closeModal').addEventListener('click', closeGroupModal);
  document.getElementById('cancelGroup').addEventListener('click', closeGroupModal);
  document.getElementById('saveGroup').addEventListener('click', handleSaveGroup);

  document.getElementById('groupModal').addEventListener('click', (e) => {
    if (e.target.id === 'groupModal') closeGroupModal();
  });

  // Search connections
  document.getElementById('connectionSearch').addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase().trim();
    renderGroupsWithConnections();
  });

  // Bulk select toggle
  document.getElementById('bulkSelectToggle').addEventListener('click', toggleBulkSelectMode);
  document.getElementById('bulkSelectAllLink').addEventListener('click', (e) => {
    e.preventDefault();
    bulkSelectAll();
  });
  document.getElementById('bulkDeleteBtn').addEventListener('click', bulkDeleteSelected);
  document.getElementById('bulkMoveBtn').addEventListener('click', openBulkMoveModal);
  document.getElementById('bulkExportBtn').addEventListener('click', bulkExportSelected);
  document.getElementById('bulkMoveConfirm').addEventListener('click', confirmBulkMove);
  document.getElementById('bulkMoveCancel').addEventListener('click', () => {
    document.getElementById('bulkMoveModal').classList.add('hidden');
  });
  document.getElementById('bulkMoveModal').addEventListener('click', (e) => {
    if (e.target.id === 'bulkMoveModal') document.getElementById('bulkMoveModal').classList.add('hidden');
  });

  // Filter toggle
  document.getElementById('filterToggle').addEventListener('click', () => {
    filterPanelVisible = !filterPanelVisible;
    document.getElementById('filterPanel').classList.toggle('hidden', !filterPanelVisible);
    document.getElementById('filterToggle').classList.toggle('active', filterPanelVisible);
  });

  // Filter selects
  ['filterGroup', 'filterService', 'filterRegion', 'filterProfile'].forEach(id => {
    const key = id.replace('filter', '').toLowerCase();
    document.getElementById(id).addEventListener('change', (e) => {
      activeFilters[key] = e.target.value;
      updateFilterBadge();
      renderGroupsWithConnections();
    });
  });

  // Clear filters
  document.getElementById('clearFilters').addEventListener('click', clearAllFilters);

  // Sort select
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.value = sortPreference;
    sortSelect.addEventListener('change', (e) => {
      sortPreference = e.target.value;
      safeSetItem('ssmSortPreference', sortPreference);
      renderGroupsWithConnections();
    });
  }

  // Export/Import buttons
  document.getElementById('exportBtn').addEventListener('click', () => {
    document.getElementById('overflowMenu').classList.add('hidden');
    exportConnections();
  });
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('overflowMenu').classList.add('hidden');
    importConnections();
  });

  // Overflow menu toggle
  document.getElementById('footerOverflowBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('overflowMenu').classList.toggle('hidden');
  });
  document.addEventListener('click', () => {
    document.getElementById('overflowMenu').classList.add('hidden');
  });

  // Shortcuts modal
  document.getElementById('closeShortcuts').addEventListener('click', () => {
    document.getElementById('shortcutsModal').classList.add('hidden');
  });
  document.getElementById('shortcutsModal').addEventListener('click', (e) => {
    if (e.target.id === 'shortcutsModal') {
      document.getElementById('shortcutsModal').classList.add('hidden');
    }
  });

  // Delete confirmation modal
  document.getElementById('closeDeleteModal').addEventListener('click', closeDeleteModal);
  document.getElementById('cancelDelete').addEventListener('click', closeDeleteModal);
  document.getElementById('confirmDelete').addEventListener('click', confirmDeleteConnection);
  document.getElementById('deleteModal').addEventListener('click', (e) => {
    if (e.target.id === 'deleteModal') closeDeleteModal();
  });

  // Inline validation on blur (B1)
  document.getElementById('targetInstance').addEventListener('blur', (e) => {
    const val = e.target.value.trim();
    if (val && !validationPatterns.instanceId.test(val)) {
      e.target.classList.add('field-error');
    } else {
      e.target.classList.remove('field-error');
    }
  });
  document.getElementById('serviceHost').addEventListener('blur', (e) => {
    const val = e.target.value.trim();
    if (val && !validationPatterns.hostname.test(val)) {
      e.target.classList.add('field-error');
    } else {
      e.target.classList.remove('field-error');
    }
  });
  document.getElementById('localPort').addEventListener('blur', (e) => {
    const val = e.target.value.trim();
    if (val && !validationPatterns.port(val)) {
      e.target.classList.add('field-error');
    } else {
      e.target.classList.remove('field-error');
    }
  });

  // Copy URL button
  document.getElementById('copyUrlBtn').addEventListener('click', copyActiveUrl);

  // Open URL button
  document.getElementById('openUrlBtn').addEventListener('click', openActiveUrl);

  // Session IPC listeners are registered once in setupTerminal()
}

// Modal Functions
function openGroupModal(groupId = null) {
  editingGroupId = groupId;
  const modal = document.getElementById('groupModal');
  const modalTitle = document.getElementById('modalTitle');
  const nameInput = document.getElementById('groupName');

  modal.classList.remove('hidden');

  if (groupId) {
    // Edit mode
    const group = connectionGroups.find(g => g.id === groupId);
    if (group) {
      modalTitle.textContent = 'Edit Group';
      nameInput.value = group.name;
      const colorRadio = document.querySelector(`input[name="groupColor"][value="${group.color}"]`);
      if (colorRadio) {
        colorRadio.checked = true;
      }
    }
  } else {
    // Create mode
    modalTitle.textContent = 'New Group';
    nameInput.value = '';
    document.querySelector('input[name="groupColor"][value="#ef4444"]').checked = true;
  }

  nameInput.focus();
}

function closeGroupModal() {
  document.getElementById('groupModal').classList.add('hidden');
  editingGroupId = null;
}

// Delete Confirmation Modal
function openDeleteModal(connectionName) {
  pendingDeleteConnection = connectionName;
  document.getElementById('deleteConnectionName').textContent = connectionName;
  document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.add('hidden');
  pendingDeleteConnection = null;
  pendingDeleteGroupId = null;
  // Reset message to default connection format
  document.querySelector('#deleteModal .delete-message').innerHTML = 'Are you sure you want to delete "<span id="deleteConnectionName"></span>"?';
}

function confirmDeleteConnection() {
  if (pendingDeleteGroupId) {
    deleteGroup(pendingDeleteGroupId);
    showToast('Group deleted');
    closeDeleteModal();
    return;
  }
  if (pendingDeleteConnection) {
    deleteConnection(pendingDeleteConnection);
    showToast('Connection deleted');
    closeDeleteModal();
  }
}

function openDeleteGroupModal(groupId) {
  const group = connectionGroups.find(g => g.id === groupId);
  if (!group) return;
  const count = savedConnections.filter(c => c.groupId === groupId).length;
  pendingDeleteGroupId = groupId;
  pendingDeleteConnection = null;
  document.getElementById('deleteConnectionName').textContent = group.name;
  const msgEl = document.querySelector('#deleteModal .delete-message');
  if (count > 0) {
    msgEl.innerHTML = `Are you sure you want to delete group "<span>${escapeHtml(group.name)}</span>"? Its ${count} connection${count > 1 ? 's' : ''} will be moved to the default group.`;
  } else {
    msgEl.innerHTML = `Are you sure you want to delete group "<span>${escapeHtml(group.name)}</span>"?`;
  }
  document.getElementById('deleteModal').classList.remove('hidden');
}

function handleSaveGroup() {
  const name = document.getElementById('groupName').value.trim();
  const color = document.querySelector('input[name="groupColor"]:checked').value;

  if (!name) {
    showToast('Please enter a group name', 'error');
    return;
  }

  if (editingGroupId) {
    // Update existing group
    updateGroup(editingGroupId, name, color);
  } else {
    // Create new group
    addGroup(name, color);
  }

  closeGroupModal();
}

function resetForm() {
  document.getElementById('ssmForm').reset();

  // Clear editing state - this is a new connection
  editingConnectionName = null;

  // Select first service type by default (OpenSearch)
  const firstService = document.querySelector('input[name="service"]');
  if (firstService) {
    firstService.checked = true;
    selectedService = firstService.value;
    const config = serviceConfig[selectedService];
    document.getElementById('remotePort').value = config.remotePort;
    document.getElementById('remotePort').readOnly = true;
    document.getElementById('remotePort').classList.add('readonly', 'hidden');
    document.getElementById('remotePortDisplay').textContent = config.remotePort;
    document.getElementById('remotePortDisplay').classList.remove('hidden');
    document.getElementById('localPort').value = config.localPort;
    document.getElementById('customServiceGroup').classList.add('hidden');
    document.getElementById('customServiceName').value = '';
  }
  document.getElementById('portConflictWarning').classList.add('hidden');

  const sessionTimeout = document.getElementById('sessionTimeout');
  if (sessionTimeout) {
    sessionTimeout.value = sanitizeTimeoutSelection(localStorage.getItem(DEFAULT_TIMEOUT_STORAGE_KEY));
  }
  const connectionGroupSelect = document.getElementById('connectionGroup');
  if (connectionGroupSelect) {
    connectionGroupSelect.value = ensureDefaultGroupId();
  }
  updateSessionTimerDefaultDisplay();

  // Reset form header to "New Connection"
  updateFormHeader(null);

  // Update sidebar to remove selection highlight
  renderGroupsWithConnections();

  // Update button state
  updateSessionButton();
}

function getConnectionConfig() {
  const profile = document.getElementById('profileSelect').value;
  const region = document.getElementById('region').value;
  const target = document.getElementById('targetInstance').value.trim();
  const host = document.getElementById('serviceHost').value.trim();
  const name = document.getElementById('connectionName').value.trim();
  const groupId = document.getElementById('connectionGroup').value || null;
  const notes = document.getElementById('connectionNotes').value.trim();
  const sessionTimeoutMinutes = getSelectedSessionTimeoutMinutes();
  const customServiceName = selectedService === 'custom'
    ? document.getElementById('customServiceName').value.trim()
    : '';

  return { profile, region, target, host, name, groupId, notes, sessionTimeoutMinutes, customServiceName };
}

// Input validation patterns
const validationPatterns = {
  // AWS instance ID: i- followed by 8 or 17 hex characters
  instanceId: /^i-[0-9a-f]{8}([0-9a-f]{9})?$/,
  // AWS region: e.g., us-east-1, eu-west-2, ap-southeast-1
  region: /^[a-z]{2}-[a-z]+-\d$/,
  // Port number validation
  port: (val) => {
    const num = parseInt(val, 10);
    return !isNaN(num) && num >= 1 && num <= 65535;
  },
  // AWS profile name: alphanumeric, dots, hyphens, underscores
  profile: /^[a-zA-Z0-9._-]+$/,
  // Hostname: valid DNS name or IP address
  hostname: /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/
};

function validateForm() {
  const { profile, region, target, host } = getConnectionConfig();
  const localPort = document.getElementById('localPort').value;
  const remotePort = document.getElementById('remotePort').value;

  if (!profile) {
    showToast('Please select an AWS profile', 'error');
    return false;
  }

  if (!validationPatterns.profile.test(profile)) {
    showToast('Invalid AWS profile name format', 'error');
    return false;
  }

  if (!selectedService) {
    showToast('Please select a service type', 'error');
    return false;
  }

  if (selectedService === 'custom') {
    const customName = document.getElementById('customServiceName').value.trim();
    if (!customName) {
      showToast('Please enter a custom service name', 'error');
      return false;
    }
    if (customName.length > 50) {
      showToast('Custom service name must be 50 characters or less', 'error');
      return false;
    }
  }

  if (!target || !host || !region) {
    showToast('Please fill all required fields', 'error');
    return false;
  }

  if (!validationPatterns.instanceId.test(target)) {
    showToast('Invalid instance ID format (expected: i-xxxxxxxx or i-xxxxxxxxxxxxxxxxx)', 'error');
    return false;
  }

  if (!validationPatterns.region.test(region)) {
    showToast('Invalid AWS region format (expected: xx-xxxx-N, e.g., us-east-1)', 'error');
    return false;
  }

  if (!validationPatterns.hostname.test(host)) {
    showToast('Invalid hostname format', 'error');
    return false;
  }

  if (!validationPatterns.port(localPort)) {
    showToast('Invalid local port (must be 1-65535)', 'error');
    return false;
  }

  if (!validationPatterns.port(remotePort)) {
    showToast('Invalid remote port (must be 1-65535)', 'error');
    return false;
  }

  return true;
}

function handleSaveConnection() {
  if (!validateForm()) return;

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

  saveConnection(config);
}

async function handleSessionToggle() {
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

async function stopAllSessions() {
  if (sessions.size === 0) return;
  await window.electronAPI.stopSSMSession('__all__');
  [...sessions.keys()].forEach(id => cleanupSession(id));
  updateSessionButton();
}

function cleanupSession(id) {
  const sess = sessions.get(id);
  if (!sess) return;

  stopSessionTimer(id);
  sess.terminal?.dispose();
  sess.mountEl?.remove();

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

function handleSessionClosed(id) {
  cleanupSession(id);
  showToast('Session closed');
  updateSessionButton();
}

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

// Session Timer Functions
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

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(12px)';
    toast.style.transition = 'all 0.15s ease-out';
    setTimeout(() => toast.remove(), 150);
  }, 2500);
}

// Port conflict detection
function checkLocalPortConflict(portStr) {
  const warningEl = document.getElementById('portConflictWarning');
  if (!warningEl) return;

  const port = portStr ? portStr.trim() : '';
  if (!port) {
    warningEl.classList.add('hidden');
    document.getElementById('localPort')?.classList.remove('port-conflict');
    return;
  }

  // Find connections with the same local port, excluding current connection being edited
  const conflicts = savedConnections.filter(c => {
    if (c.localPortNumber !== port) return false;
    // Exclude the connection currently being edited
    if (editingConnectionName && c.name === editingConnectionName) return false;
    return true;
  });

  const localPortInput = document.getElementById('localPort');
  if (conflicts.length === 0) {
    warningEl.classList.add('hidden');
    if (localPortInput) localPortInput.classList.remove('port-conflict');
  } else {
    const name = escapeHtml(conflicts[0].name);
    const extra = conflicts.length > 1 ? ` +${conflicts.length - 1} more` : '';
    warningEl.textContent = `Also used by: ${conflicts[0].name}${conflicts.length > 1 ? ` +${conflicts.length - 1} more` : ''}`;
    warningEl.classList.remove('hidden');
    if (localPortInput) localPortInput.classList.add('port-conflict');
  }
}

// Copy Active URL to clipboard
function copyActiveUrl() {
  const activeConfig = sessions.get(activeTabId)?.config;
  if (!activeConfig) {
    showToast('No active session', 'error');
    return;
  }

  const service = activeConfig.service;
  const port = activeConfig.localPortNumber;
  const config = serviceConfig[service];

  if (!config || !config.urlTemplate) {
    showToast('No URL available for this service type', 'error');
    return;
  }

  const url = config.urlTemplate(port);

  navigator.clipboard.writeText(url).then(() => {
    const copyBtn = document.getElementById('copyUrlBtn');
    copyBtn.classList.add('copied');
    copyBtn.querySelector('span').textContent = 'Copied!';
    showToast(`Copied: ${url}`, 'success');

    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.querySelector('span').textContent = 'Copy URL';
    }, 2000);
  }).catch(() => {
    showToast('Failed to copy to clipboard', 'error');
  });
}

// Open Active URL in browser
function openActiveUrl() {
  const activeConfig = sessions.get(activeTabId)?.config;
  if (!activeConfig) {
    showToast('No active session', 'error');
    return;
  }

  const service = activeConfig.service;
  const port = activeConfig.localPortNumber;
  const config = serviceConfig[service];

  if (!config || !config.urlTemplate) {
    showToast('No URL available for this service type', 'error');
    return;
  }

  const url = config.urlTemplate(port);
  window.electronAPI.openUrl(url).then((result) => {
    if (result.success) {
      showToast(`Opening: ${url}`, 'success');
    } else {
      showToast('Failed to open URL: ' + (result.error || 'Unknown error'), 'error');
    }
  });
}

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'system';
  setTheme(savedTheme);

  // Setup theme button listeners
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      setTheme(theme);
    });
  });
}

async function setTheme(theme) {
  safeSetItem('theme', theme);

  // Update button states
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });

  // Apply theme via Electron's nativeTheme
  await window.darkMode.set(theme);
}

// Export/Import Connections
async function exportConnections() {
  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    connections: savedConnections,
    groups: connectionGroups
  };

  const result = await window.electronAPI.exportConnections(exportData);

  if (result.success) {
    showToast(`Exported ${savedConnections.length} connections`, 'success');
  } else if (!result.canceled) {
    showToast('Export failed: ' + (result.error || 'Unknown error'), 'error');
  }
}

async function importConnections() {
  const result = await window.electronAPI.importConnections();

  if (result.canceled) return;

  if (!result.success) {
    showToast('Import failed: ' + (result.error || 'Unknown error'), 'error');
    return;
  }

  const { data, warnings } = result;

  // Show import confirmation modal
  const importCount = data.connections?.length || 0;
  const groupCount = data.groups?.length || 0;

  if (importCount === 0) {
    showToast('No valid connections found in file', 'error');
    return;
  }

  // Merge or replace dialog - for simplicity, we'll merge with existing
  // Merge groups first
  if (data.groups && Array.isArray(data.groups)) {
    data.groups.forEach(importedGroup => {
      const existingGroup = connectionGroups.find(g => g.id === importedGroup.id);
      if (!existingGroup) {
        connectionGroups.push(importedGroup);
      }
    });
    safeSetItem('ssmGroups', JSON.stringify(connectionGroups));
  }

  const defaultGroupId = ensureDefaultGroupId();
  const validGroupIds = new Set(connectionGroups.map(group => group.id));

  // Merge connections - update existing, add new
  data.connections.forEach(importedConn => {
    const normalizedConn = { ...importedConn };
    if (!normalizedConn.groupId || !validGroupIds.has(normalizedConn.groupId)) {
      normalizedConn.groupId = defaultGroupId;
    }

    // Match by id (unique), fall back to name for backward compat with old exports
    let existingIndex = normalizedConn.id
      ? savedConnections.findIndex(c => c.id === normalizedConn.id)
      : -1;
    if (existingIndex < 0) {
      existingIndex = savedConnections.findIndex(c => c.name === normalizedConn.name);
    }
    if (existingIndex >= 0) {
      savedConnections[existingIndex] = normalizedConn;
    } else {
      if (!normalizedConn.id) normalizedConn.id = generateConnectionId();
      savedConnections.push(normalizedConn);
    }
  });

  safeSetItem('ssmConnections', JSON.stringify(savedConnections));
  renderGroupsWithConnections();
  updateGroupDropdown();

  // Show success message with any warnings
  if (warnings) {
    showToast(`Imported ${importCount} connections. ${warnings}`, 'info');
  } else {
    showToast(`Imported ${importCount} connections and ${groupCount} groups`, 'success');
  }
}

// Keyboard Shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const isMod = e.metaKey || e.ctrlKey;
    const activeEl = document.activeElement;
    const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');

    // Escape — close topmost open modal (always works)
    if (e.key === 'Escape') {
      const modals = ['shortcutsModal', 'onboardingModal', 'bulkMoveModal', 'deleteModal', 'groupModal'];
      for (const id of modals) {
        const modal = document.getElementById(id);
        if (modal && !modal.classList.contains('hidden')) {
          modal.classList.add('hidden');
          e.preventDefault();
          return;
        }
      }
      // Close terminal if visible
      const terminalModal = document.getElementById('terminalModal');
      if (terminalModal && !terminalModal.classList.contains('hidden')) {
        terminalModal.classList.add('minimized');
        e.preventDefault();
        return;
      }
      return;
    }

    // Cmd/Ctrl+K — focus search (always works)
    if (isMod && e.key === 'k') {
      e.preventDefault();
      document.getElementById('connectionSearch').focus();
      return;
    }

    // Skip remaining shortcuts when input/textarea/select is focused
    if (isInputFocused) return;

    // ? — show keyboard shortcuts
    if (e.key === '?' && !isMod) {
      e.preventDefault();
      document.getElementById('shortcutsModal').classList.toggle('hidden');
      return;
    }

    // Cmd/Ctrl+N — new connection
    if (isMod && e.key === 'n') {
      e.preventDefault();
      resetForm();
      return;
    }

    // Cmd/Ctrl+S — save connection
    if (isMod && e.key === 's') {
      e.preventDefault();
      handleSaveConnection();
      return;
    }

    // Cmd/Ctrl+Enter — start/stop session
    if (isMod && e.key === 'Enter') {
      e.preventDefault();
      handleSessionToggle();
      return;
    }

    // Cmd/Ctrl+W — close session/terminal
    if (isMod && e.key === 'w') {
      if (sessions.size > 0) {
        e.preventDefault();
        stopAllSessions().then(() => hideTerminal());
        return;
      }
    }
  });
}

// Onboarding Wizard
function checkOnboarding() {
  if (localStorage.getItem('ssmOnboardingComplete') === 'true') return;
  showOnboardingModal();
}

function showOnboardingModal() {
  const modal = document.getElementById('onboardingModal');
  modal.classList.remove('hidden');

  document.getElementById('onboardingDismiss').addEventListener('click', () => {
    safeSetItem('ssmOnboardingComplete', 'true');
    modal.classList.add('hidden');
  });

  document.getElementById('onboardingRecheck').addEventListener('click', () => {
    runPrerequisiteChecks();
  });

  modal.addEventListener('click', (e) => {
    // Don't close on backdrop click — user should explicitly dismiss
  });

  runPrerequisiteChecks();
}

async function runPrerequisiteChecks() {
  // Reset all checks to loading state
  const checks = [
    { id: 'checkAwsCli', title: 'AWS CLI v2' },
    { id: 'checkSsmPlugin', title: 'Session Manager Plugin' },
    { id: 'checkCredentials', title: 'AWS Credentials' }
  ];

  checks.forEach(check => {
    const el = document.getElementById(check.id);
    el.querySelector('.onboarding-status').innerHTML = '<span class="onboarding-spinner"></span>';
    el.querySelector('.onboarding-check-detail').textContent = 'Checking...';
    el.className = 'onboarding-check';
  });

  const result = await window.electronAPI.checkPrerequisites();

  // AWS CLI
  const awsEl = document.getElementById('checkAwsCli');
  if (result.awsCli.installed) {
    awsEl.querySelector('.onboarding-status').innerHTML = '<span class="onboarding-icon pass">&#10003;</span>';
    awsEl.querySelector('.onboarding-check-detail').textContent = result.awsCli.version || 'Installed';
    awsEl.classList.add('pass');
  } else {
    awsEl.querySelector('.onboarding-status').innerHTML = '<span class="onboarding-icon fail">&#10007;</span>';
    awsEl.querySelector('.onboarding-check-detail').innerHTML =
      'Not found. <a class="onboarding-link" data-url="https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html">Install Guide</a>';
    awsEl.classList.add('fail');
    awsEl.querySelector('.onboarding-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI.openExternal(e.target.dataset.url);
    });
  }

  // SSM Plugin
  const ssmEl = document.getElementById('checkSsmPlugin');
  if (result.ssmPlugin.installed) {
    ssmEl.querySelector('.onboarding-status').innerHTML = '<span class="onboarding-icon pass">&#10003;</span>';
    ssmEl.querySelector('.onboarding-check-detail').textContent = 'Installed';
    ssmEl.classList.add('pass');
  } else {
    ssmEl.querySelector('.onboarding-status').innerHTML = '<span class="onboarding-icon fail">&#10007;</span>';
    ssmEl.querySelector('.onboarding-check-detail').innerHTML =
      'Not found. <a class="onboarding-link" data-url="https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html">Install Guide</a>';
    ssmEl.classList.add('fail');
    ssmEl.querySelector('.onboarding-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI.openExternal(e.target.dataset.url);
    });
  }

  // Credentials
  const credEl = document.getElementById('checkCredentials');
  if (result.credentials.configured) {
    credEl.querySelector('.onboarding-status').innerHTML = '<span class="onboarding-icon pass">&#10003;</span>';
    credEl.querySelector('.onboarding-check-detail').textContent = `${result.credentials.profileCount} profile${result.credentials.profileCount !== 1 ? 's' : ''} found`;
    credEl.classList.add('pass');
  } else {
    credEl.querySelector('.onboarding-status').innerHTML = '<span class="onboarding-icon fail">&#10007;</span>';
    credEl.querySelector('.onboarding-check-detail').innerHTML =
      'No profiles found. <a class="onboarding-link" data-url="https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html">Configure Guide</a>';
    credEl.classList.add('fail');
    credEl.querySelector('.onboarding-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI.openExternal(e.target.dataset.url);
    });
  }
}
