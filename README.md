# server-inventory-mcp

An MCP (Model Context Protocol) server that maintains a grouped, tagged inventory of
SSH-reachable machines so an agent can resolve queries like
**"run a security audit on every logicplanes server"** into concrete SSH targets.

The inventory only stores *where* and *how* to connect. Actual SSH
authentication continues to live in your `~/.ssh/config` (the recommended
path) so secrets and identity files stay where they already are.

## Why

Without an inventory, an agent told to "audit all our production
servers" has to ask you which servers count, which user to connect as,
which key to use, and so on, every time. With this MCP server it can:

1. Call `list_groups` to discover groups like `logicplanes` or `production`.
2. Call `ssh_target_for { group: "logicplanes" }` to get an exact
   `ssh ...` command for every member.
3. Hand those commands to its own `ssh` tool to actually connect.

## Install

Requires Node.js 20+.

```bash
git clone https://github.com/devinoldenburg/server-inventory-mcp.git
cd server-inventory-mcp
npm install
npm run build
```

This produces `dist/index.js`, which is the stdio MCP entry point.

## Register with an MCP client

### Codeplane / Claude Desktop / Cursor / anything that takes JSON MCP config

Add this entry to your client's MCP config. For Codeplane the file is
`codeplane.jsonc`:

```jsonc
{
  "mcp": {
    "server-inventory": {
      "type": "local",
      "command": [
        "/opt/homebrew/bin/node",
        "/absolute/path/to/server-inventory-mcp/dist/index.js"
      ],
      "environment": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        "SERVER_INVENTORY_PATH": "/Users/you/.config/server-inventory/servers.json"
      },
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

`SERVER_INVENTORY_PATH` is optional; it defaults to
`~/.config/server-inventory/servers.json`. Use it to point at a
different file (for example a project-local one checked into a private
repo of yours).

## Inventory file shape

```json
{
  "version": 1,
  "servers": [
    {
      "name": "lp-web-1",
      "ssh_alias": "lp-web-1",
      "groups": ["logicplanes", "production"],
      "tags": ["web", "nginx"],
      "environment": "production",
      "role": "web",
      "description": "Primary marketing site"
    },
    {
      "name": "lp-db-1",
      "host": "10.0.0.10",
      "user": "ops",
      "port": 22,
      "identity_file": "~/.ssh/lp_db_key",
      "groups": ["logicplanes", "production"],
      "tags": ["db", "postgres"],
      "environment": "production",
      "role": "db"
    }
  ]
}
```

Every entry must have either `ssh_alias` (preferred — let
`~/.ssh/config` handle user/port/key) or `host`. Everything else is
optional. `groups` and `tags` are free-form strings.

## Tools

All tool calls return text content with a JSON payload (so agents can
parse, but humans can also read it).

| Tool | What it does |
|------|---------------|
| `inventory_info` | Path to the inventory file and counts of servers / groups / tags. |
| `list_servers` | List servers, optionally filtered by `group`, `tag`, `environment`, `role`, or free-text `search`. |
| `get_server` | Full details + ready-to-run ssh command for one server by name. |
| `list_groups` | Every distinct group with member names. The discovery surface for "all X servers". |
| `list_tags` | Every distinct tag with usage counts. |
| `ssh_target_for` | Resolve a `name`, `group`, or `tag` to one or more ssh targets (alias or `user@host`) and exact `ssh ...` commands. |
| `add_server` | Add a new server. Either `ssh_alias` or `host` is required. |
| `update_server` | Patch fields on an existing server. Supports `rename_to`. |
| `remove_server` | Delete a server by name. |

## Example agent flow

> "Run a security audit on every logicplanes server."

1. Agent → `list_groups` → sees `{ name: "logicplanes", count: 4, members: [...] }`.
2. Agent → `ssh_target_for { group: "logicplanes" }` → gets four
   `{ name, target, command }` rows.
3. Agent loops over the targets, calling its own `ssh` tool to run
   `lynis audit system --quick`, `apt list --upgradable`, `last`, etc.
4. Agent aggregates the results.

You never had to tell it where the servers are or how to connect.

## Concurrency and persistence

- The file is written atomically (write to `.tmp`, then `rename`).
- All read-modify-write tool calls are serialised through an in-process
  queue so two concurrent agent calls cannot clobber each other.
- The file is created with mode `0600`. If you treat the file as
  sensitive (group/tag names that hint at infrastructure), point
  `SERVER_INVENTORY_PATH` at a directory only you can read.

## Development

```bash
npm run build   # tsc -> dist/
npm start       # run the compiled server
npm run dev     # run directly via tsx (no build step)
```

Set `SERVER_INVENTORY_TRACE=1` to print lock/load/save breadcrumbs to
stderr when debugging.

## License

MIT — see [LICENSE](LICENSE).
