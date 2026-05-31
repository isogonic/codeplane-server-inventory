# Changelog

All notable changes to this project are documented here.

## [0.5.3] - 2026-05-31

### Added
- Automated npm publish workflow on push to `main`
- Extensive unit test suite (100 tests) covering audit, CLI, inventory, secrets, SSH, and paths
- Comprehensive documentation: README, Versioning, Cookbook, Security, Contributing, Testing, Interactions
- Branch protection settings in `.github/settings.yml`
- Changelog verification step before publish
- `execEnabled()` opt-in gate for remote command execution

### Changed
- Package scoped to `@isogonic/codeplane-server-inventory`
- Repository made public
- README rewritten in Codeplane documentation style

## [0.5.0] - 2026-05-28

### Added
- `ssh_check` — non-interactive reachability + auth probe with structured outcome classification
- `exec_on` — run arbitrary commands across one or many servers (opt-in via `SERVER_INVENTORY_ALLOW_EXEC`)
- Secrets v2 with AES-256-GCM encryption, expiry, and metadata
- Agent-friendly SSH defaults (`BatchMode=yes`, `StrictHostKeyChecking=accept-new`)
- Standalone CLI (`server-inv`) for bootstrapping and scripting
- Append-only audit log of every mutation
