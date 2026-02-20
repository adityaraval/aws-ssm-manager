const fs = require('fs');
const path = require('path');

const DEFAULT_PATH_SEGMENTS = process.platform === 'win32'
  ? [
    'C:\\Windows\\System32',
    'C:\\Windows'
  ]
  : [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    '/usr/local/sessionmanagerplugin/bin'
  ];

function buildCommandPath(currentPath = process.env.PATH || '') {
  const entries = [];
  const seen = new Set();

  [...currentPath.split(path.delimiter), ...DEFAULT_PATH_SEGMENTS]
    .map(entry => (entry || '').trim())
    .filter(Boolean)
    .forEach(entry => {
      if (!seen.has(entry)) {
        seen.add(entry);
        entries.push(entry);
      }
    });

  return entries.join(path.delimiter);
}

function isExecutable(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getWindowsExtensions() {
  const extValue = process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM';
  return extValue
    .split(';')
    .map(ext => ext.trim().toLowerCase())
    .filter(Boolean);
}

function resolveExecutable(command, { envPath, extraCandidates = [] } = {}) {
  if (!command) return null;

  const hasPath = command.includes('/') || command.includes('\\');
  if (hasPath) {
    return isExecutable(command) ? command : null;
  }

  const lookupPath = envPath || buildCommandPath();
  const pathEntries = lookupPath.split(path.delimiter).filter(Boolean);
  const candidates = [...extraCandidates];

  if (process.platform === 'win32') {
    const exts = getWindowsExtensions();
    const hasExt = !!path.extname(command);

    pathEntries.forEach(dir => {
      if (hasExt) {
        candidates.push(path.join(dir, command));
      } else {
        exts.forEach(ext => candidates.push(path.join(dir, `${command}${ext}`)));
      }
    });
  } else {
    pathEntries.forEach(dir => candidates.push(path.join(dir, command)));
  }

  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

module.exports = {
  buildCommandPath,
  resolveExecutable
};
