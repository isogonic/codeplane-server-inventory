# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-05-26

### Added

- **Encrypted secrets store** anchored by the macOS Keychain (or a
  passphrase env var on other platforms). Per-server key/value secrets
  via `set_secret`, `get_secret`, `list_secrets`, `list_all_secrets`,
  `delete_secret`, and a `secrets_info` introspection tool.
- **Cascade behaviour** on inventory mutations: `remove_server` deletes
  the server's secrets; `update_server` with `rename_to` migrates them
  to the new name.
- **`paths_report` tool** that returns every file location the server
  cares about (inventory, secrets, audit log, `~/.ssh/config`, every
  referenced identity file with chmod warnings, every ssh_alias with
  whether it resolves in ssh config) plus a per-server breakdown.
- **`validate_inventory` tool** flagging missing identity files,
  world-readable keys, undefined ssh_aliases, and unreachable entries.
- **Audit log** (`~/.config/server-inventory/audit.log`, JSON-lines)
  for every mutation. Secret values are never recorded. New
  `audit_tail` tool to read the last N entries.
- **`server-inv` CLI** binary exposing the same surface from the shell.
  `secret set` reads the value from stdin so passwords never appear
  in shell history.
- **CI matrix** expanded to ubuntu-latest + macos-latest on node 20 and 22.
- **21 unit tests** under `tests/` covering schema, store, secrets,
  paths, and the SSH command builder.

### Changed

- `get_server` now returns `secrets.keys` and a usage hint.
- `list_servers` now includes `secret_count` per row.
- `inventory_info` now also reports `secrets_path` and the global counts.
- MCP `instructions` block now teaches the safe secret-handling pattern.

### Security

- Secrets file uses AES-256-GCM with AAD bound to a literal version
  string so the key cannot be tricked into reading ciphertext from a
  different application.
- macOS Keychain master-key item is created with `-A` so reads after
  the initial `add-generic-password` don't prompt.
- Files written by this server are mode `0600`.
- Audit log never contains secret values, only key names.

## [0.1.0] — 2026-05-26

### Added

- Initial release. MCP stdio server with 9 tools:
  `inventory_info`, `list_servers`, `get_server`, `list_groups`,
  `list_tags`, `ssh_target_for`, `add_server`, `update_server`,
  `remove_server`.
- JSON inventory file with atomic writes and an in-process serialisation
  queue.
- Smoke-test script and GitHub Actions CI on node 20 + 22.
