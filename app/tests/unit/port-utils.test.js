const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { checkLocalPortAvailability, normalizePortError } = require('../../port-utils');

function withMockedCreateServer(mockFactory, runTest) {
  const originalCreateServer = net.createServer;
  net.createServer = mockFactory;

  return Promise.resolve()
    .then(runTest)
    .finally(() => {
      net.createServer = originalCreateServer;
    });
}

test('normalizePortError returns friendly conflict message', () => {
  const message = normalizePortError('listen EADDRINUSE: address already in use', 5601);
  assert.equal(
    message,
    'Local port 5601 is already in use. Choose a different local port, then try again.'
  );
});

test('checkLocalPortAvailability resolves available=true when listen succeeds', async () => {
  await withMockedCreateServer(
    () => {
      const handlers = new Map();
      return {
        once(event, handler) {
          handlers.set(event, handler);
        },
        listen() {
          queueMicrotask(() => handlers.get('listening')());
        },
        close(callback) {
          callback();
        }
      };
    },
    async () => {
      const result = await checkLocalPortAvailability(5601);
      assert.deepEqual(result, { available: true });
    }
  );
});

test('checkLocalPortAvailability resolves available=false when port is occupied', async () => {
  await withMockedCreateServer(
    () => {
      const handlers = new Map();
      return {
        once(event, handler) {
          handlers.set(event, handler);
        },
        listen() {
          queueMicrotask(() => handlers.get('error')({ message: 'listen EADDRINUSE' }));
        },
        close(callback) {
          callback();
        }
      };
    },
    async () => {
      const result = await checkLocalPortAvailability(5601);
      assert.equal(result.available, false);
      assert.match(result.error, /already in use/i);
    }
  );
});
