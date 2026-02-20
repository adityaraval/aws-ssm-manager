# AWS SSM Manager

A beautiful, cross-platform desktop app for AWS SSM port forwarding. Connect to OpenSearch, Aurora, ElastiCache, and RabbitMQ securely — no VPN required.

![AWS SSM Manager](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/License-MIT-green)

- Website: https://adityaraval.github.io/aws-ssm-manager/
- Releases: https://github.com/adityaraval/aws-ssm-manager/releases/latest

## Prerequisites

Before using AWS SSM Manager, ensure you have the following installed and configured:

### 1. AWS CLI v2

The AWS Command Line Interface is required for authentication and session management.

**macOS (Homebrew):**
```bash
brew install awscli
```

**macOS (Package):**
```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
```

**Windows:**
Download and run the installer from: https://awscli.amazonaws.com/AWSCLIV2.msi

**Linux:**
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

Verify installation:
```bash
aws --version
```

### 2. AWS Session Manager Plugin

The Session Manager plugin is required to establish SSM sessions.

**macOS (Homebrew):**
```bash
brew install --cask session-manager-plugin
```

**macOS (Package):**
```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac/sessionmanager-bundle.zip" -o "sessionmanager-bundle.zip"
unzip sessionmanager-bundle.zip
sudo ./sessionmanager-bundle/install -i /usr/local/sessionmanagerplugin -b /usr/local/bin/session-manager-plugin
```

**Windows:**
Download and run the installer from: https://s3.amazonaws.com/session-manager-downloads/plugin/latest/windows/SessionManagerPluginSetup.exe

**Linux (Debian/Ubuntu):**
```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" -o "session-manager-plugin.deb"
sudo dpkg -i session-manager-plugin.deb
```

**Linux (RHEL/CentOS/Fedora):**
```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/linux_64bit/session-manager-plugin.rpm" -o "session-manager-plugin.rpm"
sudo yum install -y session-manager-plugin.rpm
```

Verify installation:
```bash
session-manager-plugin --version
```

### 3. AWS Credentials Configuration

Configure your AWS credentials using named profiles:

```bash
aws configure --profile your-profile-name
```

You'll be prompted to enter:
- AWS Access Key ID
- AWS Secret Access Key
- Default region (e.g., `us-east-1`)
- Default output format (e.g., `json`)

For SSO-based authentication:
```bash
aws configure sso --profile your-sso-profile
aws sso login --profile your-sso-profile
```

### 4. Required IAM Permissions

Your IAM user or role needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:StartSession",
        "ssm:TerminateSession",
        "ssm:ResumeSession",
        "ssm:DescribeSessions",
        "ssm:GetConnectionStatus"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

### 5. EC2 Instance Requirements

The target EC2 instance (bastion host) must have:
- SSM Agent installed and running (pre-installed on Amazon Linux 2, Ubuntu 20.04+, Windows Server 2016+)
- An IAM instance profile with `AmazonSSMManagedInstanceCore` policy attached
- Outbound internet access (for SSM service endpoints) or VPC endpoints configured

## Features

- **Multiple Services**: Connect to OpenSearch, Aurora PostgreSQL, ElastiCache Redis, and Amazon MQ
- **Organized Connections**: Group connections by environment with color-coding
- **Secure by Design**: Uses AWS SSM Session Manager — no inbound ports, no bastion SSH
- **One-Click Connect**: Save connections and reconnect instantly
- **Dark Mode**: Beautiful dark and light themes
- **Quick Search**: Find connections with fuzzy search
- **Export & Import**: Backup and share configurations
- **Live Terminal**: Watch session output in real-time
- **Configurable Session Timeout**: 5/10/15/30 minutes or no timeout with countdown display

## Installation

Download the latest release for your platform:

- **macOS**: `.dmg` (Intel & Apple Silicon)
- **Windows**: `.exe` installer
- **Linux**: `.AppImage` or `.deb`

Latest release: https://github.com/adityaraval/aws-ssm-manager/releases/latest

## Usage

1. **Select your AWS profile** from the dropdown
2. **Configure your connection** with instance ID, remote host, and port
3. **Click "Start Session"** to establish the tunnel
4. **Access your service** via `localhost` on the configured port

## Development

```bash
# Clone the repository
git clone https://github.com/adityaraval/aws-ssm-manager.git
cd aws-ssm-manager

# Install dependencies
cd app
npm install

# Run in development mode
npm start
```

## License

MIT License — see [LICENSE](LICENSE) for details.
