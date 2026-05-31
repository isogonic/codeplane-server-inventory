import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { classifySshFailure, execEnabled, buildSshArgv } from "../dist/ssh.js";
import { normalizeServer } from "../dist/inventory.js";

// The classifier is the load-bearing piece — keep this table exhaustive,
// because every new "I got an unexpected exit message" debug session in the
// wild should land back here.
test("classifySshFailure — auth_failed", () => {
  assert.equal(
    classifySshFailure(255, "user@host: Permission denied (publickey,password).", false),
    "auth_failed",
  );
});

test("classifySshFailure — dns_failure", () => {
  assert.equal(
    classifySshFailure(255, "ssh: Could not resolve hostname nope.invalid: nodename nor servname provided, or not known", false),
    "dns_failure",
  );
});

test("classifySshFailure — refused", () => {
  assert.equal(
    classifySshFailure(255, "ssh: connect to host 127.0.0.1 port 22: Connection refused", false),
    "refused",
  );
});

test("classifySshFailure — host_key_mismatch wins over auth", () => {
  // Host key mismatch usually comes with Permission denied too; the more
  // specific classification wins.
  assert.equal(
    classifySshFailure(
      255,
      "@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@\nHost key verification failed.\nPermission denied",
      false,
    ),
    "host_key_mismatch",
  );
});

test("classifySshFailure — timeout from stderr", () => {
  assert.equal(
    classifySshFailure(255, "ssh: connect to host 192.0.2.1 port 22: Operation timed out", false),
    "timeout",
  );
});

test("classifySshFailure — timeout from killed child", () => {
  assert.equal(classifySshFailure(null, "", true), "timeout");
});

test("classifySshFailure — unreachable", () => {
  assert.equal(
    classifySshFailure(255, "ssh: connect to host 10.255.255.1 port 22: No route to host", false),
    "unreachable",
  );
});

test("classifySshFailure — unknown falls through", () => {
  assert.equal(
    classifySshFailure(123, "some other error message we haven't seen yet", false),
    "unknown",
  );
});

test("classifySshFailure — empty stderr returns unknown", () => {
  assert.equal(classifySshFailure(1, "", false), "unknown");
});

test("classifySshFailure — null exit with empty stderr returns unknown", () => {
  assert.equal(classifySshFailure(null, "", false), "unknown");
});

test("classifySshFailure — multiple host key lines", () => {
  assert.equal(
    classifySshFailure(255, "Host key verification failed.\nPermission denied (publickey).", false),
    "host_key_mismatch",
  );
});

test("buildSshArgv with alias returns simple target", () => {
  const s = normalizeServer({
    name: "x",
    ssh_alias: "myalias",
    groups: [],
    tags: [],
  });
  const { target, argv } = buildSshArgv(s, 5);
  assert.equal(target, "myalias");
  assert.ok(argv.includes("BatchMode=yes"));
  assert.ok(argv.includes("ConnectTimeout=5"));
  assert.ok(argv.includes("StrictHostKeyChecking=accept-new"));
  assert.ok(!argv.includes("-i"), "no identity for alias");
  assert.ok(!argv.includes("-p"), "no port for alias");
  assert.ok(!argv.includes("-J"), "no jump for alias");
});

test("buildSshArgv without alias inlines identity, port, jump", () => {
  const s = normalizeServer({
    name: "x",
    host: "10.0.0.1",
    user: "ops",
    port: 2222,
    identity_file: "~/.ssh/ops_key",
    jump_host: "bastion@jump",
    groups: [],
    tags: [],
  });
  const { target, argv } = buildSshArgv(s, 10);
  assert.equal(target, "ops@10.0.0.1");
  assert.ok(argv.includes("-i"));
  assert.ok(argv.includes(path.resolve(os.homedir(), ".ssh/ops_key")));
  assert.ok(argv.includes("-p"));
  assert.ok(argv.includes("2222"));
  assert.ok(argv.includes("-J"));
  assert.ok(argv.includes("bastion@jump"));
});

test("buildSshArgv without user falls back to host-only target", () => {
  const s = normalizeServer({
    name: "x",
    host: "10.0.0.1",
    groups: [],
    tags: [],
  });
  const { target } = buildSshArgv(s, 5);
  assert.equal(target, "10.0.0.1");
});

test("buildSshArgv appends extra ssh options", () => {
  const s = normalizeServer({
    name: "x",
    host: "h.example",
    groups: [],
    tags: [],
  });
  const { argv } = buildSshArgv(s, 5, ["LogLevel=ERROR", "ForwardAgent=yes"]);
  assert.ok(argv.includes("-o"));
  assert.ok(argv.includes("LogLevel=ERROR"));
  assert.ok(argv.includes("-o"));
  assert.ok(argv.includes("ForwardAgent=yes"));
});

test("classifySshFailure handles permission denied with other text", () => {
  assert.equal(
    classifySshFailure(255, "ssh: connect to host 10.0.0.1 port 22: Permission denied (publickey,password).", false),
    "auth_failed",
  );
});

test("execEnabled reads SERVER_INVENTORY_ALLOW_EXEC from env", () => {
  const original = process.env.SERVER_INVENTORY_ALLOW_EXEC;
  process.env.SERVER_INVENTORY_ALLOW_EXEC = "1";
  assert.equal(execEnabled(), true);
  process.env.SERVER_INVENTORY_ALLOW_EXEC = "0";
  assert.equal(execEnabled(), false);
  if (original === undefined) delete process.env.SERVER_INVENTORY_ALLOW_EXEC;
  else process.env.SERVER_INVENTORY_ALLOW_EXEC = original;
});

test("execEnabled returns false when env var is unset", () => {
  const original = process.env.SERVER_INVENTORY_ALLOW_EXEC;
  delete process.env.SERVER_INVENTORY_ALLOW_EXEC;
  assert.equal(execEnabled(), false);
  if (original !== undefined) process.env.SERVER_INVENTORY_ALLOW_EXEC = original;
});
