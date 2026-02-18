const { app, BrowserWindow, ipcMain, nativeTheme, dialog } = require('electron');
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

    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const data = JSON.parse(content);

    // Validate structure
    if (!data.connections || !Array.isArray(data.connections)) {
      return { success: false, error: 'Invalid file format: missing connections array' };
    }

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
