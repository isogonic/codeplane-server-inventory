<div align="center">

  <h1>Codeplane Server Inventory</h1>

  <p>
    <strong>MCP server for <a href="https://codeplane.cc">Codeplane</a> that keeps an inventory of SSH-reachable servers (grouped + tagged) with an encrypted secrets store so an agent can answer "audit all <group> servers" without you having to tell it where the servers are or how to log in.</strong>
  </p>

  <p>
    <a href="https://codeplane.cc"><strong>Website</strong></a> &nbsp;·&nbsp;
    <a href="https://codeplane.cc/docs/mcp/"><strong>MCP docs</strong></a> &nbsp;·&nbsp;
    <a href="https://github.com/isogonic/codeplane-server-inventory/issues">Issues</a> &nbsp;·&nbsp;
    <a href="https://npmjs.com/package/@isogonic/codeplane-server-inventory">npm</a> &nbsp;·&nbsp;
    <a href="docs/Versioning.md"><strong>Versioning</strong></a>
  </p>
</div>

<br />

> [!WARNING]
> This server exposes SSH and optional remote command execution to AI agents. Treat it like a privileged credential-aware tool: do not expose it over a network, and use `SERVER_INVENTORY_ALLOW_EXEC=0` (the default) unless you explicitly need `exec_on`.

## What It Is

An MCP server for Codeplane that stores:

- **A grouped, tagged inventory of SSH hosts** — hostname, user, port, identity file, jump host, or just an `ssh_alias` that resolves via `~/.ssh/config`.
- **An encrypted secrets store** for passwords, sudo passwords, key passphrases, DB credentials, and API tokens — retrieved right before the call that needs them, never written to disk in plaintext.

Everything writable lives in your Codeplane data directory:

```text
~/.config/server-inventory/
├── servers.json   inventory (no secrets, 0600)
├── secrets.enc    AES-256-GCM blob, master key in your macOS Keychain
└── audit.log      append-only JSON-lines, every mutation
```

Use the `paths_report` tool (or `server-inv paths`) to get every file location, including resolved identity file paths and ssh aliases that don't resolve in your `~/.ssh/config`.

## Install

```bash
npm install -g @isogonic/codeplane-server-inventory
```

Or install locally in a project:

```bash
npm install @isogonic/codeplane-server-inventory
```

Verify the CLI:

```bash
server-inv --help
server-inv info
```

## Add to Codeplane

Add this to your `codeplane.jsonc` (or `codeplane.json`):

```jsonc
{
  "mcp": {
    "server-inventory": {
      "type": "local",
      "command": [
        "npx",
        "-y",
        "@isogonic/codeplane-server-inventory"
      ],
      "environment": {
        "SERVER_INVENTORY_ALLOW_EXEC": "0"
      },
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

Then restart Codeplane. The server registers these tools under the `server-inventory` namespace.

If you installed globally and want to use the global binary instead of `npx`:

```jsonc
{
  "mcp": {
    "server-inventory": {
      "type": "local",
      "command": ["server-inventory-mcp"],
      "environment": {
        "SERVER_INVENTORY_ALLOW_EXEC": "0"
      },
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

### Permissions

Allow or prompt for specific tools in `codeplane.jsonc`:

```jsonc
{
  "permission": {
    "tools": {
      "mcp__server-inventory__list_servers": "allow",
      "mcp__server-inventory__ssh_target_for": "allow",
      "mcp__server-inventory__get_secret": "ask",
      "mcp__server-inventory__exec_on": "deny"
    }
  }
}
```

MCP tool IDs are generated from the server name and tool name. Keep the server name (`server-inventory`) stable if you persist permission rules.

## Core Features

- **Grouped + tagged inventory** — organize servers by environment, role, team, or any tag.
- **Encrypted secrets store** — AES-256-GCM with master key from macOS Keychain or scrypt-derived passphrase.
- **Agent-safe defaults** — `exec_on` defaults to `dry_run: true`, duplicate names are rejected with a hint to use `update_server`, secrets are never echoed back to the user.
- **SSH reachability probing** — `ssh_check` classifies outcomes: `ok` / `auth_failed` / `dns_failure` / `refused` / `timeout` / `host_key_mismatch` / `unreachable` / `unknown`.
- **Remote command execution** — `exec_on` runs commands across a name / group / tag. **Opt-in only**: refuses unless `SERVER_INVENTORY_ALLOW_EXEC=1`.
- **Audit trail** — append-only JSON-lines log records every mutation and `exec_on` call (server + exit code only, never command body or output).
- **CLI** — `server-inv` exposes every tool from your shell for operator use.

## File Locations

| File | Default | Override |
|------|---------|----------|
| Inventory | `~/.config/server-inventory/servers.json` | `SERVER_INVENTORY_PATH` |
| Secrets | `~/.config/server-inventory/secrets.enc` | `SERVER_INVENTORY_SECRETS_PATH` |
| Audit log | `~/.config/server-inventory/audit.log` | `SERVER_INVENTORY_AUDIT_LOG` |
| Master key | macOS Keychain (`security`) on darwin; scrypt-derived from `SERVER_INVENTORY_PASSPHRASE` elsewhere | — |
| `exec_on` gate | off by default | `SERVER_INVENTORY_ALLOW_EXEC` |

All files except `~/.ssh/config` are created with mode `0600`.

## Tools

| Tool | What it does |
|------|---------------|
| `inventory_info` | Where the inventory + secrets + audit log live; counts. |
| `paths_report` | Detailed report of every file location, including resolved identity files (with chmod warnings) and ssh aliases (with whether `~/.ssh/config` defines them). |
| `validate_inventory` | Sanity-check every server: identity files exist, ssh aliases resolve, every entry is reachable. |
| `list_servers` | Filter by group / tag / environment / role / free-text search. |
| `get_server` | Full record + ssh command + which secret keys are available. |
| `list_groups` | Every distinct group with member names. |
| `list_tags` | Every distinct tag with usage counts. |
| `ssh_target_for` | Resolve a name OR group OR tag to ssh commands. |
| `add_server` / `update_server` / `remove_server` | CRUD. `remove_server` cascades to delete secrets; `update_server` with `rename_to` migrates them. |
| `secrets_info` | Backend + master-key provider + secrets file path. |
| `set_secret` | Encrypt + store one value. Accepts `expires_at` (ISO) or `expires_in` (`30d`, `12h`, `2w`); preserves `created_at` across updates. Returns metadata, never the value. |
| `get_secret` | Decrypt + return one value. Call this right before the command that needs it. |
| `list_secrets` | Keys for one server **with metadata** (`created_at`, `updated_at`, optional `expires_at`, `expired`). Values are never returned. |
| `list_all_secrets` | Every server's keys with metadata + an `expired_count`. |
| `delete_secret` | Remove one key. |
| `audit_tail` | Last N entries from the audit log. |
| `ssh_check` | Probe reachability per host with structured outcomes. Bounded parallelism, ConnectTimeout, hard kill timer. |
| `exec_on` | Run a non-interactive command across name / group / tag. **Opt-in**: refuses unless `SERVER_INVENTORY_ALLOW_EXEC=1`. **Defaults to `dry_run: true`** — first call returns reachability + the plan; pass `dry_run: false` to actually run. Output truncated; audit log records server + exit code only. |

## The CLI

```bash
server-inv ls                          # list servers
server-inv get lp-web-1                # detail + ssh command + secret keys
server-inv groups                      # all groups with member names
server-inv targets --group logicplanes # ssh commands, one per line, ready to pipe

server-inv add lp-web-1 --host 10.0.0.5 --user ubuntu \
  --group logicplanes --group production --tag web --tag nginx \
  --env production --role web --desc "primary public web"

server-inv update lp-web-1 --port 2222 --tag tls
server-inv update lp-web-1 --rename-to lp-web-primary

echo -n 'hunter2' | server-inv secret set lp-web-1 password
echo -n 'tok-abc' | server-inv secret set lp-web-1 api_token --expires-in 30d
server-inv secret get lp-web-1 password   # prints value to stdout
server-inv secret ls                       # all servers' keys
server-inv secret ls lp-web-1 --meta       # keys + created_at/updated_at/expires_at
server-inv secret rm lp-web-1 password

server-inv ssh-check --group logicplanes   # probe every host, non-zero exit if any down
server-inv ssh-check --all --timeout-sec 3
SERVER_INVENTORY_ALLOW_EXEC=1 \
  server-inv exec --group logicplanes -- "uptime && uname -r"   # dry-run by default
SERVER_INVENTORY_ALLOW_EXEC=1 \
  server-inv exec --group logicplanes --run -- "uptime && uname -r"   # actually fire

server-inv paths                       # paths_report as JSON
server-inv validate                    # validate_inventory as JSON
server-inv audit --limit 20            # tail of the audit log

server-inv rm lp-web-1                 # cascades to delete secrets
```

The CLI writes to the same files as the MCP server and logs to the same audit log (with `cli:` prefixed tool names) so an operator can tell a manual change from an agent-driven one.

## Example: audit all logicplanes servers

A realistic agent flow once the inventory is populated:

```
user → agent → Codeplane → MCP

agent: list_groups
       ← { groups: [{ name: "logicplanes", count: 4, members: [...] }, ...] }

agent: ssh_target_for { group: "logicplanes" }
       ← { count: 4, targets: [
             { name: "lp-web-1",   command: "ssh ubuntu@10.0.0.5", ... },
             { name: "lp-db-1",    command: "ssh lp-db-1",         ... },
             { name: "lp-app-1",   command: "ssh -J ops@bastion deploy@10.0.1.20" },
             ...
         ] }

for each target:
  agent: get_server { name }
         ← { ..., secrets: { keys: ["sudo_password"], hint: "..." } }

  agent: get_secret { server, key: "sudo_password" }
         ← { value: "..." }       # used immediately, not persisted

  agent (via its own ssh tool): ssh ... 'echo "$sudo_pw" | sudo -S lynis audit system --quick'

  agent: collects findings
```

The agent never had to ask you which servers count, what credentials to use, or where the keys live. `paths_report` would have told it everything in one call if it ever needed to debug.

## Security Model

What this server is good for:

- Personal / small-team inventory that lives on your laptop or a single workstation. The encrypted secrets file is unreadable without the master key, which never leaves your keychain (or env var).
- Replacing "credentials pasted into chat" with "credentials retrieved from an encrypted local store the moment the agent needs them".
- An audit trail of what was changed and when.

What it is **not**:

- A team password manager. There's no sharing, no rotation policy. Per-key `expires_at` is a reminder mechanism (surfaced through `list_secrets` and `validate_inventory`); it does NOT delete or rotate the value. Use 1Password / Bitwarden / Vault for actual team credential management.
- An access-control system. Anything that can talk to this MCP server can read all the secrets. Don't expose it over the network.
- Tamper-proof. The audit log is on disk and can be deleted. If you need cryptographically verifiable history, ship the audit log to a WORM store.

## Development

```bash
git clone https://github.com/isogonic/codeplane-server-inventory.git
cd codeplane-server-inventory
npm install
npm run build     # compile TypeScript -> dist/
npm run test:unit # node --test on the unit suites
npm run smoke     # spawn the built MCP server, exercise every tool
npm test          # build + unit + smoke chained
npm run dev       # run src/index.ts directly via tsx (no build)
```

Set `SERVER_INVENTORY_TRACE=1` for stderr breadcrumbs from the lock / load / save paths when debugging.

## Repository Layout

```text
src/
  index.ts        MCP server entry point (stdio)
  cli.ts          server-inv CLI
  inventory.ts    inventory store + SSH resolution
  secrets.ts      encrypted secrets store
  audit.ts        append-only audit log
  schema.ts       Zod validation
  paths.ts        paths_report helper
  ssh.ts          ssh_check / exec_on implementation
tests/            Node test suites
scripts/          smoke test
dist/             compiled output
```

## License

MIT — see [LICENSE](LICENSE).
