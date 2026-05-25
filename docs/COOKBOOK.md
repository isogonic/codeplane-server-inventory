# Cookbook

Concrete recipes for the kinds of jobs people actually use this server for.
Each recipe assumes the server is registered with your MCP client and the
agent has access to the tools.

---

## 1. Seed the inventory from scratch

You have a `~/.ssh/config` with five named Hosts and want the agent to
"know" all of them.

**From the shell (fastest):**

```bash
for h in lp-web-1 lp-web-2 lp-db-1 lp-staging-1 lp-bastion; do
  server-inv add "$h" --alias "$h" --group logicplanes
done
server-inv update lp-web-1     --tag web --env production --role web
server-inv update lp-web-2     --tag web --env production --role web
server-inv update lp-db-1      --tag db  --env production --role db
server-inv update lp-staging-1 --tag web --env staging    --role web
server-inv update lp-bastion   --tag bastion --env production --role bastion
```

**From the agent:**

> "Add `lp-web-1`, `lp-web-2`, `lp-db-1`, `lp-staging-1`, `lp-bastion` to
> the inventory under the `logicplanes` group. All of them have matching
> Host entries in my ssh config. The web hosts are role=web, env=production.
> lp-staging-1 is env=staging. lp-db-1 is role=db. lp-bastion is the
> bastion."

The agent will fire `add_server` five times via the MCP.

---

## 2. Store sudo passwords for a whole group

```bash
# read each password interactively, never appearing in shell history
for h in lp-web-1 lp-web-2 lp-app-1; do
  read -s -p "sudo password for $h: " pw; echo
  printf '%s' "$pw" | server-inv secret set "$h" sudo_password
done
```

The values land in `~/.config/server-inventory/secrets.enc`, encrypted with
the master key your keychain holds. Read them back with `server-inv secret
get $name sudo_password` or, from the agent, `get_secret`.

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

```bash
server-inv validate
```

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
asking the agent to do anything. The agent can run the same check via
`validate_inventory`.

---

## 5. Where exactly does the agent look for my password to lp-db-1?

```
agent: paths_report
```

You'll get something like:

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

```bash
server-inv update lp-web-1 --rename-to lp-web-primary
server-inv secret ls lp-web-primary
# -> { "server": "lp-web-primary", "keys": ["password","sudo_password"] }
```

(The secrets file is rewritten with the new name — old name is gone.)

---

## 7. Removing a server drops its secrets too

```bash
server-inv rm lp-staging-1
# -> { "removed": "lp-staging-1", "removed_secret_count": 2 }
```

No orphaned credentials, no manual cleanup.

---

## 8. Auditing what the agent has changed today

```bash
server-inv audit --limit 100
```

```json
{
  "path": "/Users/me/.config/server-inventory/audit.log",
  "total_lines": 142,
  "entries": [
    {"ts":"...","tool":"add_server","server":"lp-web-1","ok":true},
    {"ts":"...","tool":"set_secret","server":"lp-web-1","key":"password","ok":true},
    {"ts":"...","tool":"update_server","server":"lp-web-1","ok":true},
    ...
  ]
}
```

Tool names prefixed with `cli:` came from the terminal; bare names came
from the agent over MCP.

---

## 9. Move from the macOS Keychain backend to passphrase mode

Useful when migrating the secrets file to a new machine.

1. On the source machine, decrypt and re-encrypt with a passphrase:
   ```bash
   # On source: read out every value as JSON
   server-inv secret ls --json > /tmp/secret-keys.json
   # (For each server+key, server-inv secret get $s $k → save the
   #  value to a plaintext side file, then re-import on the new
   #  machine.)
   ```
2. On the destination machine, set `SERVER_INVENTORY_PASSPHRASE` in the
   MCP client's environment block, then `server-inv secret set` each
   value back.

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
