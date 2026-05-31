import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPathsReport, expandHome } from "../dist/paths.js";
import { normalizeServer } from "../dist/inventory.js";

function tmpFile(name) {
  return path.join(
    os.tmpdir(),
    `paths-${process.pid}-${Math.random().toString(16).slice(2)}-${name}`,
  );
}

test("expandHome handles ~ / ~/ / non-tilde", () => {
  assert.equal(expandHome("~/.ssh/key"), path.join(os.homedir(), ".ssh/key"));
  assert.equal(expandHome("~"), os.homedir());
  assert.equal(expandHome("/abs/path"), "/abs/path");
  assert.equal(expandHome("rel/path"), "rel/path");
});

test("buildPathsReport ties servers to keys, aliases, secrets", async () => {
  const inv = tmpFile("p-inv.json");
  const sec = tmpFile("p-sec.enc");
  const aud = tmpFile("p-aud.log");
  await fs.writeFile(inv, "{}", { mode: 0o600 });

  const keyFile = tmpFile("p-key");
  await fs.writeFile(keyFile, "FAKEKEY", { mode: 0o600 });

  const servers = [
    normalizeServer({
      name: "a",
      ssh_alias: "alias-defined-nowhere",
      groups: [],
      tags: [],
    }),
    normalizeServer({
      name: "b",
      host: "b.example",
      user: "u",
      identity_file: keyFile,
      groups: [],
      tags: [],
    }),
  ];

  const report = await buildPathsReport({
    servers,
    inventoryPath: inv,
    secretsPath: sec,
    secretsBackend: "test-backend",
    secretsMasterKey: "test-master-key",
    auditLogPath: aud,
    secretsByServer: { a: ["password"] },
  });

  assert.equal(report.inventory.path, inv);
  assert.equal(report.inventory.exists, true);
  assert.equal(report.secrets.path, sec);
  assert.equal(report.secrets.exists, false);
  assert.equal(report.secrets.backend, "test-backend");
  assert.equal(report.secrets.master_key, "test-master-key");
  assert.equal(report.audit_log.path, aud);
  assert.equal(report.audit_log.exists, false);

  const a = report.per_server.find((r) => r.name === "a");
  assert.equal(a.ssh_alias, "alias-defined-nowhere");
  assert.deepEqual(a.secret_keys, ["password"]);
  const b = report.per_server.find((r) => r.name === "b");
  assert.equal(b.ssh_target, "u@b.example");
  assert.equal(b.identity_file_resolved, path.resolve(keyFile));

  const keyEntry = report.identity_files.find((e) => e.path === path.resolve(keyFile));
  assert.ok(keyEntry, "identity_files lists the referenced key");
  assert.deepEqual(keyEntry.used_by, ["b"]);

  const aliasEntry = report.ssh_aliases.find((e) => e.alias === "alias-defined-nowhere");
  assert.ok(aliasEntry, "ssh_aliases lists the alias");
  assert.equal(aliasEntry.defined_in_ssh_config, false);

  await fs.rm(inv, { force: true });
  await fs.rm(keyFile, { force: true });
});

test("buildPathsReport warns about world-readable identity files", async () => {
  const inv = tmpFile("p-inv2.json");
  const keyFile = tmpFile("p-bad-key");
  await fs.writeFile(keyFile, "FAKEKEY", { mode: 0o644 }); // world-readable

  const servers = [
    normalizeServer({
      name: "x",
      host: "x.example",
      identity_file: keyFile,
      groups: [],
      tags: [],
    }),
  ];
  const report = await buildPathsReport({
    servers,
    inventoryPath: inv,
    secretsPath: tmpFile("p-sec2.enc"),
    secretsBackend: "x",
    secretsMasterKey: "x",
    auditLogPath: tmpFile("p-aud2.log"),
    secretsByServer: {},
  });
  const entry = report.identity_files.find((e) => e.path === path.resolve(keyFile));
  assert.ok(entry?.warning?.includes("world-readable"), "warns about chmod");
  await fs.rm(keyFile, { force: true });
});

test("expandHome returns absolute path for bare ~", () => {
  assert.equal(expandHome("~"), os.homedir());
});

test("expandHome leaves relative paths untouched", () => {
  assert.equal(expandHome("relative/path"), "relative/path");
});

test("buildPathsReport lists no identity files when none referenced", async () => {
  const inv = tmpFile("p-inv3.json");
  await fs.writeFile(inv, "{}", { mode: 0o600 });

  const servers = [
    normalizeServer({
      name: "no-key",
      ssh_alias: "alias-only",
      groups: [],
      tags: [],
    }),
  ];
  const report = await buildPathsReport({
    servers,
    inventoryPath: inv,
    secretsPath: tmpFile("p-sec3.enc"),
    secretsBackend: "test",
    secretsMasterKey: "test",
    auditLogPath: tmpFile("p-aud3.log"),
    secretsByServer: {},
  });
  assert.deepEqual(report.identity_files, []);
  assert.deepEqual(report.ssh_aliases, [
    { alias: "alias-only", defined_in_ssh_config: false, used_by: ["no-key"] },
  ]);

  await fs.rm(inv, { force: true });
});

test("buildPathsReport marks missing inventory file correctly", async () => {
  const inv = tmpFile("p-inv4-missing.json");
  await fs.rm(inv, { force: true });

  const report = await buildPathsReport({
    servers: [],
    inventoryPath: inv,
    secretsPath: tmpFile("p-sec4.enc"),
    secretsBackend: "test",
    secretsMasterKey: "test",
    auditLogPath: tmpFile("p-aud4.log"),
    secretsByServer: {},
  });
  assert.equal(report.inventory.exists, false);
  assert.equal(report.inventory.path, inv);
});

test("buildPathsReport includes per_server secret_keys", async () => {
  const inv = tmpFile("p-inv5.json");
  await fs.writeFile(inv, "{}", { mode: 0o600 });

  const servers = [
    normalizeServer({
      name: "srv-with-secrets",
      host: "1.2.3.4",
      groups: [],
      tags: [],
    }),
  ];
  const report = await buildPathsReport({
    servers,
    inventoryPath: inv,
    secretsPath: tmpFile("p-sec5.enc"),
    secretsBackend: "env",
    secretsMasterKey: "scrypt",
    auditLogPath: tmpFile("p-aud5.log"),
    secretsByServer: { "srv-with-secrets": ["password", "api_token"] },
  });
  const ps = report.per_server.find((p) => p.name === "srv-with-secrets");
  assert.ok(ps);
  assert.deepEqual(ps.secret_keys, ["password", "api_token"]);

  await fs.rm(inv, { force: true });
});

test("buildPathsReport populates ssh_target for alias servers", async () => {
  const inv = tmpFile("p-inv6.json");
  await fs.writeFile(inv, "{}", { mode: 0o600 });

  const servers = [
    normalizeServer({
      name: "alias-server",
      ssh_alias: "my-prod-db",
      groups: [],
      tags: [],
    }),
  ];
  const report = await buildPathsReport({
    servers,
    inventoryPath: inv,
    secretsPath: tmpFile("p-sec6.enc"),
    secretsBackend: "test",
    secretsMasterKey: "test",
    auditLogPath: tmpFile("p-aud6.log"),
    secretsByServer: {},
  });
  const ps = report.per_server.find((p) => p.name === "alias-server");
  assert.equal(ps.ssh_target, "my-prod-db");
  assert.equal(ps.ssh_alias, "my-prod-db");

  await fs.rm(inv, { force: true });
});
