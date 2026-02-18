let selectedService = null;
let savedConnections = [];
let connectionGroups = [];
let editingGroupId = null;
let editingConnectionName = null; // Track the original name of connection being edited
let searchTerm = '';
let collapsedGroups = new Set();
let isSessionActive = false;
let activeConnectionName = null; // Track which connection is currently active
let activeConnectionConfig = null; // Store the active connection config for URL generation
let pendingDeleteConnection = null; // Track connection pending deletion
let terminal = null;
let fitAddon = null;

// HTML escape function to prevent XSS attacks
function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Session timer
let sessionStartTime = null;
let sessionDuration = 10 * 60 * 1000; // 10 minutes default
let timerInterval = null;

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
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadProfiles();
  loadGroups();
  loadSavedConnections();
  setupEventListeners();
  setupTerminal();
  checkSessionStatus();
  initTheme();
});

// Terminal Management
function setupTerminal() {
  // Create terminal using global Terminal class (loaded via script tag)
  terminal = new Terminal({
    theme: {
      background: '#1a1a1a',
      foreground: '#f5f5f5',
      cursor: '#f5f5f5',
      cursorAccent: '#1a1a1a',
      selectionBackground: '#3b82f6',
      black: '#1a1a1a',
      red: '#ef4444',
      green: '#22c55e',
      yellow: '#eab308',
      blue: '#3b82f6',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#f5f5f5'
    },
    fontFamily: 'Monaco, Menlo, Ubuntu Mono, monospace',
    fontSize: 13,
    lineHeight: 1.4,
    cursorBlink: true,
    scrollback: 1000,
    convertEol: true
  });

  fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);

  // Terminal output listener
  window.electronAPI.onTerminalOutput((text) => {
    if (terminal) {
      terminal.write(text);
    }
  });

  // Session status listener
  window.electronAPI.onSessionStatus((status) => {
    updateTerminalStatus(status);
  });

  // Terminal button handlers
  document.getElementById('terminalMinimize').addEventListener('click', () => {
    const modal = document.getElementById('terminalModal');
    modal.classList.toggle('minimized');
  });

  document.getElementById('terminalClose').addEventListener('click', async () => {
    await stopSession();
    hideTerminal();
  });

  // Resize terminal on window resize
  window.addEventListener('resize', () => {
    if (fitAddon && terminal && !document.getElementById('terminalModal').classList.contains('hidden')) {
      fitAddon.fit();
    }
  });
}

function showTerminal(config) {
  const modal = document.getElementById('terminalModal');
  const container = document.getElementById('terminalContainer');

  modal.classList.remove('hidden', 'minimized');

  // Initialize terminal in container if not already
  if (!terminal._element) {
    terminal.open(container);
    fitAddon.fit();
  }

  // Clear and write welcome message
  terminal.clear();
  terminal.writeln('\x1b[1;36m╭─────────────────────────────────────────────────────╮\x1b[0m');
  terminal.writeln('\x1b[1;36m│\x1b[0m       \x1b[1;33m⚡ AWS SSM Port Forwarding Session\x1b[0m          \x1b[1;36m│\x1b[0m');
  terminal.writeln('\x1b[1;36m╰─────────────────────────────────────────────────────╯\x1b[0m');
  terminal.writeln('');

  // Update footer info
  document.getElementById('terminalInfo').textContent = `Local: localhost:${config.localPortNumber}`;
  document.getElementById('terminalSessionId').textContent = 'Session: Initializing...';

  updateTerminalStatus('connecting');
}

function hideTerminal() {
  const modal = document.getElementById('terminalModal');
  modal.classList.add('hidden');
  updateTerminalStatus('disconnected');
}

function updateTerminalStatus(status) {
  const statusEl = document.getElementById('terminalStatus');

  // Remove all status classes
  statusEl.classList.remove('connecting', 'connected', 'error', 'disconnected');

  switch (status) {
    case 'connecting':
      statusEl.textContent = 'Connecting...';
      statusEl.classList.add('connecting');
      break;
    case 'connected':
      statusEl.textContent = 'Connected';
      statusEl.classList.add('connected');
      break;
    case 'error':
      statusEl.textContent = 'Error';
      statusEl.classList.add('error');
      break;
    case 'disconnecting':
      statusEl.textContent = 'Disconnecting...';
      statusEl.classList.add('connecting');
      break;
    case 'disconnected':
      statusEl.textContent = 'Disconnected';
      statusEl.classList.add('disconnected');
      break;
    default:
      statusEl.textContent = status;
  }
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
function loadGroups() {
  const saved = localStorage.getItem('ssmGroups');
  connectionGroups = saved ? JSON.parse(saved) : [];

  const savedCollapsed = localStorage.getItem('ssmCollapsedGroups');
  collapsedGroups = savedCollapsed ? new Set(JSON.parse(savedCollapsed)) : new Set();

  renderGroupsWithConnections();
  updateGroupDropdown();
}

function saveGroups() {
  localStorage.setItem('ssmGroups', JSON.stringify(connectionGroups));
  renderGroupsWithConnections();
  updateGroupDropdown();
}

function saveCollapsedState() {
  localStorage.setItem('ssmCollapsedGroups', JSON.stringify([...collapsedGroups]));
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
  savedConnections = savedConnections.map(c => {
    if (c.groupId === id) {
      return { ...c, groupId: null };
    }
    return c;
  });
  localStorage.setItem('ssmConnections', JSON.stringify(savedConnections));
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
      const serviceName = (serviceConfig[conn.service]?.name || '').toLowerCase();

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

  // Group connections by groupId
  const groupedConnections = new Map();
  const ungroupedConnections = [];

  filtered.forEach(conn => {
    if (conn.groupId) {
      if (!groupedConnections.has(conn.groupId)) {
        groupedConnections.set(conn.groupId, []);
      }
      groupedConnections.get(conn.groupId).push(conn);
    } else {
      ungroupedConnections.push(conn);
    }
  });

  let html = '';

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
            <button class="group-delete" data-id="${escapeHtml(group.id)}" title="Delete">×</button>
          </div>
        </div>
        <div class="group-connections" data-group-id="${escapeHtml(group.id)}">
          ${connections.map(conn => renderConnectionItem(conn, group)).join('')}
        </div>
      </div>
    `;
  });

  // Render ungrouped connections
  if (ungroupedConnections.length > 0 || connectionGroups.length === 0) {
    html += `
      <div class="group-section ungrouped-section" data-group-id="ungrouped">
        ${connectionGroups.length > 0 ? `
          <div class="group-header ungrouped-header">
            <span class="group-chevron-placeholder"></span>
            <span class="group-color ungrouped-color"></span>
            <span class="group-name ungrouped-name">Ungrouped</span>
            <span class="group-count">${ungroupedConnections.length}</span>
          </div>
        ` : ''}
        <div class="group-connections" data-group-id="ungrouped">
          ${ungroupedConnections.map(conn => renderConnectionItem(conn, null)).join('')}
          ${filtered.length === 0 ? '<div class="empty-state">No connections yet</div>' : ''}
        </div>
      </div>
    `;
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
      deleteGroup(btn.dataset.id);
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
      loadConnection(item.dataset.name);
    });
  });

  container.querySelectorAll('.connection-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteModal(btn.dataset.name);
    });
  });

  // Drag and drop for connections
  let draggedConnection = null;

  container.querySelectorAll('.connection-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedConnection = item.dataset.name;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.name);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      draggedConnection = null;
      // Remove all drag-over states
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
  });

  // Drop targets - group headers and group connections areas
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
      // Only remove if leaving the section entirely
      if (!section.contains(e.relatedTarget)) {
        section.classList.remove('drag-over');
      }
    };

    const handleDrop = (e) => {
      e.preventDefault();
      section.classList.remove('drag-over');
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
  const select = document.getElementById('connectionGroup');
  select.innerHTML = '<option value="">No group</option>';

  connectionGroups.forEach(group => {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.name;
    select.appendChild(option);
  });
}

// Connection Management
function loadSavedConnections() {
  const saved = localStorage.getItem('ssmConnections');
  savedConnections = saved ? JSON.parse(saved) : [];
  renderGroupsWithConnections();
}

function saveConnection(config, showNotification = true) {
  // Use editingConnectionName to find the original connection (handles name changes)
  const lookupName = editingConnectionName || config.name;
  const existing = savedConnections.findIndex(c => c.name === lookupName);

  if (existing >= 0) {
    savedConnections[existing] = config;
  } else {
    savedConnections.push(config);
  }

  // Update editingConnectionName to the new name after save
  editingConnectionName = config.name;

  localStorage.setItem('ssmConnections', JSON.stringify(savedConnections));
  renderGroupsWithConnections();
  updateGroupDropdown();
  if (showNotification) {
    showToast('Connection saved');
  }
}

function deleteConnection(name) {
  savedConnections = savedConnections.filter(c => c.name !== name);
  localStorage.setItem('ssmConnections', JSON.stringify(savedConnections));
  renderGroupsWithConnections();
}

function renderConnectionItem(conn, group) {
  // Validate color is a safe CSS color value
  const borderColor = group && /^#[0-9a-fA-F]{6}$/.test(group.color) ? group.color : 'transparent';
  // Validate icon path - only allow known service icons
  const validServices = ['opensearch', 'aurora', 'elasticache', 'rabbitmq'];
  const iconSrc = validServices.includes(conn.service) && serviceConfig[conn.service]?.icon
    ? serviceConfig[conn.service].icon
    : 'images/AmazonOpenSearch.svg';
  const isActive = isSessionActive && activeConnectionName === conn.name;
  const isSelected = editingConnectionName === conn.name;
  const activeClass = isActive ? 'active-session' : '';
  const selectedClass = isSelected ? 'selected' : '';
  const activeDot = isActive ? '<span class="connection-active-dot" title="Session active"></span>' : '';

  return `
    <div class="connection-item ${activeClass} ${selectedClass}" data-name="${escapeHtml(conn.name)}" draggable="true" style="border-left-color: ${borderColor}">
      <img src="${escapeHtml(iconSrc)}" alt="" class="connection-icon-img">
      <div class="connection-info">
        <div class="connection-name">${activeDot}${escapeHtml(conn.name)}</div>
        <div class="connection-meta">${escapeHtml(conn.profile)} · ${escapeHtml(conn.region)}</div>
      </div>
      <button class="connection-delete" data-name="${escapeHtml(conn.name)}" title="Delete">×</button>
    </div>
  `;
}

// Drag and Drop functionality
function moveConnectionToGroup(connectionName, newGroupId) {
  const conn = savedConnections.find(c => c.name === connectionName);
  if (conn) {
    conn.groupId = newGroupId === 'ungrouped' ? null : newGroupId;
    localStorage.setItem('ssmConnections', JSON.stringify(savedConnections));
    renderGroupsWithConnections();
  }
}

function loadConnection(name) {
  const conn = savedConnections.find(c => c.name === name);
  if (!conn) return;

  // Track the original name for editing
  editingConnectionName = conn.name;

  document.getElementById('connectionName').value = conn.name;
  document.getElementById('profileSelect').value = conn.profile;
  document.getElementById('connectionGroup').value = conn.groupId || '';
  document.getElementById('targetInstance').value = conn.target;
  document.getElementById('serviceHost').value = conn.host;
  document.getElementById('region').value = conn.region;

  const serviceRadio = document.querySelector(`input[name="service"][value="${conn.service}"]`);
  if (serviceRadio) {
    serviceRadio.checked = true;
    selectedService = conn.service;
    document.getElementById('remotePort').value = serviceConfig[conn.service].remotePort;
    // Use saved local port if available, otherwise use default
    document.getElementById('localPort').value = conn.localPortNumber || serviceConfig[conn.service].localPort;
  }

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
      document.getElementById('remotePort').value = config.remotePort;
      document.getElementById('localPort').value = config.localPort;
    });
  });

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

  // Export/Import buttons
  document.getElementById('exportBtn').addEventListener('click', exportConnections);
  document.getElementById('importBtn').addEventListener('click', importConnections);

  // Delete confirmation modal
  document.getElementById('closeDeleteModal').addEventListener('click', closeDeleteModal);
  document.getElementById('cancelDelete').addEventListener('click', closeDeleteModal);
  document.getElementById('confirmDelete').addEventListener('click', confirmDeleteConnection);
  document.getElementById('deleteModal').addEventListener('click', (e) => {
    if (e.target.id === 'deleteModal') closeDeleteModal();
  });

  // Copy URL button
  document.getElementById('copyUrlBtn').addEventListener('click', copyActiveUrl);

  window.electronAPI.onSessionClosed((event, data) => {
    isSessionActive = false;
    activeConnectionName = null;
    activeConnectionConfig = null;
    updateSessionButton();
    stopSessionTimer();
    renderGroupsWithConnections(); // Re-render to remove active indicator
    showToast('Session closed');

    if (terminal) {
      terminal.writeln('\x1b[1;33m→ Session closed by server\x1b[0m');
    }
    updateTerminalStatus('disconnected');
  });
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
}

function confirmDeleteConnection() {
  if (pendingDeleteConnection) {
    deleteConnection(pendingDeleteConnection);
    showToast('Connection deleted');
    closeDeleteModal();
  }
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
    document.getElementById('localPort').value = config.localPort;
  }

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

  return { profile, region, target, host, name, groupId };
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

  const { profile, region, target, host, name, groupId } = getConnectionConfig();

  const config = {
    name: name || `${serviceConfig[selectedService].name} - ${new Date().toLocaleString()}`,
    service: selectedService,
    groupId,
    target,
    host,
    portNumber: document.getElementById('remotePort').value,
    localPortNumber: document.getElementById('localPort').value,
    region,
    profile
  };

  saveConnection(config);
}

async function handleSessionToggle() {
  if (isSessionActive) {
    await stopSession();
  } else {
    await startSession();
  }
}

async function startSession() {
  if (!validateForm()) return;

  const { profile, region, target, host, name, groupId } = getConnectionConfig();

  const config = {
    name: name || `${serviceConfig[selectedService].name} - ${new Date().toLocaleString()}`,
    service: selectedService,
    groupId,
    target,
    host,
    portNumber: document.getElementById('remotePort').value,
    localPortNumber: document.getElementById('localPort').value,
    region,
    profile
  };

  const connectBtn = document.getElementById('connectBtn');
  const saveBtn = document.getElementById('saveBtn');

  connectBtn.disabled = true;
  saveBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';

  // Show terminal modal
  showTerminal(config);

  const result = await window.electronAPI.startSSMSession(config);

  connectBtn.disabled = false;
  saveBtn.disabled = false;

  if (result.success) {
    isSessionActive = true;
    activeConnectionName = config.name;
    activeConnectionConfig = config;
    updateSessionButton();
    saveConnection(config, false);
    renderGroupsWithConnections(); // Re-render to show active indicator
    startSessionTimer(); // Start countdown timer

    // Update terminal session info
    if (result.sessionId) {
      document.getElementById('terminalSessionId').textContent = `Session: ${result.sessionId.substring(0, 20)}...`;
    }
  } else {
    connectBtn.textContent = 'Start Session';
    showToast('Connection failed: ' + (result.error || 'Unknown error'), 'error');
    updateTerminalStatus('error');
    if (terminal) {
      terminal.writeln(`\x1b[1;31m✗ Error: ${result.error || 'Unknown error'}\x1b[0m`);
    }
  }
}

async function stopSession() {
  const connectBtn = document.getElementById('connectBtn');
  connectBtn.disabled = true;
  connectBtn.textContent = 'Stopping...';

  updateTerminalStatus('disconnecting');
  if (terminal) {
    terminal.writeln('\x1b[1;33m→ Stopping session...\x1b[0m');
  }

  const result = await window.electronAPI.stopSSMSession();

  connectBtn.disabled = false;

  if (result.success) {
    isSessionActive = false;
    activeConnectionName = null;
    activeConnectionConfig = null;
    updateSessionButton();
    stopSessionTimer();
    renderGroupsWithConnections(); // Re-render to remove active indicator
    showToast('Session stopped');

    if (terminal) {
      terminal.writeln('\x1b[1;32m✓ Session terminated\x1b[0m');
    }
    updateTerminalStatus('disconnected');
  } else {
    updateSessionButton();
    showToast('Failed to stop session', 'error');
  }
}

function updateSessionButton() {
  const connectBtn = document.getElementById('connectBtn');
  const saveBtn = document.getElementById('saveBtn');

  // Get current connection name from form
  const currentFormConnection = document.getElementById('connectionName').value.trim() || editingConnectionName;

  // Check if viewing the active connection
  const isViewingActiveConnection = isSessionActive && activeConnectionName &&
    (currentFormConnection === activeConnectionName || editingConnectionName === activeConnectionName);

  if (isSessionActive) {
    if (isViewingActiveConnection) {
      // Viewing the active connection - show Stop Session
      connectBtn.textContent = 'Stop Session';
      connectBtn.classList.add('btn-stop');
      connectBtn.classList.remove('btn-disabled-session');
      connectBtn.disabled = false;
      saveBtn.disabled = false;
    } else {
      // Viewing a different connection while session is active
      connectBtn.textContent = `Session active: ${activeConnectionName}`;
      connectBtn.classList.remove('btn-stop');
      connectBtn.classList.add('btn-disabled-session');
      connectBtn.disabled = true;
      saveBtn.disabled = false; // Still allow saving other connections
    }
  } else {
    // No active session
    connectBtn.textContent = 'Start Session';
    connectBtn.classList.remove('btn-stop', 'btn-disabled-session');
    connectBtn.disabled = false;
    saveBtn.disabled = false;
  }
}


async function checkSessionStatus() {
  const result = await window.electronAPI.checkSessionStatus();
  if (result.active) {
    isSessionActive = true;
    updateSessionButton();
    const localPort = document.getElementById('localPort').value || '5601';

    // Show terminal if session is active
    showTerminal({ localPortNumber: localPort });
    updateTerminalStatus('connected');
    if (result.sessionId) {
      document.getElementById('terminalSessionId').textContent = `Session: ${result.sessionId.substring(0, 20)}...`;
    }
  }
}

// Session Timer Functions
function startSessionTimer() {
  sessionStartTime = Date.now();
  updateTimerDisplay();

  // Update timer every second
  timerInterval = setInterval(() => {
    updateTimerDisplay();
  }, 1000);
}

function stopSessionTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  sessionStartTime = null;

  // Reset timer display
  const timerValue = document.getElementById('timerValue');
  const timerContainer = document.getElementById('sessionTimer');
  if (timerValue) timerValue.textContent = '10:00';
  if (timerContainer) {
    timerContainer.classList.remove('warning', 'danger');
  }
}

function updateTimerDisplay() {
  if (!sessionStartTime) return;

  const elapsed = Date.now() - sessionStartTime;
  const remaining = Math.max(0, sessionDuration - elapsed);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  const timerValue = document.getElementById('timerValue');
  const timerContainer = document.getElementById('sessionTimer');

  if (timerValue) {
    timerValue.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // Update timer styling based on remaining time
  if (timerContainer) {
    timerContainer.classList.remove('warning', 'danger');

    if (remaining <= 60000) { // Less than 1 minute
      timerContainer.classList.add('danger');
    } else if (remaining <= 180000) { // Less than 3 minutes
      timerContainer.classList.add('warning');
    }
  }

  // Session expired
  if (remaining <= 0) {
    stopSessionTimer();
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

// Copy Active URL to clipboard
function copyActiveUrl() {
  if (!activeConnectionConfig) {
    showToast('No active session', 'error');
    return;
  }

  const service = activeConnectionConfig.service;
  const port = activeConnectionConfig.localPortNumber;
  const config = serviceConfig[service];

  if (!config || !config.urlTemplate) {
    showToast('Could not generate URL', 'error');
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
  localStorage.setItem('theme', theme);

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
    localStorage.setItem('ssmGroups', JSON.stringify(connectionGroups));
  }

  // Merge connections - update existing, add new
  data.connections.forEach(importedConn => {
    const existingIndex = savedConnections.findIndex(c => c.name === importedConn.name);
    if (existingIndex >= 0) {
      savedConnections[existingIndex] = importedConn;
    } else {
      savedConnections.push(importedConn);
    }
  });

  localStorage.setItem('ssmConnections', JSON.stringify(savedConnections));
  renderGroupsWithConnections();
  updateGroupDropdown();

  // Show success message with any warnings
  if (warnings) {
    showToast(`Imported ${importCount} connections. ${warnings}`, 'info');
  } else {
    showToast(`Imported ${importCount} connections and ${groupCount} groups`, 'success');
  }
}
