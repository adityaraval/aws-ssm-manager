# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Open a private report using [GitHub Security Advisories](https://github.com/adityaraval/aws-ssm-manager/security/advisories/new)
3. Include the following information:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
- **Updates**: We will provide updates on the status of your report within 7 days
- **Resolution**: We aim to resolve critical vulnerabilities within 30 days
- **Credit**: With your permission, we will credit you in our release notes

## Security Model

### Architecture

AWS SSM Manager is an Electron-based desktop application that:
- Runs locally on your machine
- Uses the AWS CLI for SSM session management
- Stores connection configurations in browser localStorage
- Does NOT transmit data to any third-party servers

### Security Features

#### Input Validation
- All AWS parameters (instance IDs, regions, ports, profiles, hostnames) are validated against strict patterns
- Form inputs are sanitized before use
- Imported connection files are fully validated and sanitized

#### Process Isolation
- Node.js integration is disabled in the renderer process
- Context isolation is enabled
- All IPC communication goes through a secure preload bridge

#### Content Security Policy
The application enforces a strict CSP:
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self'
```

#### Environment Protection
- Only necessary environment variables are passed to child processes
- AWS credentials are read from standard AWS CLI configuration files
- No credentials are stored by this application

## Security Best Practices for Users

### AWS Credentials

1. **Use IAM roles with least privilege**: Only grant the minimum permissions required for SSM sessions
2. **Use named profiles**: Avoid using the default profile for sensitive operations
3. **Rotate credentials regularly**: Follow AWS best practices for credential rotation
4. **Use MFA**: Enable multi-factor authentication on your AWS accounts

### Recommended IAM Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:StartSession"
      ],
      "Resource": [
        "arn:aws:ec2:*:*:instance/*",
        "arn:aws:ssm:*:*:document/AWS-StartPortForwardingSessionToRemoteHost"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:TerminateSession",
        "ssm:ResumeSession"
      ],
      "Resource": [
        "arn:aws:ssm:*:*:session/${aws:username}-*"
      ]
    }
  ]
}
```

### Connection Data

1. **Export files**: Exported connection files contain unencrypted metadata (profile names, regions, instance IDs, hostnames). Store these files securely and do not share publicly.

2. **Shared computers**: If using this application on a shared computer, be aware that connection configurations are stored in the browser's localStorage.

3. **Sensitive hostnames**: Avoid using connection names that reveal sensitive infrastructure details.

### Network Security

1. **Local ports**: Be mindful of the local ports you expose. Other applications on your machine can connect to forwarded ports.

2. **Firewall**: Consider using a local firewall to restrict access to forwarded ports if needed.

3. **Session timeout**: The default 10-minute session timeout helps prevent forgotten open sessions. Do not disable this feature.

## Known Security Considerations

### Data Storage

- **localStorage**: Connection configurations are stored in Electron's localStorage, which is not encrypted. This includes:
  - Connection names
  - AWS profile names
  - AWS regions
  - EC2 instance IDs
  - Service hostnames and ports

- **No credential storage**: This application does NOT store AWS access keys or secret keys. It relies on the AWS CLI's credential chain.

### Process Management

- **Child processes**: AWS CLI sessions run as child processes. The application attempts to clean up all child processes on exit, but orphaned processes may remain if the application crashes.

- **Session logging**: Session activity is displayed in the terminal but is not persisted to disk.

### Third-Party Dependencies

This application uses the following key dependencies:
- Electron (desktop framework)
- AWS SDK for JavaScript v3 (AWS API interactions)
- xterm.js (terminal emulation)

We regularly update dependencies to address known vulnerabilities. Run `npm audit` to check for any known issues.

## Security Checklist for Contributors

Before submitting code changes:

- [ ] No hardcoded credentials or secrets
- [ ] All user inputs are validated and sanitized
- [ ] No use of `eval()`, `innerHTML` with unsanitized data, or `shell: true` in spawn
- [ ] Error messages do not leak sensitive information
- [ ] New dependencies have been reviewed for security
- [ ] `npm audit` shows no high or critical vulnerabilities

## Changelog

### Security Improvements (Latest)

- Added input validation for all AWS parameters
- Fixed potential command injection in process termination (Windows)
- Fixed XSS vulnerabilities in connection/group name rendering
- Added Content Security Policy headers
- Limited environment variable exposure to child processes
- Added export security warning dialog
- Added comprehensive import file validation and sanitization
- Added file size and count limits for imports
