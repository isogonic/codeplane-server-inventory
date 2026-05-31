import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ServerSchema,
  InventorySchema,
  validateConnectable,
} from "../dist/schema.js";

test("ServerSchema rejects empty name", () => {
  const result = ServerSchema.safeParse({ name: "", host: "x" });
  assert.ok(!result.success);
  const issues = result.error.issues;
  assert.ok(issues.some((i) => i.message.includes("at least 1 character")));
});

test("ServerSchema rejects invalid name characters", () => {
  const bad = (name) => {
    const result = ServerSchema.safeParse({ name, host: "x" });
    assert.ok(!result.success);
    assert.ok(result.error.issues.some((i) => i.message.includes("name may only contain")));
  };
  bad("bad name!");
  bad("bad@name");
  bad("bad name");
});

test("ServerSchema accepts valid names", () => {
  const s = ServerSchema.parse({ name: "good-name_123.v2", host: "x" });
  assert.equal(s.name, "good-name_123.v2");
});

test("ServerSchema rejects negative port", () => {
  const result = ServerSchema.safeParse({ name: "x", port: -1 });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.message.includes("greater")));
});

test("ServerSchema rejects port > 65535", () => {
  const result = ServerSchema.safeParse({ name: "x", port: 65536 });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.message.includes("less")));
});

test("ServerSchema accepts valid port range", () => {
  const s = ServerSchema.parse({ name: "x", port: 22 });
  assert.equal(s.port, 22);
  const s2 = ServerSchema.parse({ name: "x", port: 65535 });
  assert.equal(s2.port, 65535);
});

test("ServerSchema defaults groups and tags to empty arrays", () => {
  const s = ServerSchema.parse({ name: "x", host: "h" });
  assert.deepEqual(s.groups, []);
  assert.deepEqual(s.tags, []);
});

test("validateConnectable throws when both ssh_alias and host are missing", () => {
  assert.throws(
    () => validateConnectable({ name: "x", host: null, ssh_alias: null }),
    /must define either ssh_alias or host/,
  );
});

test("validateConnectable passes when ssh_alias is set", () => {
  validateConnectable({ name: "x", host: null, ssh_alias: "myalias" });
  assert.ok(true);
});

test("validateConnectable passes when host is set", () => {
  validateConnectable({ name: "x", host: "h.example" });
  assert.ok(true);
});

test("InventorySchema accepts empty inventory", () => {
  const inv = InventorySchema.parse({});
  assert.deepEqual(inv.servers, []);
  assert.equal(inv.version, 1);
});

test("InventorySchema rejects negative version", () => {
  const result = InventorySchema.safeParse({ version: -1 });
  assert.ok(!result.success);
});

test("ServerSchema rejects tags array with empty strings", () => {
  const result = ServerSchema.safeParse({ name: "x", host: "h", tags: ["", "ok"] });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.message.includes("at least 1 character")));
});

test("ServerSchema rejects groups array with empty strings", () => {
  const result = ServerSchema.safeParse({ name: "x", host: "h", groups: ["ok", ""] });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.message.includes("at least 1 character")));
});

test("ServerSchema allows optional description, environment, role, notes", () => {
  const s = ServerSchema.parse({
    name: "x",
    host: "h",
    description: "desc",
    environment: "prod",
    role: "web",
    notes: "some notes",
  });
  assert.equal(s.description, "desc");
  assert.equal(s.environment, "prod");
  assert.equal(s.role, "web");
  assert.equal(s.notes, "some notes");
});

test("ServerSchema normalizes nulls for optional string fields", () => {
  const s = ServerSchema.parse({ name: "x", host: "h" });
  assert.equal(s.user, undefined);
  assert.equal(s.identity_file, undefined);
  assert.equal(s.jump_host, undefined);
});
