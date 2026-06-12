# Security Policy

## Supported versions

s3Manager is distributed as a desktop application. Only the latest released
version receives security fixes. Please make sure you are on the most recent
release before reporting an issue.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the [**Security** tab](https://github.com/NoiXdev/s3Manager/security/advisories) of this repository.
2. Click **Report a vulnerability** and fill in the details.

If you are unable to use private reporting, you may email the maintainer at
**ich@dginx.de** instead.

Please include, where possible:

- A description of the vulnerability and its impact.
- Steps to reproduce or a proof of concept.
- The affected version and your operating system.

## What to expect

- We aim to acknowledge new reports within **5 business days**.
- We will keep you informed as we investigate and work on a fix.
- Once a fix is released, we are happy to credit you in the release notes
  unless you prefer to remain anonymous.

## Scope

s3Manager stores S3 access keys in the operating-system keychain (via Electron
`safeStorage`) and all other data in a local SQLite database; it does not
transmit data to any first-party server. Reports concerning credential
handling, IPC boundaries between the main and renderer processes, presigned-URL
generation, or the auto-update/release pipeline are especially welcome.
