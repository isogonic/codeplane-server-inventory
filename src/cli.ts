#!/usr/bin/env node
/**
 * Standalone CLI for the inventory + secrets store.
 *
 * Lets you manage everything without an MCP client. Useful for bootstrapping
 * the inventory from a shell, scripting bulk imports, or quickly inspecting
 * what the agent has been touching.
 *
 *   server-inv ls                    # list servers (alias of list_servers)
 *   server-inv get <name>            # full server detail + ssh command
 *   server-inv groups                # all groups with member names
 *   server-inv targets --group lp    # ssh commands for a group
 *   server-inv add <name> [opts]     # add a new server
 *   server-inv rm <name>             # remove a server (cascades secrets)
 *   server-inv secret set <s> <k>    # store a secret (reads value from stdin)
 *   server-inv secret get <s> <k>    # print one secret value
 *   server-inv secret ls [server]    # list secret keys
 *   server-inv secret rm <s> <k>     # delete a secret
 *   server-inv paths                 # paths_report
 *   server-inv validate              # validate_inventory
 *   server-inv audit [--limit N]     # tail the audit log
 */
import {
  InventoryStore,
  buildSshCommand,
  buildSshTarget,
  resolveAuditLogPath,
  resolveInventoryPath,
} from "./inventory.js";
import { defaultSecretsStore, resolveSecretsPath } from "./secrets.js";
import { buildPathsReport, expandHome, loadSshConfigHostAliases } from "./paths.js";
import { audit } from "./audit.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const HELP = `\
server-inv — standalone CLI for server-inventory-mcp

USAGE
  server-inv <command> [args]

INVENTORY
  ls [--group G] [--tag T] [--env E] [--role R] [--search S]
  get <name>
  groups
  tags
  targets (--name N | --group G | --tag T)
  add <name> [--host H] [--user U] [--port P] [--alias A]
             [--key PATH] [--jump JH]
             [--group G ...] [--tag T ...]
             [--env E] [--role R] [--desc TEXT] [--notes TEXT]
  update <name> [--rename-to NEW] [same fields as add]
  rm <name>
  validate
  paths
  info

SECRETS
  secret set <server> <key>   # value read from stdin (no echo)
  secret get <server> <key>
  secret ls [server]
  secret rm <server> <key>

AUDIT
  audit [--limit N]            # default 50

ENVIRONMENT
  SERVER_INVENTORY_PATH         override inventory file location
  SERVER_INVENTORY_SECRETS_PATH override secrets file location
  SERVER_INVENTORY_AUDIT_LOG    override audit log location
  SERVER_INVENTORY_PASSPHRASE   passphrase mode (skip macOS Keychain)
`;

function parseArgs(argv: string[]): {
  positional: string[];
  flags: Record<string, string[]>;
  bool: Set<string>;
} {
  const positional: string[] = [];
  const flags: Record<string, string[]> = {};
  const bool = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        bool.add(key);
      } else {
        (flags[key] ??= []).push(next);
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags, bool };
}

function f1(flags: Record<string, string[]>, key: string): string | undefined {
  return flags[key]?.[0];
}
function fAll(flags: Record<string, string[]>, key: string): string[] {
  return flags[key] ?? [];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

function jsonOut(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

async function cmdList(args: ReturnType<typeof parseArgs>): Promise<void> {
  const store = await InventoryStore.open();
  const rows = store.list({
    group: f1(args.flags, "group"),
    tag: f1(args.flags, "tag"),
    environment: f1(args.flags, "env") ?? f1(args.flags, "environment"),
    role: f1(args.flags, "role"),
    search: f1(args.flags, "search"),
  });
  jsonOut({
    count: rows.length,
    servers: rows.map((s) => ({
      name: s.name,
      target: buildSshTarget(s),
      groups: s.groups,
      tags: s.tags,
      environment: s.environment,
      role: s.role,
    })),
  });
}

async function cmdGet(name: string): Promise<void> {
  const store = await InventoryStore.open();
  const s = store.get(name);
  if (!s) throw new Error(`Server "${name}" not found.`);
  const secretKeys = await defaultSecretsStore().list(name).catch(() => []);
  jsonOut({
    ...s,
    ssh: { target: buildSshTarget(s), command: buildSshCommand(s) },
    secret_keys: secretKeys,
  });
}

async function cmdGroups(): Promise<void> {
  const store = await InventoryStore.open();
  jsonOut({ groups: store.groups() });
}

async function cmdTags(): Promise<void> {
  const store = await InventoryStore.open();
  jsonOut({ tags: store.tags() });
}

async function cmdTargets(args: ReturnType<typeof parseArgs>): Promise<void> {
  const name = f1(args.flags, "name");
  const group = f1(args.flags, "group");
  const tag = f1(args.flags, "tag");
  const provided = [name, group, tag].filter(Boolean).length;
  if (provided !== 1) {
    throw new Error("Provide exactly one of --name, --group, --tag.");
  }
  const store = await InventoryStore.open();
  let matches;
  if (name) {
    const s = store.get(name);
    if (!s) throw new Error(`Server "${name}" not found.`);
    matches = [s];
  } else if (group) {
    matches = store.list({ group });
  } else {
    matches = store.list({ tag });
  }
  for (const s of matches) {
    process.stdout.write(buildSshCommand(s) + "\n");
  }
}

function buildServerInputFromFlags(
  name: string,
  args: ReturnType<typeof parseArgs>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { name };
  const host = f1(args.flags, "host");
  if (host) out.host = host;
  const user = f1(args.flags, "user");
  if (user) out.user = user;
  const port = f1(args.flags, "port");
  if (port) out.port = parseInt(port, 10);
  const alias = f1(args.flags, "alias");
  if (alias) out.ssh_alias = alias;
  const key = f1(args.flags, "key");
  if (key) out.identity_file = key;
  const jump = f1(args.flags, "jump");
  if (jump) out.jump_host = jump;
  const groups = fAll(args.flags, "group");
  if (groups.length) out.groups = groups;
  const tags = fAll(args.flags, "tag");
  if (tags.length) out.tags = tags;
  const env = f1(args.flags, "env") ?? f1(args.flags, "environment");
  if (env) out.environment = env;
  const role = f1(args.flags, "role");
  if (role) out.role = role;
  const desc = f1(args.flags, "desc") ?? f1(args.flags, "description");
  if (desc) out.description = desc;
  const notes = f1(args.flags, "notes");
  if (notes) out.notes = notes;
  return out;
}

async function cmdAdd(name: string, args: ReturnType<typeof parseArgs>): Promise<void> {
  const store = await InventoryStore.open();
  const added = store.add(buildServerInputFromFlags(name, args) as never);
  await store.save();
  await audit({ tool: "cli:add_server", server: name, ok: true });
  jsonOut({ added });
}

async function cmdUpdate(name: string, args: ReturnType<typeof parseArgs>): Promise<void> {
  const store = await InventoryStore.open();
  const patch = buildServerInputFromFlags(name, args);
  delete (patch as { name?: string }).name;
  const renameTo = f1(args.flags, "rename-to");
  if (renameTo) (patch as { name?: string }).name = renameTo;
  const updated = store.update(name, patch as never);
  await store.save();
  // Migrate secrets on rename
  if (renameTo && renameTo !== name) {
    const sec = defaultSecretsStore();
    const keys = await sec.list(name);
    for (const k of keys) {
      const v = await sec.get(name, k);
      if (v !== null) {
        await sec.set(renameTo, k, v);
        await sec.delete(name, k);
      }
    }
  }
  await audit({ tool: "cli:update_server", server: name, rename_to: renameTo, ok: true });
  jsonOut({ updated });
}

async function cmdRm(name: string): Promise<void> {
  const store = await InventoryStore.open();
  const removed = store.remove(name);
  await store.save();
  const sec = defaultSecretsStore();
  const removedSecrets = await sec.deleteServer(name).catch(() => 0);
  await audit({
    tool: "cli:remove_server",
    server: name,
    ok: true,
    extra: { removed_secret_count: removedSecrets },
  });
  jsonOut({ removed: removed.name, removed_secret_count: removedSecrets });
}

async function cmdValidate(): Promise<void> {
  const store = await InventoryStore.open();
  const all = store.all();
  const sshHosts = (await loadSshConfigHostAliases()).aliases;
  const problems: Array<{ server: string; severity: string; message: string }> = [];
  for (const s of all) {
    if (!s.ssh_alias && !s.host) {
      problems.push({ server: s.name, severity: "error", message: "no ssh_alias or host" });
    }
    if (s.ssh_alias && !sshHosts.has(s.ssh_alias)) {
      problems.push({
        server: s.name,
        severity: "warning",
        message: `ssh_alias "${s.ssh_alias}" not in ~/.ssh/config`,
      });
    }
    if (s.identity_file) {
      const resolved = path.resolve(expandHome(s.identity_file));
      try {
        const st = await fs.stat(resolved);
        if (st.mode & 0o4) {
          problems.push({
            server: s.name,
            severity: "warning",
            message: `${resolved} is world-readable`,
          });
        }
      } catch (err) {
        problems.push({
          server: s.name,
          severity: "error",
          message: `${resolved} not found: ${(err as Error).message}`,
        });
      }
    }
  }
  jsonOut({ checked: all.length, problems, ok: problems.every((p) => p.severity !== "error") });
}

async function cmdPaths(): Promise<void> {
  const store = await InventoryStore.open();
  const sec = defaultSecretsStore();
  const secretsByServer = await sec.listAll().catch(() => ({}));
  const info = await sec.describe();
  const report = await buildPathsReport({
    servers: store.all(),
    inventoryPath: resolveInventoryPath(),
    secretsPath: resolveSecretsPath(),
    secretsBackend: info.backend,
    secretsMasterKey: info.master_key,
    auditLogPath: resolveAuditLogPath(),
    secretsByServer,
  });
  jsonOut(report);
}

async function cmdInfo(): Promise<void> {
  const store = await InventoryStore.open();
  const sec = defaultSecretsStore();
  const all = store.all();
  const sIdx = await sec.listAll().catch(() => ({}));
  jsonOut({
    inventory_path: resolveInventoryPath(),
    secrets_path: resolveSecretsPath(),
    audit_log_path: resolveAuditLogPath(),
    server_count: all.length,
    group_count: store.groups().length,
    tag_count: store.tags().length,
    servers_with_secrets: Object.keys(sIdx).length,
    total_secret_keys: Object.values(sIdx).reduce((n, arr) => n + arr.length, 0),
  });
}

async function cmdSecret(sub: string, rest: string[]): Promise<void> {
  const sec = defaultSecretsStore();
  switch (sub) {
    case "set": {
      const [server, key] = rest;
      if (!server || !key) throw new Error("Usage: secret set <server> <key>  (value via stdin)");
      const value = await readStdin();
      if (!value) throw new Error("Empty value on stdin. Pipe the secret in: echo -n 'pw' | server-inv secret set <s> <k>");
      await sec.set(server, key, value);
      await audit({ tool: "cli:set_secret", server, key, ok: true });
      jsonOut({ server, key, stored: true, value_length: value.length });
      return;
    }
    case "get": {
      const [server, key] = rest;
      if (!server || !key) throw new Error("Usage: secret get <server> <key>");
      const v = await sec.get(server, key);
      if (v === null) {
        process.exitCode = 1;
        process.stderr.write(`No secret "${key}" for server "${server}".\n`);
        return;
      }
      process.stdout.write(v + "\n");
      return;
    }
    case "ls": {
      const [server] = rest;
      if (server) {
        jsonOut({ server, keys: await sec.list(server) });
      } else {
        jsonOut({ by_server: await sec.listAll() });
      }
      return;
    }
    case "rm":
    case "delete": {
      const [server, key] = rest;
      if (!server || !key) throw new Error("Usage: secret rm <server> <key>");
      const removed = await sec.delete(server, key);
      await audit({
        tool: "cli:delete_secret",
        server,
        key,
        ok: true,
        extra: { removed },
      });
      jsonOut({ server, key, removed });
      return;
    }
    default:
      throw new Error(`Unknown secret subcommand: ${sub}`);
  }
}

async function cmdAudit(args: ReturnType<typeof parseArgs>): Promise<void> {
  const limit = parseInt(f1(args.flags, "limit") ?? "50", 10);
  const filePath = resolveAuditLogPath();
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      jsonOut({ path: filePath, entries: [], note: "no audit log yet" });
      return;
    }
    throw err;
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const entries = lines.slice(-limit).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { raw: l };
    }
  });
  jsonOut({ path: filePath, total_lines: lines.length, entries });
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return;
  }

  const args = parseArgs(rest);

  switch (cmd) {
    case "ls":
    case "list":
      return cmdList(args);
    case "get":
      return cmdGet(args.positional[0] ?? throwUsage("get <name>"));
    case "groups":
      return cmdGroups();
    case "tags":
      return cmdTags();
    case "targets":
      return cmdTargets(args);
    case "add":
      return cmdAdd(args.positional[0] ?? throwUsage("add <name> [opts]"), args);
    case "update":
      return cmdUpdate(args.positional[0] ?? throwUsage("update <name> [opts]"), args);
    case "rm":
    case "remove":
      return cmdRm(args.positional[0] ?? throwUsage("rm <name>"));
    case "validate":
      return cmdValidate();
    case "paths":
      return cmdPaths();
    case "info":
      return cmdInfo();
    case "secret":
      return cmdSecret(args.positional[0] ?? throwUsage("secret <set|get|ls|rm>"), args.positional.slice(1));
    case "audit":
      return cmdAudit(args);
    default:
      throw new Error(`Unknown command: ${cmd}\n\n${HELP}`);
  }
}

function throwUsage(usage: string): never {
  throw new Error(`Usage: server-inv ${usage}`);
}

main().catch((err) => {
  process.stderr.write(`server-inv: ${(err as Error).message}\n`);
  process.exit(1);
});
