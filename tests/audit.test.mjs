import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  audit,
  withAudit,
} from "../dist/audit.js";

function tmpFile(name) {
  return path.join(
    tmpdir(),
    `audit-${process.pid}-${Math.random().toString(16).slice(2)}-${name}`,
  );
}

test("audit appends one JSON line per call", async () => {
  const p = tmpFile("single.log");
  await fs.rm(p, { force: true });

  const originalLog = process.env.SERVER_INVENTORY_AUDIT_LOG;
  process.env.SERVER_INVENTORY_AUDIT_LOG = p;

  await audit({ tool: "set_secret", server: "srv", key: "pw", ok: true });

  const lines = (await fs.readFile(p, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.tool, "set_secret");
  assert.equal(entry.server, "srv");
  assert.equal(entry.key, "pw");
  assert.equal(entry.ok, true);
  assert.ok(entry.ts, "timestamp is present");
  assert.equal(entry.error, undefined);

  await fs.rm(p, { force: true });
  if (originalLog === undefined) delete process.env.SERVER_INVENTORY_AUDIT_LOG;
  else process.env.SERVER_INVENTORY_AUDIT_LOG = originalLog;
});

test("audit records failure with error message", async () => {
  const p = tmpFile("fail.log");
  await fs.rm(p, { force: true });

  const originalLog = process.env.SERVER_INVENTORY_AUDIT_LOG;
  process.env.SERVER_INVENTORY_AUDIT_LOG = p;

  await audit({
    tool: "add_server",
    server: "bad",
    ok: false,
    error: "name already taken",
  });

  const lines = (await fs.readFile(p, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.ok, false);
  assert.equal(entry.error, "name already taken");

  await fs.rm(p, { force: true });
  if (originalLog === undefined) delete process.env.SERVER_INVENTORY_AUDIT_LOG;
  else process.env.SERVER_INVENTORY_AUDIT_LOG = originalLog;
});

test("audit serializes concurrent writes without interleaving", async () => {
  const p = tmpFile("concurrent.log");
  await fs.rm(p, { force: true });

  const originalLog = process.env.SERVER_INVENTORY_AUDIT_LOG;
  process.env.SERVER_INVENTORY_AUDIT_LOG = p;

  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(
      audit({
        tool: "concurrent_test",
        server: `srv-${i}`,
        key: `key-${i}`,
        ok: i % 3 === 0,
        error: i % 3 !== 0 ? "simulated failure" : undefined,
        extra: { index: i },
      }),
    );
  }
  await Promise.all(promises);

  const raw = await fs.readFile(p, "utf8");
  const lines = raw.trim().split("\n");
  assert.equal(lines.length, 50, "50 entries written");

  const parsed = lines.map((l) => JSON.parse(l));
  const servers = parsed.map((e) => e.server);
  assert.deepEqual(servers, Array.from({ length: 50 }, (_, i) => `srv-${i}`));

  await fs.rm(p, { force: true });
  if (originalLog === undefined) delete process.env.SERVER_INVENTORY_AUDIT_LOG;
  else process.env.SERVER_INVENTORY_AUDIT_LOG = originalLog;
});

test("audit creates parent directory if missing", async () => {
  const dir = path.join(tmpdir(), `audit-dir-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const p = path.join(dir, "audit.log");
  await fs.rm(dir, { force: true, recursive: true });

  const originalLog = process.env.SERVER_INVENTORY_AUDIT_LOG;
  process.env.SERVER_INVENTORY_AUDIT_LOG = p;

  await audit({ tool: "mkdir_test", ok: true });

  assert.ok(await fs.stat(p).then((s) => s.isFile()), "file created in new dir");

  await fs.rm(dir, { force: true, recursive: true });
  if (originalLog === undefined) delete process.env.SERVER_INVENTORY_AUDIT_LOG;
  else process.env.SERVER_INVENTORY_AUDIT_LOG = originalLog;
});

test("audit does not throw on disk full / permission error", async () => {
  const p = tmpFile("readonly.log");
  await fs.writeFile(p, "");

  const originalLog = process.env.SERVER_INVENTORY_AUDIT_LOG;
  process.env.SERVER_INVENTORY_AUDIT_LOG = p;

  await fs.chmod(p, 0o000);
  try {
    await audit({ tool: "should_not_fail", ok: true });
    assert.ok(true, "audit swallowed the write error");
  } finally {
    await fs.chmod(p, 0o600);
    await fs.rm(p, { force: true });
    if (originalLog === undefined) delete process.env.SERVER_INVENTORY_AUDIT_LOG;
    else process.env.SERVER_INVENTORY_AUDIT_LOG = originalLog;
  }
});

test("withAudit wraps success and logs ok:true", async () => {
  const p = tmpFile("withaudit.log");
  await fs.rm(p, { force: true });

  const originalLog = process.env.SERVER_INVENTORY_AUDIT_LOG;
  process.env.SERVER_INVENTORY_AUDIT_LOG = p;

  const result = await withAudit(
    "test_tool",
    { server: "srv", key: "k" },
    async () => "success-value",
  );
  assert.equal(result, "success-value");

  const lines = (await fs.readFile(p, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.ok, true);
  assert.equal(entry.tool, "test_tool");

  await fs.rm(p, { force: true });
  if (originalLog === undefined) delete process.env.SERVER_INVENTORY_AUDIT_LOG;
  else process.env.SERVER_INVENTORY_AUDIT_LOG = originalLog;
});

test("withAudit logs failure and rethrows", async () => {
  const p = tmpFile("withaudit-fail.log");
  await fs.rm(p, { force: true });

  const originalLog = process.env.SERVER_INVENTORY_AUDIT_LOG;
  process.env.SERVER_INVENTORY_AUDIT_LOG = p;

  let thrown;
  try {
    await withAudit(
      "failing_tool",
      { server: "srv" },
      async () => {
        throw new Error("intentional");
      },
    );
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown, "error was rethrown");
  assert.equal(thrown.message, "intentional");

  const lines = (await fs.readFile(p, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.ok, false);
  assert.equal(entry.error, "intentional");

  await fs.rm(p, { force: true });
  if (originalLog === undefined) delete process.env.SERVER_INVENTORY_AUDIT_LOG;
  else process.env.SERVER_INVENTORY_AUDIT_LOG = originalLog;
});

test("audit entries contain valid ISO timestamps", async () => {
  const p = tmpFile("ts.log");
  await fs.rm(p, { force: true });

  const originalLog = process.env.SERVER_INVENTORY_AUDIT_LOG;
  process.env.SERVER_INVENTORY_AUDIT_LOG = p;

  await audit({ tool: "ts_test", ok: true });
  const raw = await fs.readFile(p, "utf8");
  const entry = JSON.parse(raw);
  const d = new Date(entry.ts);
  assert.ok(!Number.isNaN(d.getTime()), "timestamp is a valid date");

  await fs.rm(p, { force: true });
  if (originalLog === undefined) delete process.env.SERVER_INVENTORY_AUDIT_LOG;
  else process.env.SERVER_INVENTORY_AUDIT_LOG = originalLog;
});

test("audit handles optional fields: rename_to and extra", async () => {
  const p = tmpFile("extra.log");
  await fs.rm(p, { force: true });

  const originalLog = process.env.SERVER_INVENTORY_AUDIT_LOG;
  process.env.SERVER_INVENTORY_AUDIT_LOG = p;

  await audit({
    tool: "update_server",
    server: "old",
    rename_to: "new",
    ok: true,
    extra: { old_groups: ["g1"], new_groups: ["g2"] },
  });

  const raw = await fs.readFile(p, "utf8");
  const entry = JSON.parse(raw);
  assert.equal(entry.rename_to, "new");
  assert.deepEqual(entry.extra, { old_groups: ["g1"], new_groups: ["g2"] });

  await fs.rm(p, { force: true });
  if (originalLog === undefined) delete process.env.SERVER_INVENTORY_AUDIT_LOG;
  else process.env.SERVER_INVENTORY_AUDIT_LOG = originalLog;
});
