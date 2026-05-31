# Interactions

This document describes how users and agents interact with
`codeplane-server-inventory`. It covers the MCP tool surface and the key
environment variables that control behavior.

## MCP Tool Surface

When loaded as an MCP server, the following tools are exposed:

### Inventory

- `inventory_info` — counts and metadata about the current inventory
- `list_servers` — filterable server listing
- `get_server` — full server detail with SSH command
- `add_server` — create a new server entry
- `update_server` — modify an existing entry (supports rename)
- `remove_server` — delete an entry (cascades secrets)

### Secrets

- `secrets_info` — backend and master-key metadata
- `set_secret` — store a secret value (plaintext never logged)
- `get_secret` — retrieve a secret value
- `list_secrets` — list secret keys for a server
- `list_all_secrets` — cross-server secret index
- `delete_secret` — remove a single secret

### SSH

- `ssh_check` — probe one or many servers for reachability + auth
- `ssh_target_for` — resolve servers to SSH targets or commands
- `exec_on` — run a command across matched servers (disabled by default)

### Audit

- `audit_tail` — recent audit log entries

### Validation

- `validate_inventory` — report missing fields, missing keys, expired secrets

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `SERVER_INVENTORY_PATH` | Inventory JSON file | `~/.config/server-inventory/servers.json` |
| `SERVER_INVENTORY_SECRETS_PATH` | Encrypted secrets file | `~/.config/server-inventory/secrets.enc` |
| `SERVER_INVENTORY_AUDIT_LOG` | Audit log file | `~/.config/server-inventory/audit.log` |
| `SERVER_INVENTORY_PASSPHRASE` | Force env-passphrase backend | `undefined` (uses Keychain on macOS) |
| `SERVER_INVENTORY_ALLOW_EXEC` | Enable remote command execution | `undefined` (disabled) |
| `SERVER_INVENTORY_TRACE` | Enable lock tracing to stderr | `undefined` |

## Agent Tips

- Always call `inventory_info` first to understand what's configured.
- Use `validate_inventory` before bulk operations to catch configuration drift.
- Prefer `ssh_check` over `exec_on` for connectivity validation — it is faster
  and does not require `ALLOW_EXEC`.
- Never pass secret values through `notes` or `description` fields; use
  `set_secret` instead.
- The audit log is append-only and never contains secret values, so it can
  safely be shared with operators for forensics.
