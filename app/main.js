const { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell } = require('electron');
const { promisify } = require('util');
const { execFile } = require('child_process');
const execFileAsync = promisify(execFile);
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SSMSession } = require('./ssm-session');
const { checkLocalPortAvailability, normalizePortError } = require('./port-utils');
const { buildCommandPath, resolveExecutable } = require('./executable-utils');

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

let mainWindow;
const sessions = new Map(); // key: connection.id, value: SSMSession instance

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
  if (sessions.size > 0) {
    await Promise.all([...sessions.values()].map(s => s.stop()));
    sessions.clear();
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

const isE2ETest = process.env.E2E_TEST === '1';

if (isE2ETest) {
  // --- Mock IPC handlers for E2E testing ---
  const mockSessions = new Map(); // key: config.id, value: { sessionId }

  ipcMain.handle('get-platform', () => process.env.MOCK_PLATFORM || 'win32');

  ipcMain.handle('get-profiles', async (event, { wslMode } = {}) => {
    const profiles = wslMode ? ['wsl-default', 'wsl-dev'] : ['dev', 'staging', 'prod'];
    return { success: true, profiles };
  });

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

  ipcMain.handle('check-prerequisites', async (event, { wslMode } = {}) => {
    return {
      awsCli: { installed: true, version: wslMode ? 'aws-cli/2.x.x (wsl)' : 'aws-cli/2.0.0 Python/3.9.0 Darwin/21.0.0 source/x86_64' },
      ssmPlugin: { installed: true },
      credentials: { configured: true, profileCount: wslMode ? 2 : 3 }
    };
  });

  ipcMain.handle('export-connections', async (event, data) => {
    // Write to a temp file without showing a dialog
    const tmpPath = path.join(os.tmpdir(), 'ssm-e2e-export.json');
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true, filePath: tmpPath };
  });

  ipcMain.handle('import-connections', async () => {
    // Read from the temp export file if it exists, otherwise return test data
    const tmpPath = path.join(os.tmpdir(), 'ssm-e2e-import.json');
    if (fs.existsSync(tmpPath)) {
      const content = fs.readFileSync(tmpPath, 'utf-8');
      const data = JSON.parse(content);
      return { success: true, data: { connections: data.connections || [], groups: data.groups || [] }, warnings: null };
    }
    return {
      success: true,
      data: {
        connections: [{
          name: 'Imported Connection',
          service: 'opensearch',
          target: 'i-0abc123def4567890',
          host: 'imported.us-east-1.es.amazonaws.com',
          region: 'us-east-1',
          profile: 'dev',
          portNumber: '443',
          localPortNumber: '5601',
          groupId: null,
          sortOrder: 0,
          lastUsedAt: 0,
          notes: '',
          favorite: false
        }],
        groups: []
      },
      warnings: null
    };
  });

  ipcMain.handle('open-url', async () => {
    return { success: true };
  });

  ipcMain.handle('open-external', async () => {
    return { success: true };
  });

  ipcMain.handle('check-wsl-available', async () => {
    return { available: process.env.MOCK_WSL_UNAVAILABLE !== '1' };
  });

  // Dark mode handlers still work normally in test mode
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

} else {
  // --- Real IPC handlers (production) ---

ipcMain.handle('get-platform', () => process.platform);

ipcMain.handle('get-profiles', async (event, { wslMode } = {}) => {
  if (wslMode && process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('wsl.exe', [
        '--', 'sh', '-c',
        'cat ~/.aws/config 2>/dev/null; echo ""; cat ~/.aws/credentials 2>/dev/null'
      ]);
      return { success: true, profiles: parseProfiles(stdout) };
    } catch {
      return { success: true, profiles: [] };
    }
  }

  const configPath = path.join(os.homedir(), '.aws', 'config');
  const credentialsPath = path.join(os.homedir(), '.aws', 'credentials');
  let combined = '';
  try { combined += fs.readFileSync(configPath, 'utf-8'); } catch { /* file may not exist */ }
  try { combined += '\n' + fs.readFileSync(credentialsPath, 'utf-8'); } catch { /* file may not exist */ }
  return { success: true, profiles: parseProfiles(combined) };
});

// Note: AWS profile configuration is done via ~/.aws/config and ~/.aws/credentials
// This app reads existing profiles but doesn't configure new ones (use AWS CLI for that)

ipcMain.handle('start-ssm-session', async (event, config) => {
  if (sessions.size >= 5) {
    return { success: false, error: 'Maximum sessions reached' };
  }
  if (sessions.has(config.id)) {
    return { success: false, error: 'Session already active for this connection' };
  }

  const { target, portNumber, localPortNumber, host, region, profile, sessionTimeoutMinutes, wslMode } = config;
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

  const session = new SSMSession({
    target,
    portNumber,
    localPortNumber,
    host,
    region,
    profile,
    sessionTimeout,
    wslMode
  }, onOutput, onStatus);
  sessions.set(config.id, session);

  const result = await session.start();

  if (!result.success) {
    result.error = normalizePortError(result.error, localPortNumber);
    sessions.delete(config.id);
  }

  return result;
});

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

ipcMain.handle('check-session-status', async () => {
  const list = [...sessions.entries()].map(([id, s]) => {
    const status = s.getStatus();
    return { id, sessionId: status.sessionId, state: status.connected ? 'connected' : 'connecting' };
  });
  return { sessions: list };
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
  service: /^(opensearch|aurora|elasticache|rabbitmq|custom)$/,
  color: /^#[0-9a-fA-F]{6}$/,
  name: /^.{1,100}$/,  // Allow any characters but limit length
  groupId: /^[0-9]+$/,
  connectionId: /^conn-[0-9]+-[a-z0-9]{1,15}$/
};

// Sanitize a connection object
function sanitizeConnection(conn) {
  const sanitized = {};

  // Optional connection id (unique identifier)
  if (typeof conn.id === 'string' && importValidators.connectionId.test(conn.id)) {
    sanitized.id = conn.id;
  } else {
    sanitized.id = null; // Will be assigned on import merge
  }

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

  // Custom service name (required when service === 'custom')
  if (conn.service === 'custom') {
    if (typeof conn.customServiceName === 'string' && conn.customServiceName.length > 0 && conn.customServiceName.length <= 50) {
      sanitized.customServiceName = conn.customServiceName.substring(0, 50);
    } else {
      return null; // custom service requires a name
    }
  } else {
    sanitized.customServiceName = '';
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

  // Optional notes
  if (typeof conn.notes === 'string' && conn.notes.length > 0) {
    sanitized.notes = conn.notes.substring(0, 500);
  } else {
    sanitized.notes = '';
  }

  // Optional favorite
  if (typeof conn.favorite === 'boolean') {
    sanitized.favorite = conn.favorite;
  } else {
    sanitized.favorite = false;
  }

  // Optional session timeout (minutes), allow 5/10/15/30 or null (no timeout)
  if (conn.sessionTimeoutMinutes === null) {
    sanitized.sessionTimeoutMinutes = null;
  } else {
    const timeoutMinutes = parseInt(conn.sessionTimeoutMinutes, 10);
    if ([5, 10, 15, 30].includes(timeoutMinutes)) {
      sanitized.sessionTimeoutMinutes = timeoutMinutes;
    } else {
      sanitized.sessionTimeoutMinutes = 10;
    }
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
ipcMain.handle('check-prerequisites', async (event, { wslMode } = {}) => {
  const result = {
    awsCli: { installed: false, version: '' },
    ssmPlugin: { installed: false },
    credentials: { configured: false, profileCount: 0 }
  };

  if (wslMode && process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('wsl.exe', ['--', 'aws', '--version']);
      result.awsCli.installed = true;
      result.awsCli.version = stdout.trim();
    } catch { result.awsCli.installed = false; }

    try {
      await execFileAsync('wsl.exe', ['--', 'session-manager-plugin', '--version']);
      result.ssmPlugin.installed = true;
    } catch { result.ssmPlugin.installed = false; }

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

  const commandPath = buildCommandPath(process.env.PATH);
  const commandEnv = { ...process.env, PATH: commandPath };

  // Check AWS CLI
  try {
    const awsExecutable = resolveExecutable('aws', {
      envPath: commandPath,
      extraCandidates: ['/opt/homebrew/bin/aws', '/usr/local/bin/aws', '/usr/bin/aws']
    });
    if (!awsExecutable) {
      throw new Error('aws executable not found');
    }

    const awsVersion = await new Promise((resolve, reject) => {
      execFile(awsExecutable, ['--version'], { timeout: 5000, env: commandEnv }, (err, stdout, stderr) => {
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
    const pluginExecutable = resolveExecutable('session-manager-plugin', {
      envPath: commandPath,
      extraCandidates: [
        '/usr/local/sessionmanagerplugin/bin/session-manager-plugin',
        '/opt/homebrew/bin/session-manager-plugin',
        '/usr/local/bin/session-manager-plugin',
        '/usr/bin/session-manager-plugin'
      ]
    });
    if (!pluginExecutable) {
      throw new Error('session-manager-plugin executable not found');
    }

    await new Promise((resolve, reject) => {
      execFile(pluginExecutable, ['--version'], { timeout: 5000, env: commandEnv }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve((stdout || stderr || '').trim());
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

ipcMain.handle('check-wsl-available', async () => {
  if (process.platform !== 'win32') {
    return { available: false };
  }
  try {
    await execFileAsync('wsl.exe', ['--', 'sh', '-c', 'exit 0'], { timeout: 10000 });
    return { available: true };
  } catch {
    return { available: false };
  }
});

// Open connection URL in default browser (restricted to localhost)
ipcMain.handle('open-url', async (event, url) => {
  if (typeof url !== 'string') {
    return { success: false, error: 'Invalid URL' };
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'localhost') {
      return { success: false, error: 'Only localhost URLs are allowed' };
    }
    const allowedProtocols = ['http:', 'https:', 'redis:', 'postgresql:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
      return { success: false, error: 'Protocol not allowed' };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch {
    return { success: false, error: 'Invalid URL format' };
  }
});

// Open external URLs (restricted to AWS docs)
ipcMain.handle('open-external', async (event, url) => {
  if (typeof url === 'string' && url.startsWith('https://docs.aws.amazon.com/')) {
    await shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'URL not allowed' };
});

} // end else (production handlers)
