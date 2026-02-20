const net = require('net');

function normalizePortError(errorMessage, localPortNumber) {
  const message = String(errorMessage || '');
  const lowered = message.toLowerCase();

  if (
    lowered.includes('eaddrinuse') ||
    lowered.includes('address already in use') ||
    (lowered.includes('port') && lowered.includes('already in use'))
  ) {
    return `Local port ${localPortNumber} is already in use. Choose a different local port, then try again.`;
  }

  if (lowered.includes('eacces') || lowered.includes('permission denied')) {
    return `Local port ${localPortNumber} requires elevated permissions. Choose a port above 1024 or run with appropriate privileges.`;
  }

  return message || 'Failed to start SSM session';
}

function checkLocalPortAvailability(localPortNumber) {
  const parsedPort = Number.parseInt(localPortNumber, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return Promise.resolve({
      available: false,
      error: 'Invalid local port (must be between 1 and 65535)'
    });
  }

  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (error) => {
      resolve({
        available: false,
        error: normalizePortError(error.message, parsedPort)
      });
    });

    server.once('listening', () => {
      server.close(() => {
        resolve({ available: true });
      });
    });

    server.listen({ host: '127.0.0.1', port: parsedPort, exclusive: true });
  });
}

module.exports = {
  checkLocalPortAvailability,
  normalizePortError
};
