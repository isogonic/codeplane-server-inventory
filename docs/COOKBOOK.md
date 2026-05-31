# Cookbook

Concrete recipes for the kinds of jobs people actually use this server for.
Each recipe assumes the server is registered with your MCP client and the
agent has access to the tools.

---

## 1. Seed the inventory from scratch

You have a `~/.ssh/config` with five named Hosts and want the agent to
"know" all of them.

**From the agent:**

> "Add `lp-web-1`, `lp-web-2`, `lp-db-1`, `lp-staging-1`, `lp-bastion` to
> the inventory under the `logicplanes` group. All of them have matching
> Host entries in my ssh config. The web hosts are role=web, env=production.
> lp-staging-1 is env=staging. lp-db-1 is role=db. lp-bastion is the
> bastion."

The agent will fire `add_server` five times via the MCP.

---

## 2. Store sudo passwords for a whole group

From the agent:

> "Store the sudo password `hunter2` for lp-web-1, lp-web-2, and lp-app-1
> under the key `sudo_password`."

The values land in `~/.config/server-inventory/secrets.enc`, encrypted with
the master key your keychain holds. Read them back via `get_secret`.

---

## 3. Security audit, no prompts

> "Run lynis on every logicplanes production server and bring me the
> summary. Use the sudo passwords I stored."

The agent will:

1. `list_servers { group: "logicplanes", environment: "production" }`.
2. For each → `get_secret { server, key: "sudo_password" }`.
3. `ssh ...` (via its own ssh tool) with `echo "$pw" | sudo -S lynis audit
   system --quick --quiet`.
4. Aggregate.

You never see the password values. They never appear in the chat
transcript.

---

## 4. Pre-flight: is my inventory healthy?

From the agent:

> "Run validate_inventory and tell me if anything is wrong."

```json
{
  "checked": 6,
  "problems": [
    { "server": "lp-web-2",   "severity": "warning",
      "message": "ssh_alias \"lp-web-2\" not defined in ~/.ssh/config" },
    { "server": "lp-staging-1", "severity": "error",
      "message": "identity_file /Users/me/.ssh/staging_key not found" }
  ],
  "ok": false
}
```

`ok: false` means at least one error — fix the missing key file before
asking the agent to do anything.

---

## 5. Where exactly does the agent look for my password to lp-db-1?

From the agent:

> "Run paths_report and show me where everything lives."

```json
{
  "inventory":  { "path": "/Users/me/.config/server-inventory/servers.json", "exists": true, ... },
  "secrets":    { "path": "/Users/me/.config/server-inventory/secrets.enc",  "exists": true,
                  "backend": "encrypted-file (aes-256-gcm)",
                  "master_key": "macOS Keychain (service=\"server-inventory-mcp\", account=\"master-key\")" },
  "ssh_config": { "path": "/Users/me/.ssh/config", "exists": true, ... },
  "audit_log":  { "path": "/Users/me/.config/server-inventory/audit.log", "exists": true, ... },
  "identity_files": [
    { "path": "/Users/me/.ssh/lp_db_key", "exists": true, "mode": "0600",
      "used_by": ["lp-db-1"] }
  ],
  "ssh_aliases": [
    { "alias": "lp-db-1", "used_by": ["lp-db-1"], "defined_in_ssh_config": true }
  ],
  "per_server": [
    { "name": "lp-db-1", "ssh_target": "lp-db-1", "ssh_alias": "lp-db-1",
      "identity_file_resolved": "/Users/me/.ssh/lp_db_key",
      "secret_keys": ["db_password"] }
  ]
}
```

Every file the agent could touch, in one shot.

---

## 6. Renaming a server keeps its secrets

From the agent:

> "Rename lp-web-1 to lp-web-primary."

The agent will call `update_server` with `rename_to`. Secrets are migrated
automatically. Verify with `get_server { name: "lp-web-primary" }` — the
`secret_keys` list will still show the old keys.

---

## 7. Removing a server drops its secrets too

From the agent:

> "Remove lp-staging-1 from the inventory."

The agent calls `remove_server`. The response includes
`removed_secret_count` so you can confirm the cascade.

---

## 8. Auditing what the agent has changed today

From the agent:

> "Show me the last 50 audit log entries."

Tool names come from the agent over MCP (`add_server`, `set_secret`, etc.)
or from the terminal if you used one (e.g. `cli:add_server` on older versions).

---

## 9. Move from the macOS Keychain backend to passphrase mode

Useful when migrating the secrets file to a new machine.

1. On the source machine, export and re-import via the agent:
   - `list_all_secrets` to discover every server/key.
   - For each: `get_secret { server, key }` → save value.
   - On destination machine: `set_secret { server, key, value }`.
2. Set `SERVER_INVENTORY_PASSPHRASE` in the MCP client's environment block
   on the destination machine.

The two backends produce different ciphertexts even for the same value,
so the secrets file is not directly portable without a re-encrypt step.

---

## 10. Back up safely

Files that matter:

- `~/.config/server-inventory/servers.json` — non-sensitive, back up freely
- `~/.config/server-inventory/secrets.enc` — encrypted, safe to back up
- `~/.config/server-inventory/audit.log` — appendable, safe to back up
- The **master key** (macOS Keychain item) — you lose this, the secrets file
  is unrecoverable. macOS Keychain syncs to iCloud Keychain if you have
  that enabled; otherwise dump the key out with:

```bash
security find-generic-password -s server-inventory-mcp -a master-key -w
```

…and store that hex blob somewhere safe (1Password, hardware token, etc.).
