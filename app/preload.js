const { contextBridge, ipcRenderer } = require('electron');

// Expose Electron APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  startSSMSession: (config) => ipcRenderer.invoke('start-ssm-session', config),
  stopSSMSession: () => ipcRenderer.invoke('stop-ssm-session'),
  checkSessionStatus: () => ipcRenderer.invoke('check-session-status'),
  exportConnections: (data) => ipcRenderer.invoke('export-connections', data),
  importConnections: () => ipcRenderer.invoke('import-connections'),
  onSessionClosed: (callback) => ipcRenderer.on('session-closed', callback),
  onTerminalOutput: (callback) => ipcRenderer.on('terminal-output', (event, text) => callback(text)),
  onSessionStatus: (callback) => ipcRenderer.on('session-status', (event, status) => callback(status)),
  removeTerminalListeners: () => {
    ipcRenderer.removeAllListeners('terminal-output');
    ipcRenderer.removeAllListeners('session-status');
  },
  checkPrerequisites: () => ipcRenderer.invoke('check-prerequisites'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});

// Expose dark mode APIs
contextBridge.exposeInMainWorld('darkMode', {
  toggle: () => ipcRenderer.invoke('dark-mode:toggle'),
  set: (mode) => ipcRenderer.invoke('dark-mode:set', mode),
  get: () => ipcRenderer.invoke('dark-mode:get')
});
