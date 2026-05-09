const { contextBridge, ipcRenderer } = require('electron');

// Expose Electron APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  getProfiles: ({ wslMode } = {}) => ipcRenderer.invoke('get-profiles', { wslMode }),
  startSSMSession: (config) => ipcRenderer.invoke('start-ssm-session', config),
  stopSSMSession: (id) => ipcRenderer.invoke('stop-ssm-session', { id }),
  checkSessionStatus: () => ipcRenderer.invoke('check-session-status'),
  exportConnections: (data) => ipcRenderer.invoke('export-connections', data),
  importConnections: () => ipcRenderer.invoke('import-connections'),
  onSessionClosed: (callback) => ipcRenderer.on('session-closed', (event, { id }) => callback(id)),
  onTerminalOutput: (callback) => ipcRenderer.on('terminal-output', (event, { id, text }) => callback(id, text)),
  onSessionStatus: (callback) => ipcRenderer.on('session-status', (event, { id, status }) => callback(id, status)),
  checkPrerequisites: ({ wslMode } = {}) => ipcRenderer.invoke('check-prerequisites', { wslMode }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
});

// Expose dark mode APIs
contextBridge.exposeInMainWorld('darkMode', {
  toggle: () => ipcRenderer.invoke('dark-mode:toggle'),
  set: (mode) => ipcRenderer.invoke('dark-mode:set', mode),
  get: () => ipcRenderer.invoke('dark-mode:get')
});
