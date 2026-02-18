/**
 * SSM Session Handler using AWS SDK v3 and WebSocket
 * Implements the Session Manager protocol for port forwarding
 */

const { SSMClient, StartSessionCommand, TerminateSessionCommand } = require('@aws-sdk/client-ssm');
const { fromIni } = require('@aws-sdk/credential-providers');
const WebSocket = require('ws');
const net = require('net');
const crypto = require('crypto');

// SSM Message Types
const MESSAGE_TYPES = {
  INPUT_STREAM_DATA: 'input_stream_data',
  OUTPUT_STREAM_DATA: 'output_stream_data',
  ACKNOWLEDGE: 'acknowledge',
  CHANNEL_CLOSED: 'channel_closed',
  START_PUBLICATION: 'start_publication',
  PAUSE_PUBLICATION: 'pause_publication'
};

// Payload Types
const PAYLOAD_TYPES = {
  OUTPUT: 1,
  ERROR: 2,
  FLAG: 3,
  HANDSHAKE_REQUEST: 5,
  HANDSHAKE_RESPONSE: 6,
  HANDSHAKE_COMPLETE: 7
};

class SSMSession {
  constructor(config, onOutput, onStatus) {
    this.config = config;
    this.onOutput = onOutput || (() => {});
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.sessionId = null;
    this.streamUrl = null;
    this.tokenValue = null;
    this.sequenceNumber = 0;
    this.localServer = null;
    this.localConnections = new Map();
    this.isConnected = false;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === 'error' ? '✗' : type === 'success' ? '✓' : '→';
    this.onOutput(`[${timestamp}] ${prefix} ${message}\n`);
  }

  async start() {
    try {
      this.onStatus('connecting');
      this.log('Initializing AWS SSM session...');

      // Create SSM client with profile credentials
      const ssmClient = new SSMClient({
        region: this.config.region,
        credentials: fromIni({ profile: this.config.profile })
      });

      this.log(`Using profile: ${this.config.profile}`);
      this.log(`Region: ${this.config.region}`);
      this.log(`Target: ${this.config.target}`);

      // Start session via SDK
      const command = new StartSessionCommand({
        Target: this.config.target,
        DocumentName: 'AWS-StartPortForwardingSessionToRemoteHost',
        Parameters: {
          portNumber: [this.config.portNumber],
          localPortNumber: [this.config.localPortNumber],
          host: [this.config.host]
        }
      });

      this.log('Starting SSM session...');
      const response = await ssmClient.send(command);

      this.sessionId = response.SessionId;
      this.streamUrl = response.StreamUrl;
      this.tokenValue = response.TokenValue;

      this.log(`Session ID: ${this.sessionId}`, 'success');
      this.log(`Stream URL: ${this.streamUrl.substring(0, 50)}...`);

      // Connect to WebSocket
      await this.connectWebSocket();

      // Start local TCP server for port forwarding
      await this.startLocalServer();

      return {
        success: true,
        sessionId: this.sessionId,
        localUrl: `https://localhost:${this.config.localPortNumber}`
      };
    } catch (error) {
      this.log(`Failed to start session: ${error.message}`, 'error');
      this.onStatus('error');
      return { success: false, error: error.message };
    }
  }

  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      this.log('Connecting to WebSocket...');

      this.ws = new WebSocket(this.streamUrl);

      this.ws.on('open', () => {
        this.log('WebSocket connected', 'success');
        this.isConnected = true;

        // Send authentication token
        this.sendOpenDataChannel();
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        this.log(`WebSocket closed: ${code} - ${reason || 'No reason'}`, 'error');
        this.isConnected = false;
        this.onStatus('disconnected');
      });

      this.ws.on('error', (error) => {
        this.log(`WebSocket error: ${error.message}`, 'error');
        reject(error);
      });

      // Timeout for connection
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  sendOpenDataChannel() {
    // Send the token for authentication
    const openDataChannelInput = {
      MessageSchemaVersion: '1.0',
      RequestId: crypto.randomUUID(),
      TokenValue: this.tokenValue,
      ClientId: crypto.randomUUID()
    };

    this.log('Sending authentication token...');
    this.ws.send(JSON.stringify(openDataChannelInput));
  }

  handleMessage(data) {
    try {
      // First, try to parse as JSON (for initial responses)
      if (data.length < 100) {
        try {
          const jsonData = JSON.parse(data.toString());
          if (jsonData.MessageType) {
            this.log(`Received: ${jsonData.MessageType}`);
          }
          return;
        } catch (e) {
          // Not JSON, continue with binary parsing
        }
      }

      // Parse binary SSM message
      const message = this.parseAgentMessage(data);

      if (message) {
        switch (message.messageType) {
          case MESSAGE_TYPES.OUTPUT_STREAM_DATA:
            this.handleOutputData(message);
            break;
          case MESSAGE_TYPES.ACKNOWLEDGE:
            // Acknowledgment received
            break;
          case MESSAGE_TYPES.CHANNEL_CLOSED:
            this.log('Channel closed by server', 'error');
            this.stop();
            break;
          default:
            // this.log(`Message type: ${message.messageType}`);
        }

        // Send acknowledgment
        if (message.messageType !== MESSAGE_TYPES.ACKNOWLEDGE) {
          this.sendAcknowledge(message);
        }
      }
    } catch (error) {
      // Binary data that we couldn't parse - might be port forwarding data
      this.handlePortForwardingData(data);
    }
  }

  parseAgentMessage(data) {
    try {
      const buffer = Buffer.from(data);
      if (buffer.length < 116) return null;

      // SSM Agent Message Header Format:
      // - 4 bytes: Header Length
      // - 16 bytes: Message Type
      // - 4 bytes: Schema Version
      // - 8 bytes: Created Date
      // - 8 bytes: Sequence Number
      // - 8 bytes: Flags
      // - 16 bytes: Message ID
      // - 20 bytes: Payload Digest
      // - 4 bytes: Payload Type
      // - 4 bytes: Payload Length
      // - N bytes: Payload

      let offset = 4; // Skip header length

      // Message Type (16 bytes, null-terminated string)
      const messageTypeEnd = buffer.indexOf(0, offset);
      const messageType = buffer.toString('utf8', offset, messageTypeEnd > offset ? messageTypeEnd : offset + 16).trim();
      offset += 16;

      // Schema Version (4 bytes)
      offset += 4;

      // Created Date (8 bytes)
      offset += 8;

      // Sequence Number (8 bytes)
      const sequenceNumber = buffer.readBigUInt64BE(offset);
      offset += 8;

      // Flags (8 bytes)
      offset += 8;

      // Message ID (16 bytes)
      offset += 16;

      // Payload Digest (20 bytes)
      offset += 20;

      // Payload Type (4 bytes)
      const payloadType = buffer.readUInt32BE(offset);
      offset += 4;

      // Payload Length (4 bytes)
      const payloadLength = buffer.readUInt32BE(offset);
      offset += 4;

      // Payload
      const payload = buffer.slice(offset, offset + payloadLength);

      return {
        messageType,
        sequenceNumber: Number(sequenceNumber),
        payloadType,
        payload
      };
    } catch (error) {
      return null;
    }
  }

  handleOutputData(message) {
    if (message.payload && message.payload.length > 0) {
      const text = message.payload.toString('utf8');
      if (text.includes('Waiting for connections') || text.includes('Port')) {
        this.log(text.trim(), 'success');
        this.onStatus('connected');
      } else if (text.trim().length > 0) {
        this.log(text.trim());
      }
    }
  }

  handlePortForwardingData(data) {
    // Forward data to local connections if any
    for (const [id, socket] of this.localConnections) {
      if (!socket.destroyed) {
        socket.write(data);
      }
    }
  }

  sendAcknowledge(message) {
    try {
      const ackMessage = this.buildAgentMessage(
        MESSAGE_TYPES.ACKNOWLEDGE,
        Buffer.from(JSON.stringify({
          AcknowledgedMessageType: message.messageType,
          AcknowledgedMessageId: '',
          AcknowledgedMessageSequenceNumber: message.sequenceNumber,
          IsSequentialMessage: true
        }))
      );
      this.ws.send(ackMessage);
    } catch (error) {
      // Ignore ack errors
    }
  }

  buildAgentMessage(messageType, payload) {
    // Build SSM agent message format
    const headerLength = 116;
    const messageTypeBuffer = Buffer.alloc(16);
    messageTypeBuffer.write(messageType);

    const schemaVersion = Buffer.alloc(4);
    schemaVersion.writeUInt32BE(1);

    const createdDate = Buffer.alloc(8);
    createdDate.writeBigUInt64BE(BigInt(Date.now()));

    const sequenceNumber = Buffer.alloc(8);
    sequenceNumber.writeBigUInt64BE(BigInt(this.sequenceNumber++));

    const flags = Buffer.alloc(8);
    flags.writeBigUInt64BE(BigInt(0));

    const messageId = crypto.randomBytes(16);

    const payloadDigest = crypto.createHash('sha256').update(payload).digest().slice(0, 20);

    const payloadType = Buffer.alloc(4);
    payloadType.writeUInt32BE(PAYLOAD_TYPES.OUTPUT);

    const payloadLength = Buffer.alloc(4);
    payloadLength.writeUInt32BE(payload.length);

    const headerLengthBuffer = Buffer.alloc(4);
    headerLengthBuffer.writeUInt32BE(headerLength);

    return Buffer.concat([
      headerLengthBuffer,
      messageTypeBuffer,
      schemaVersion,
      createdDate,
      sequenceNumber,
      flags,
      messageId,
      payloadDigest,
      payloadType,
      payloadLength,
      payload
    ]);
  }

  async startLocalServer() {
    return new Promise((resolve, reject) => {
      const localPort = parseInt(this.config.localPortNumber);

      this.localServer = net.createServer((socket) => {
        const connectionId = crypto.randomUUID();
        this.localConnections.set(connectionId, socket);
        this.log(`Local connection established (${connectionId.substring(0, 8)})`);

        socket.on('data', (data) => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Forward data through WebSocket
            const message = this.buildAgentMessage(MESSAGE_TYPES.INPUT_STREAM_DATA, data);
            this.ws.send(message);
          }
        });

        socket.on('close', () => {
          this.localConnections.delete(connectionId);
          this.log(`Local connection closed (${connectionId.substring(0, 8)})`);
        });

        socket.on('error', (error) => {
          this.log(`Local connection error: ${error.message}`, 'error');
          this.localConnections.delete(connectionId);
        });
      });

      this.localServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          this.log(`Port ${localPort} is already in use`, 'error');
          reject(new Error(`Port ${localPort} is already in use`));
        } else {
          reject(error);
        }
      });

      this.localServer.listen(localPort, '127.0.0.1', () => {
        this.log(`Local server listening on port ${localPort}`, 'success');
        this.log(`Connect to: https://localhost:${localPort}`, 'success');
        this.onStatus('connected');
        resolve();
      });
    });
  }

  async stop() {
    this.log('Stopping session...');
    this.onStatus('disconnecting');

    // Close local connections
    for (const [id, socket] of this.localConnections) {
      socket.destroy();
    }
    this.localConnections.clear();

    // Close local server
    if (this.localServer) {
      this.localServer.close();
      this.localServer = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Terminate session via SDK
    if (this.sessionId && this.config.profile && this.config.region) {
      try {
        const ssmClient = new SSMClient({
          region: this.config.region,
          credentials: fromIni({ profile: this.config.profile })
        });

        await ssmClient.send(new TerminateSessionCommand({
          SessionId: this.sessionId
        }));

        this.log('Session terminated', 'success');
      } catch (error) {
        this.log(`Failed to terminate session: ${error.message}`, 'error');
      }
    }

    this.isConnected = false;
    this.onStatus('disconnected');
    return { success: true };
  }

  getStatus() {
    return {
      connected: this.isConnected,
      sessionId: this.sessionId,
      localPort: this.config.localPortNumber
    };
  }
}

module.exports = { SSMSession };
