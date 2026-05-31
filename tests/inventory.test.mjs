import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  InventoryStore,
  buildSshCommand,
  buildSshTarget,
  filterServers,
  loadInventory,
  normalizeServer,
  saveInventory,
} from "../dist/inventory.js";

function tmpFile(name) {
  return path.join(
    os.tmpdir(),
    `inv-${process.pid}-${Math.random().toString(16).slice(2)}-${name}`,
  );
}

test("loadInventory creates an empty file when missing", async () => {
  const p = tmpFile("missing.json");
  await fs.rm(p, { force: true });
  const inv = await loadInventory(p);
  assert.equal(inv.version, 1);
  assert.deepEqual(inv.servers, []);
  const stat = await fs.stat(p);
  assert.ok(stat.isFile(), "file was created on disk");
  await fs.rm(p, { force: true });
});

test("saveInventory writes atomically and sorts by name", async () => {
  const p = tmpFile("save.json");
  await saveInventory(
    {
      version: 1,
      servers: [
        normalizeServer({ name: "z", host: "z.example", groups: [], tags: [] }),
        normalizeServer({ name: "a", host: "a.example", groups: [], tags: [] }),
        normalizeServer({ name: "m", host: "m.example", groups: [], tags: [] }),
      ],
    },
    p,
  );
  const raw = await fs.readFile(p, "utf8");
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed.servers.map((s) => s.name), ["a", "m", "z"]);
  await fs.rm(p, { force: true });
});

test("normalizeServer rejects entries with neither ssh_alias nor host", () => {
  assert.throws(
    () => normalizeServer({ name: "x", groups: [], tags: [] }),
    /must define either ssh_alias or host/,
  );
});

test("normalizeServer dedupes and trims groups and tags", () => {
  const s = normalizeServer({
    name: "x",
    host: "x.example",
    groups: ["a", "a", " b "],
    tags: ["t", "t", "u"],
  });
  assert.deepEqual(s.groups, ["a", "b"]);
  assert.deepEqual(s.tags, ["t", "u"]);
});

test("schema rejects empty-string tags before normalization", () => {
  assert.throws(
    () =>
      normalizeServer({
        name: "x",
        host: "x.example",
        groups: [],
        tags: [""],
      }),
    /at least 1 character/,
  );
});

test("filterServers — group, tag, environment, search", () => {
  const servers = [
    normalizeServer({
      name: "lp-web-1",
      host: "10.0.0.5",
      groups: ["logicplanes", "production"],
      tags: ["web"],
      environment: "production",
    }),
    normalizeServer({
      name: "lp-staging-1",
      host: "10.0.0.6",
      groups: ["logicplanes", "staging"],
      tags: ["web"],
      environment: "staging",
    }),
    normalizeServer({
      name: "other",
      host: "x.example",
      groups: ["misc"],
      tags: ["db"],
    }),
  ];
  assert.deepEqual(
    filterServers(servers, { group: "logicplanes" }).map((s) => s.name),
    ["lp-web-1", "lp-staging-1"],
  );
  assert.deepEqual(
    filterServers(servers, { tag: "db" }).map((s) => s.name),
    ["other"],
  );
  assert.deepEqual(
    filterServers(servers, { environment: "staging" }).map((s) => s.name),
    ["lp-staging-1"],
  );
  assert.deepEqual(
    filterServers(servers, { search: "10.0.0.5" }).map((s) => s.name),
    ["lp-web-1"],
  );
});

test("buildSshTarget / buildSshCommand short-circuit on ssh_alias", () => {
  const s = normalizeServer({
    name: "x",
    ssh_alias: "x-alias",
    user: "ignored",
    port: 9999,
    identity_file: "/ignored/key",
    groups: [],
    tags: [],
  });
  assert.equal(buildSshTarget(s), "x-alias");
  // When alias present, port / identity_file / jump_host are deferred to
  // ~/.ssh/config (so they should NOT appear in the command).
  assert.equal(buildSshCommand(s), "ssh x-alias");
});

test("buildSshCommand inlines port and identity when no alias", () => {
  const s = normalizeServer({
    name: "x",
    host: "x.example",
    user: "ops",
    port: 2222,
    identity_file: "/home/user/.ssh/k",
    jump_host: "bastion@b.example",
    groups: [],
    tags: [],
  });
  assert.equal(buildSshTarget(s), "ops@x.example");
  assert.equal(
    buildSshCommand(s),
    "ssh -i /home/user/.ssh/k -o IdentitiesOnly=yes -p 2222 -J bastion@b.example ops@x.example",
  );
});

test("InventoryStore: add / get / update / remove / rename", async () => {
  const p = tmpFile("crud.json");
  await fs.rm(p, { force: true });
  const store = await InventoryStore.open(p);
  store.add({ name: "a", host: "a.example", groups: ["g"], tags: ["t"] });
  store.add({ name: "b", ssh_alias: "b", groups: ["g"], tags: [] });
  await store.save(p);

  const reopened = await InventoryStore.open(p);
  assert.equal(reopened.all().length, 2);
  assert.equal(reopened.get("a")?.host, "a.example");
  assert.equal(reopened.get("b")?.ssh_alias, "b");

  reopened.update("a", { port: 2222, tags: ["t", "new"] });
  assert.equal(reopened.get("a")?.port, 2222);
  assert.deepEqual(reopened.get("a")?.tags, ["t", "new"]);

  reopened.update("a", { name: "a2" });
  assert.equal(reopened.get("a"), undefined);
  assert.equal(reopened.get("a2")?.port, 2222);

  const removed = reopened.remove("b");
  assert.equal(removed.name, "b");
  assert.equal(reopened.all().length, 1);
  await fs.rm(p, { force: true });
});

test("InventoryStore: groups() and tags() aggregations", async () => {
  const p = tmpFile("agg.json");
  await fs.rm(p, { force: true });
  const store = await InventoryStore.open(p);
  store.add({ name: "a", host: "x", groups: ["g1", "g2"], tags: ["t1"] });
  store.add({ name: "b", host: "x", groups: ["g1"], tags: ["t1", "t2"] });
  store.add({ name: "c", host: "x", groups: [], tags: [] });
  const g = store.groups();
  assert.deepEqual(
    g.map((x) => [x.name, x.count]),
    [
      ["g1", 2],
      ["g2", 1],
    ],
  );
  const t = store.tags();
  assert.deepEqual(
    t.map((x) => [x.name, x.count]),
    [
      ["t1", 2],
      ["t2", 1],
    ],
  );
  await fs.rm(p, { force: true });
});

test("update fails on rename collision", async () => {
  const p = tmpFile("collide.json");
  await fs.rm(p, { force: true });
  const store = await InventoryStore.open(p);
  store.add({ name: "a", host: "x", groups: [], tags: [] });
  store.add({ name: "b", host: "x", groups: [], tags: [] });
  assert.throws(() => store.update("a", { name: "b" }), /already taken/);
  await fs.rm(p, { force: true });
});

test("loadInventory throws on malformed JSON", async () => {
  const p = tmpFile("bad.json");
  await fs.writeFile(p, "{ not json", { mode: 0o600 });
  await assert.rejects(
    () => loadInventory(p),
    /not valid JSON/,
  );
  await fs.rm(p, { force: true });
});

test("loadInventory throws on schema validation failure", async () => {
  const p = tmpFile("schema-bad.json");
  await fs.writeFile(p, JSON.stringify({ version: 1, servers: [{ name: "", host: "x" }] }), { mode: 0o600 });
  await assert.rejects(
    () => loadInventory(p),
    /failed schema validation/,
  );
  await fs.rm(p, { force: true });
});

test("filterServers returns all when no filters match", () => {
  const servers = [
    normalizeServer({ name: "a", host: "x", groups: ["g1"], tags: ["t1"] }),
  ];
  const result = filterServers(servers, {});
  assert.deepEqual(result.map((s) => s.name), ["a"]);
});

test("filterServers returns empty array when no matches", () => {
  const servers = [
    normalizeServer({ name: "a", host: "x", groups: ["g1"], tags: ["t1"] }),
  ];
  const result = filterServers(servers, { group: "nonexistent" });
  assert.deepEqual(result, []);
});

test("search is case-insensitive", () => {
  const servers = [
    normalizeServer({ name: "LP-WEB-1", host: "10.0.0.5", groups: [], tags: [], description: "Primary WEB server" }),
  ];
  const lower = filterServers(servers, { search: "web" }).map((s) => s.name);
  const upper = filterServers(servers, { search: "WEB" }).map((s) => s.name);
  const mixed = filterServers(servers, { search: "Web" }).map((s) => s.name);
  assert.deepEqual(lower, ["LP-WEB-1"]);
  assert.deepEqual(upper, ["LP-WEB-1"]);
  assert.deepEqual(mixed, ["LP-WEB-1"]);
});

test("search matches across all text fields", () => {
  const servers = [
    normalizeServer({
      name: "db-1",
      host: "10.0.0.10",
      user: "dbadmin",
      ssh_alias: null,
      groups: ["databases"],
      tags: ["postgres"],
      environment: "production",
      role: "database",
      notes: "Main PostgreSQL instance",
    }),
  ];
  assert.deepEqual(filterServers(servers, { search: "dbadmin" }).map((s) => s.name), ["db-1"]);
  assert.deepEqual(filterServers(servers, { search: "postgres" }).map((s) => s.name), ["db-1"]);
  assert.deepEqual(filterServers(servers, { search: "production" }).map((s) => s.name), ["db-1"]);
  assert.deepEqual(filterServers(servers, { search: "Main" }).map((s) => s.name), ["db-1"]);
});

test("normalizeServer trims whitespace from all fields", () => {
  const s = normalizeServer({
    name: "spaced",
    host: "  h.example  ",
    user: "  ubuntu  ",
    ssh_alias: "  my-alias  ",
    identity_file: "  ~/.ssh/id_rsa  ",
    jump_host: "  j@b  ",
    groups: ["  g1  ", "  g1  "],
    tags: ["  t1  "],
    description: "  desc  ",
    environment: "  env  ",
    role: "  role  ",
    notes: "  notes  ",
  });
  assert.equal(s.name, "spaced");
  assert.equal(s.host, "h.example");
  assert.equal(s.user, "ubuntu");
  assert.equal(s.ssh_alias, "my-alias");
  assert.equal(s.identity_file, "~/.ssh/id_rsa");
  assert.equal(s.jump_host, "j@b");
  assert.equal(s.description, "desc");
  assert.equal(s.environment, "env");
  assert.equal(s.role, "role");
  assert.equal(s.notes, "notes");
});

test("buildSshCommand omits -i and -p and -J when ssh_alias is set", () => {
  const s = normalizeServer({
    name: "x",
    ssh_alias: "myalias",
    user: "should-be-ignored",
    port: 9999,
    identity_file: "/should-be-ignored/key",
    jump_host: "should-be-ignored@j",
    groups: [],
    tags: [],
  });
  const cmd = buildSshCommand(s);
  assert.equal(cmd, "ssh myalias");
  assert.ok(!cmd.includes("-i"), "no -i for alias");
  assert.ok(!cmd.includes("-p"), "no -p for alias");
  assert.ok(!cmd.includes("-J"), "no -J for alias");
});

test("buildSshCommand appends extra args verbatim", () => {
  const s = normalizeServer({
    name: "x",
    host: "x.example",
    user: "u",
    groups: [],
    tags: [],
  });
  const cmd = buildSshCommand(s, ["-v", "-o", "StrictHostKeyChecking=no"]);
  assert.equal(cmd, "ssh -v -o StrictHostKeyChecking=no u@x.example");
});

test("buildSshTarget returns ssh_alias when set", () => {
  const s = normalizeServer({
    name: "x",
    ssh_alias: "myalias",
    groups: [],
    tags: [],
  });
  assert.equal(buildSshTarget(s), "myalias");
});

test("buildSshTarget falls back to user@host when no alias", () => {
  const s = normalizeServer({
    name: "x",
    host: "h.example",
    user: "ubuntu",
    groups: [],
    tags: [],
  });
  assert.equal(buildSshTarget(s), "ubuntu@h.example");
});

test("buildSshTarget falls back to host-only when no user", () => {
  const s = normalizeServer({
    name: "x",
    host: "h.example",
    groups: [],
    tags: [],
  });
  assert.equal(buildSshTarget(s), "h.example");
});
