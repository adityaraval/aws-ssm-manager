const { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SSMSession } = require('./ssm-session');

let mainWindow;
let currentSession = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 950,
    maximizable: false,
    resizable: true,
    minWidth: 800,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Set Content Security Policy headers
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; " +
          "font-src 'self'; " +
          "connect-src 'self'"
        ],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block']
      }
    });
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  if (currentSession) {
    await currentSession.stop();
    currentSession = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('get-profiles', async () => {
  const configPath = path.join(os.homedir(), '.aws', 'config');
  const credentialsPath = path.join(os.homedir(), '.aws', 'credentials');

  const profiles = new Set();

  try {
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const matches = configContent.matchAll(/\[(?:profile )?([^\]]+)\]/g);
      for (const match of matches) {
        profiles.add(match[1]);
      }
    }

    if (fs.existsSync(credentialsPath)) {
      const credContent = fs.readFileSync(credentialsPath, 'utf-8');
      const matches = credContent.matchAll(/\[([^\]]+)\]/g);
      for (const match of matches) {
        profiles.add(match[1]);
      }
    }
  } catch (error) {
    return { success: false, error: error.message };
  }

  return { success: true, profiles: Array.from(profiles) };
});

// Note: AWS profile configuration is done via ~/.aws/config and ~/.aws/credentials
// This app reads existing profiles but doesn't configure new ones (use AWS CLI for that)

ipcMain.handle('start-ssm-session', async (event, config) => {
  if (currentSession) {
    return { success: false, error: 'A session is already active' };
  }

  const { target, portNumber, localPortNumber, host, region, profile } = config;

  // Callback to send terminal output to renderer
  const onOutput = (text) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-output', text);
    }
  };

  // Callback for session status changes
  const onStatus = (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-status', status);
      if (status === 'disconnected') {
        mainWindow.webContents.send('session-closed', { code: 0 });
      }
    }
  };

  // Create SSM session using SDK
  currentSession = new SSMSession({
    target,
    portNumber,
    localPortNumber,
    host,
    region,
    profile
  }, onOutput, onStatus);

  const result = await currentSession.start();

  if (!result.success) {
    currentSession = null;
  }

  return result;
});

ipcMain.handle('stop-ssm-session', async () => {
  if (currentSession) {
    await currentSession.stop();
    currentSession = null;
    return { success: true };
  }
  return { success: false, error: 'No active session' };
});

ipcMain.handle('check-session-status', async () => {
  if (currentSession) {
    const status = currentSession.getStatus();
    return { active: status.connected, sessionId: status.sessionId };
  }
  return { active: false };
});

// Dark Mode handlers
ipcMain.handle('dark-mode:toggle', () => {
  if (nativeTheme.shouldUseDarkColors) {
    nativeTheme.themeSource = 'light';
  } else {
    nativeTheme.themeSource = 'dark';
  }
  return nativeTheme.shouldUseDarkColors;
});

ipcMain.handle('dark-mode:set', (event, mode) => {
  nativeTheme.themeSource = mode;
  return nativeTheme.shouldUseDarkColors;
});

ipcMain.handle('dark-mode:get', () => {
  return nativeTheme.shouldUseDarkColors;
});

// Export connections to JSON file
ipcMain.handle('export-connections', async (event, data) => {
  try {
    // Show security warning before export
    const warningResult = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Export Anyway', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Security Notice',
      message: 'Export Security Warning',
      detail: 'The exported file will contain unencrypted connection details including:\n\n' +
        '• AWS profile names\n' +
        '• AWS regions\n' +
        '• Instance IDs\n' +
        '• Service hostnames\n\n' +
        'Please store this file securely and do not share it publicly.'
    });

    if (warningResult.response === 1) {
      return { success: false, canceled: true };
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Connections',
      defaultPath: `ssm-connections-${new Date().toISOString().split('T')[0]}.json`,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Validation patterns for imported data
const importValidators = {
  instanceId: /^i-[0-9a-f]{8}([0-9a-f]{9})?$/,
  region: /^[a-z]{2}-[a-z]+-\d$/,
  port: (val) => {
    const num = parseInt(val, 10);
    return !isNaN(num) && num >= 1 && num <= 65535;
  },
  profile: /^[a-zA-Z0-9._-]{1,64}$/,
  hostname: /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/,
  service: /^(opensearch|aurora|elasticache|rabbitmq)$/,
  color: /^#[0-9a-fA-F]{6}$/,
  name: /^.{1,100}$/,  // Allow any characters but limit length
  groupId: /^[0-9]+$/
};

// Sanitize a connection object
function sanitizeConnection(conn) {
  const sanitized = {};

  // Required fields with validation
  if (typeof conn.name === 'string' && importValidators.name.test(conn.name)) {
    sanitized.name = conn.name.substring(0, 100);
  } else {
    return null; // Invalid connection
  }

  if (typeof conn.target === 'string' && importValidators.instanceId.test(conn.target)) {
    sanitized.target = conn.target;
  } else {
    return null;
  }

  if (typeof conn.region === 'string' && importValidators.region.test(conn.region)) {
    sanitized.region = conn.region;
  } else {
    return null;
  }

  if (typeof conn.profile === 'string' && importValidators.profile.test(conn.profile)) {
    sanitized.profile = conn.profile;
  } else {
    return null;
  }

  if (typeof conn.host === 'string' && importValidators.hostname.test(conn.host)) {
    sanitized.host = conn.host;
  } else {
    return null;
  }

  if (typeof conn.service === 'string' && importValidators.service.test(conn.service)) {
    sanitized.service = conn.service;
  } else {
    return null;
  }

  // Port numbers
  if (importValidators.port(conn.portNumber)) {
    sanitized.portNumber = String(parseInt(conn.portNumber, 10));
  } else {
    return null;
  }

  if (importValidators.port(conn.localPortNumber)) {
    sanitized.localPortNumber = String(parseInt(conn.localPortNumber, 10));
  } else {
    return null;
  }

  // Optional groupId
  if (conn.groupId && typeof conn.groupId === 'string' && importValidators.groupId.test(conn.groupId)) {
    sanitized.groupId = conn.groupId;
  } else {
    sanitized.groupId = null;
  }

  // Optional sortOrder
  if (conn.sortOrder != null && typeof conn.sortOrder === 'number' && Number.isFinite(conn.sortOrder) && conn.sortOrder >= 0) {
    sanitized.sortOrder = Math.floor(conn.sortOrder);
  } else {
    sanitized.sortOrder = 0;
  }

  // Optional lastUsedAt
  if (conn.lastUsedAt != null && typeof conn.lastUsedAt === 'number' && Number.isFinite(conn.lastUsedAt) && conn.lastUsedAt >= 0) {
    sanitized.lastUsedAt = Math.floor(conn.lastUsedAt);
  } else {
    sanitized.lastUsedAt = 0;
  }

  return sanitized;
}

// Sanitize a group object
function sanitizeGroup(group) {
  if (!group || typeof group !== 'object') return null;

  const sanitized = {};

  if (typeof group.id === 'string' && importValidators.groupId.test(group.id)) {
    sanitized.id = group.id;
  } else {
    return null;
  }

  if (typeof group.name === 'string' && group.name.length > 0 && group.name.length <= 50) {
    sanitized.name = group.name.substring(0, 50);
  } else {
    return null;
  }

  if (typeof group.color === 'string' && importValidators.color.test(group.color)) {
    sanitized.color = group.color;
  } else {
    sanitized.color = '#888888'; // Default color
  }

  return sanitized;
}

// Import connections from JSON file
ipcMain.handle('import-connections', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Connections',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    // Limit file size to 1MB to prevent DoS
    const stats = fs.statSync(result.filePaths[0]);
    if (stats.size > 1024 * 1024) {
      return { success: false, error: 'File too large (max 1MB)' };
    }

    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const data = JSON.parse(content);

    // Validate structure
    if (!data.connections || !Array.isArray(data.connections)) {
      return { success: false, error: 'Invalid file format: missing connections array' };
    }

    // Limit number of connections
    if (data.connections.length > 500) {
      return { success: false, error: 'Too many connections (max 500)' };
    }

    // Sanitize and validate all connections
    const sanitizedConnections = [];
    const invalidCount = { connections: 0, groups: 0 };

    for (const conn of data.connections) {
      const sanitized = sanitizeConnection(conn);
      if (sanitized) {
        sanitizedConnections.push(sanitized);
      } else {
        invalidCount.connections++;
      }
    }

    // Sanitize groups if present
    const sanitizedGroups = [];
    if (data.groups && Array.isArray(data.groups)) {
      for (const group of data.groups.slice(0, 50)) { // Limit to 50 groups
        const sanitized = sanitizeGroup(group);
        if (sanitized) {
          sanitizedGroups.push(sanitized);
        } else {
          invalidCount.groups++;
        }
      }
    }

    if (sanitizedConnections.length === 0) {
      return { success: false, error: 'No valid connections found in file' };
    }

    // Return sanitized data
    return {
      success: true,
      data: {
        connections: sanitizedConnections,
        groups: sanitizedGroups
      },
      warnings: invalidCount.connections > 0 || invalidCount.groups > 0
        ? `Skipped ${invalidCount.connections} invalid connections and ${invalidCount.groups} invalid groups`
        : null
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check prerequisites for onboarding
ipcMain.handle('check-prerequisites', async () => {
  const result = {
    awsCli: { installed: false, version: '' },
    ssmPlugin: { installed: false },
    credentials: { configured: false, profileCount: 0 }
  };

  // Check AWS CLI
  try {
    const awsVersion = await new Promise((resolve, reject) => {
      execFile('aws', ['--version'], { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve((stdout || stderr || '').trim());
      });
    });
    result.awsCli.installed = true;
    result.awsCli.version = awsVersion;
  } catch {
    result.awsCli.installed = false;
  }

  // Check SSM Plugin
  try {
    await new Promise((resolve, reject) => {
      execFile('session-manager-plugin', ['--version'], { timeout: 5000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve((stdout || '').trim());
      });
    });
    result.ssmPlugin.installed = true;
  } catch {
    result.ssmPlugin.installed = false;
  }

  // Check AWS credentials
  try {
    const configPath = path.join(os.homedir(), '.aws', 'config');
    const credentialsPath = path.join(os.homedir(), '.aws', 'credentials');
    const profiles = new Set();

    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const matches = content.matchAll(/\[(?:profile )?([^\]]+)\]/g);
      for (const m of matches) profiles.add(m[1]);
    }
    if (fs.existsSync(credentialsPath)) {
      const content = fs.readFileSync(credentialsPath, 'utf-8');
      const matches = content.matchAll(/\[([^\]]+)\]/g);
      for (const m of matches) profiles.add(m[1]);
    }

    result.credentials.profileCount = profiles.size;
    result.credentials.configured = profiles.size > 0;
  } catch {
    result.credentials.configured = false;
  }

  return result;
});

// Open external URLs (restricted to AWS docs)
ipcMain.handle('open-external', async (event, url) => {
  if (typeof url === 'string' && url.startsWith('https://docs.aws.amazon.com/')) {
    await shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'URL not allowed' };
});
