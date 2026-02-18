/**
 * SSM Session Handler using AWS CLI
 * Simple and reliable port forwarding using 'aws ssm start-session'
 */

const { spawn } = require('child_process');

// Default session timeout: 10 minutes
const DEFAULT_SESSION_TIMEOUT = 10 * 60 * 1000;

// Input validation functions
const validators = {
  // AWS instance ID: i- followed by 8 or 17 hex characters
  instanceId: (id) => /^i-[0-9a-f]{8}([0-9a-f]{9})?$/.test(id),

  // AWS region: e.g., us-east-1, eu-west-2, ap-southeast-1
  region: (region) => /^[a-z]{2}-[a-z]+-\d$/.test(region),

  // Port number: 1-65535
  port: (port) => {
    const num = parseInt(port, 10);
    return !isNaN(num) && num >= 1 && num <= 65535;
  },

  // AWS profile name: alphanumeric, dots, hyphens, underscores
  profile: (profile) => /^[a-zA-Z0-9._-]+$/.test(profile) && profile.length <= 64,

  // Hostname: valid DNS name or IP address
  hostname: (host) => {
    // Allow valid hostnames and IP addresses
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    return hostnameRegex.test(host) || ipRegex.test(host);
  }
};

class SSMSession {
  constructor(config, onOutput, onStatus) {
    this.config = config;
    this.onOutput = onOutput || (() => { });
    this.onStatus = onStatus || (() => { });
    this.process = null;
    this.isConnected = false;
    this.sessionTimeout = null;
    this.sessionDuration = config.sessionTimeout || DEFAULT_SESSION_TIMEOUT;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === 'error' ? '✗' : type === 'success' ? '✓' : '→';
    this.onOutput(`[${timestamp}] ${prefix} ${message}\n`);
  }

  async start() {
    try {
      this.onStatus('connecting');

      // Validate all inputs before proceeding
      const validationErrors = [];

      if (!validators.instanceId(this.config.target)) {
        validationErrors.push(`Invalid instance ID format: ${this.config.target}`);
      }
      if (!validators.region(this.config.region)) {
        validationErrors.push(`Invalid region format: ${this.config.region}`);
      }
      if (!validators.port(this.config.portNumber)) {
        validationErrors.push(`Invalid remote port: ${this.config.portNumber}`);
      }
      if (!validators.port(this.config.localPortNumber)) {
        validationErrors.push(`Invalid local port: ${this.config.localPortNumber}`);
      }
      if (!validators.profile(this.config.profile)) {
        validationErrors.push(`Invalid profile name: ${this.config.profile}`);
      }
      if (!validators.hostname(this.config.host)) {
        validationErrors.push(`Invalid hostname: ${this.config.host}`);
      }

      if (validationErrors.length > 0) {
        const errorMsg = validationErrors.join('; ');
        this.log(`Validation failed: ${errorMsg}`, 'error');
        this.onStatus('error');
        return { success: false, error: errorMsg };
      }

      this.log('Starting AWS SSM port forwarding session...');
      this.log(`Profile: ${this.config.profile}`);
      this.log(`Region: ${this.config.region}`);
      this.log(`Target: ${this.config.target}`);
      this.log(`Host: ${this.config.host}`);
      this.log(`Port: ${this.config.portNumber} → localhost:${this.config.localPortNumber}`);
      this.log(`Session timeout: ${this.sessionDuration / 60000} minutes`);

      // Build AWS CLI arguments
      const args = [
        'ssm', 'start-session',
        '--target', this.config.target,
        '--document-name', 'AWS-StartPortForwardingSessionToRemoteHost',
        '--parameters', `host=${this.config.host},portNumber=${this.config.portNumber},localPortNumber=${this.config.localPortNumber}`,
        '--region', this.config.region,
        '--profile', this.config.profile
      ];

      this.log('Executing: aws ' + args.join(' '));

      // Spawn AWS CLI process with its own process group (for clean termination)
      // Only pass necessary environment variables to avoid leaking sensitive data
      const safeEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        USERPROFILE: process.env.USERPROFILE, // Windows
        HOMEDRIVE: process.env.HOMEDRIVE,     // Windows
        HOMEPATH: process.env.HOMEPATH,       // Windows
        SystemRoot: process.env.SystemRoot,   // Windows
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        AWS_PROFILE: this.config.profile,
        AWS_REGION: this.config.region,
        // Required for AWS CLI plugin
        AWS_SSM_PLUGIN_PATH: process.env.AWS_SSM_PLUGIN_PATH,
      };

      // Remove undefined values
      Object.keys(safeEnv).forEach(key => {
        if (safeEnv[key] === undefined) {
          delete safeEnv[key];
        }
      });

      this.process = spawn('aws', args, {
        detached: process.platform !== 'win32', // Create new process group (Unix only)
        env: safeEnv
      });

      // Handle stdout
      this.process.stdout.on('data', (data) => {
        const output = data.toString();
        output.split('\n').filter(line => line.trim()).forEach(line => {
          this.handleOutput(line.trim());
        });
      });

      // Handle stderr
      this.process.stderr.on('data', (data) => {
        const error = data.toString().trim();
        if (error) {
          this.log(error, 'error');
        }
      });

      // Handle process close
      this.process.on('close', (code) => {
        this.clearSessionTimeout();
        this.isConnected = false;
        this.onStatus('disconnected');

        if (code === 0) {
          this.log('Session ended normally', 'info');
        } else if (code === null) {
          this.log('Session terminated', 'info');
        } else {
          this.log(`Session ended with code: ${code}`, 'error');
        }
      });

      this.process.on('error', (error) => {
        this.log(`Failed to start session: ${error.message}`, 'error');
        this.onStatus('error');
      });

      // Set session timeout
      this.startSessionTimeout();

      // Wait a bit for the session to initialize
      await this.waitForConnection();

      return {
        success: true,
        sessionId: `ssm-${Date.now()}`,
        localUrl: `https://localhost:${this.config.localPortNumber}`
      };

    } catch (error) {
      this.log(`Failed to start session: ${error.message}`, 'error');
      this.onStatus('error');
      return { success: false, error: error.message };
    }
  }

  handleOutput(line) {
    // Detect connection states from AWS CLI output
    if (line.includes('Starting session with SessionId')) {
      const sessionId = line.split('SessionId:')[1]?.trim() || 'unknown';
      this.log(`Session started: ${sessionId}`, 'success');
    } else if (line.includes('Port') && line.includes('opened')) {
      this.log(line, 'success');
      this.isConnected = true;
      this.onStatus('connected');
    } else if (line.includes('Waiting for connections')) {
      this.log('Ready! Waiting for connections...', 'success');
      this.isConnected = true;
      this.onStatus('connected');
    } else if (line.includes('Connection accepted')) {
      this.log('Connection accepted from client', 'success');
    } else if (line.includes('error') || line.includes('Error') || line.includes('ERROR')) {
      this.log(line, 'error');
    } else if (line.includes('Exiting session')) {
      this.log('Session exiting...', 'info');
    } else {
      this.log(line);
    }
  }

  waitForConnection() {
    return new Promise((resolve) => {
      // Resolve after a short delay - the session is starting
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          resolve();
        }
      }, 2000);
    });
  }

  startSessionTimeout() {
    this.clearSessionTimeout();

    const timeoutMinutes = this.sessionDuration / 60000;
    this.log(`Session will auto-close in ${timeoutMinutes} minutes`, 'info');

    this.sessionTimeout = setTimeout(() => {
      this.log('Session timeout reached. Closing session...', 'info');
      this.stop();
    }, this.sessionDuration);
  }

  clearSessionTimeout() {
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
  }

  async stop() {
    this.log('Stopping session...');
    this.onStatus('disconnecting');
    this.clearSessionTimeout();

    if (this.process) {
      const pid = this.process.pid;
      this.log(`Killing process ${pid}...`);

      try {
        // Kill the entire process tree (AWS CLI spawns child processes)
        if (process.platform === 'win32') {
          // Windows: use taskkill with spawnSync to avoid command injection
          const { spawnSync } = require('child_process');
          try {
            // Validate PID is a positive integer to prevent injection
            const safePid = parseInt(pid, 10);
            if (!Number.isInteger(safePid) || safePid <= 0) {
              throw new Error('Invalid PID');
            }
            spawnSync('taskkill', ['/pid', String(safePid), '/T', '/F'], { stdio: 'ignore' });
          } catch (e) {
            // Process might already be dead
          }
        } else {
          // macOS/Linux: kill process group
          try {
            process.kill(-pid, 'SIGTERM');
          } catch (e) {
            // Try killing just the process if group kill fails
            try {
              this.process.kill('SIGTERM');
            } catch (e2) {
              // Process might already be dead
            }
          }

          // Force kill after 1 second if still running
          setTimeout(() => {
            try {
              process.kill(-pid, 'SIGKILL');
            } catch (e) {
              // Already dead
            }
          }, 1000);
        }

        this.log('Session process terminated', 'success');
      } catch (error) {
        this.log(`Error stopping process: ${error.message}`, 'error');
      }

      this.process = null;
    }

    this.isConnected = false;
    this.onStatus('disconnected');
    return { success: true };
  }

  getStatus() {
    return {
      connected: this.isConnected,
      sessionId: this.process ? `pid-${this.process.pid}` : null,
      localPort: this.config.localPortNumber
    };
  }
}

module.exports = { SSMSession };
