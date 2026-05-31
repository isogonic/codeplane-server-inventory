# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this repository, please report it
responsibly:

- **GitHub Security Advisory**: Use the [Security tab](https://github.com/isogonic/codeplane-server-inventory/security/advisories) to create a private advisory.
- **Direct email**: Contact the maintainers at the address listed in the repository metadata.

Do not open a public issue for security vulnerabilities.

## Security Model

### Local Trust Boundary

The server runs entirely on the user's machine. It reads and writes three files:

- **Inventory** (`servers.json`): lists hosts, groups, SSH targets
- **Secrets** (`secrets.enc`): encrypted credentials, never written in plaintext
- **Audit log** (`audit.log`): append-only log of actions (no secret values)

### Secrets at Rest

Secrets are encrypted with AES-256-GCM. The encryption key is derived from a
passphrase supplied via `SERVER_INVENTORY_PASSPHRASE` (or the macOS Keychain
when available). The passphrase is never stored on disk.

### No Secret Leakage in Logs

The audit log records **what** was changed (server name, key name, success/failure)
but never records **values**. Similarly, `list_secrets` and `list_all_secrets`
return key names and metadata, never decrypted values.

### Opt-In Remote Execution

`exec_on` and `exec` are disabled by default. Set
`SERVER_INVENTORY_ALLOW_EXEC=1` to enable them. This keeps the default threat
model "read-only-ish or local-only".

### SSH Safety Defaults

- `BatchMode=yes` prevents interactive password prompts that would hang agents.
- `StrictHostKeyChecking=accept-new` adds unknown hosts to `known_hosts` automatically,
  matching the behavior of a fresh laptop.
- `identity_file` permissions are validated: if world-readable, `validate_inventory`
  flags it as a warning.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.5.x   | Yes        |
| < 0.5   | No         |
