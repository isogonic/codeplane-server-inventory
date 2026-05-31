import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { spawn } from "node:child_process";

function tmpFile(name) {
  return path.join(
    os.tmpdir(),
    `cli-${process.pid}-${Math.random().toString(16).slice(2)}-${name}`,
  );
}

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(process.cwd(), "dist", "cli.js");
    const child = spawn("node", [cliPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on("error", reject);
  });
}

async function withFreshEnv() {
  const inv = tmpFile("cli-inv.json");
  const sec = tmpFile("cli-sec.enc");
  const aud = tmpFile("cli-aud.log");
  await fs.rm(inv, { force: true });
  await fs.rm(sec, { force: true });
  await fs.rm(aud, { force: true });
  const env = {
    SERVER_INVENTORY_PATH: inv,
    SERVER_INVENTORY_SECRETS_PATH: sec,
    SERVER_INVENTORY_AUDIT_LOG: aud,
    SERVER_INVENTORY_PASSPHRASE: "cli-test-passphrase",
  };
  return { env, cleanup: async () => {
    await fs.rm(inv, { force: true }).catch(() => {});
    await fs.rm(sec, { force: true }).catch(() => {});
    await fs.rm(aud, { force: true }).catch(() => {});
  }};
}

test("cli: info shows default paths", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    const r = await runCli(["info"], env);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes("cli-inv.json"), "mentions inventory file");
    assert.ok(r.stdout.includes("cli-sec.enc"), "mentions secrets file");
    assert.ok(r.stdout.includes("cli-aud.log"), "mentions audit log");
  } finally {
    await cleanup();
  }
});

test("cli: add then ls then rm round-trip", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    let r = await runCli(["add", "cli-test-1", "--host", "10.1.1.1", "--user", "ubuntu", "--group", "test"], env);
    assert.equal(r.code, 0, `add failed: ${r.stderr}`);

    r = await runCli(["ls"], env);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes("cli-test-1"), "server appears in list");

    r = await runCli(["rm", "cli-test-1"], env);
    assert.equal(r.code, 0);

    r = await runCli(["ls"], env);
    assert.equal(r.code, 0);
    assert.ok(!r.stdout.includes("cli-test-1"), "server removed");
  } finally {
    await cleanup();
  }
});

test("cli: groups aggregates correctly", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    await runCli(["add", "g-a", "--host", "1.1.1.1", "--group", "alpha"], env);
    await runCli(["add", "g-b", "--host", "2.2.2.2", "--group", "alpha"], env);
    await runCli(["add", "g-c", "--host", "3.3.3.3", "--group", "beta"], env);

    const r = await runCli(["groups"], env);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes("alpha"), "alpha group listed");
    assert.ok(r.stdout.includes("beta"), "beta group listed");
    assert.ok(r.stdout.includes("g-a"), "member listed");
  } finally {
    await cleanup();
  }
});

test("cli: tags aggregates correctly", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    await runCli(["add", "t1", "--host", "1.1.1.1", "--tag", "web"], env);
    await runCli(["add", "t2", "--host", "2.2.2.2", "--tag", "web"], env);
    await runCli(["add", "t3", "--host", "3.3.3.3", "--tag", "db"], env);

    const r = await runCli(["tags"], env);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes("web"), "web tag listed");
    assert.ok(r.stdout.includes("db"), "db tag listed");
  } finally {
    await cleanup();
  }
});

test("cli: targets resolves group to ssh commands", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    await runCli(["add", "tgt-1", "--host", "10.0.0.1", "--user", "root", "--group", "default"], env);
    const r = await runCli(["targets", "--group", "default"], env);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes("root@10.0.0.1"), "ssh target printed");
  } finally {
    await cleanup();
  }
});

test("cli: secret set/get round-trip", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    await runCli(["add", "srv-sec", "--host", "5.5.5.5"], env);

    const setProc = spawn("node", [path.join(process.cwd(), "dist", "cli.js"), "secret", "set", "srv-sec", "pw"], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let setStdout = "", setStderr = "";
    setProc.stdout.on("data", (d) => (setStdout += d.toString()));
    setProc.stderr.on("data", (d) => (setStderr += d.toString()));
    setProc.stdin.write("my-secret\n");
    setProc.stdin.end();
    const setOut = await new Promise((res) => {
      setProc.on("close", () => res({ stdout: setStdout, stderr: setStderr, code: setProc.exitCode }));
    });
    assert.equal(setProc.exitCode, 0, `secret set failed: ${setOut.stderr}`);

    const r = await runCli(["secret", "get", "srv-sec", "pw"], env);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "my-secret");
  } finally {
    await cleanup();
  }
});

test("cli: secret rm removes key", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    await runCli(["add", "srv-rm", "--host", "6.6.6.6"], env);
    const setProc = spawn("node", [path.join(process.cwd(), "dist", "cli.js"), "secret", "set", "srv-rm", "tok"], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    setProc.stdin.write("val\n");
    setProc.stdin.end();
    await new Promise((res) => setProc.on("close", res));
    assert.equal(setProc.exitCode, 0);

    const r = await runCli(["secret", "rm", "srv-rm", "tok"], env);
    assert.equal(r.code, 0);

    const r2 = await runCli(["secret", "ls", "srv-rm"], env);
    assert.equal(r2.code, 0);
    assert.ok(!r2.stdout.includes("tok"), "key removed");
  } finally {
    await cleanup();
  }
});

test("cli: get shows server detail and ssh command", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    await runCli(["add", "get-test", "--host", "10.20.30.40", "--user", "deploy", "--port", "2222"], env);
    const r = await runCli(["get", "get-test"], env);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes("10.20.30.40"), "host shown");
    assert.ok(r.stdout.includes("deploy"), "user shown");
    assert.ok(r.stdout.includes("2222"), "port shown");
    assert.ok(r.stdout.includes("ssh"), "ssh command shown");
  } finally {
    await cleanup();
  }
});

test("cli: validate reports status", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    await runCli(["add", "valid-1", "--host", "1.2.3.4"], env);
    const r = await runCli(["validate"], env);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes('"checked": 1'), "checked count present");
    assert.ok(r.stdout.includes('"ok": true'), "validation passes");
  } finally {
    await cleanup();
  }
});

test("cli: audit tail shows entries", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    await runCli(["add", "audit-1", "--host", "7.7.7.7"], env);
    const r = await runCli(["audit"], env);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes("add_server"), "audit mentions add_server");
  } finally {
    await cleanup();
  }
});

test("cli: ssh-check runs probe for group", async () => {
  const { env, cleanup } = await withFreshEnv();
  try {
    await runCli(["add", "ssh-1", "--host", "127.0.0.1", "--user", "nobody", "--group", "default"], env);
    const r = await runCli(["ssh-check", "--group", "default", "--timeout-sec", "1"], env);
    assert.ok(r.stdout.includes("ssh-1"), "server name in output");
    assert.ok(r.stdout.includes('"results"'), "results array present");
  } finally {
    await cleanup();
  }
});

test("cli: missing command prints help-like output", async () => {
  const r = await runCli([]);
  assert.ok(r.code !== 0 || r.stdout.includes("USAGE"), "shows usage on empty args");
});

test("cli: unknown command returns non-zero", async () => {
  const r = await runCli(["totally-unknown-cmd"]);
  assert.ok(r.code !== 0, "unknown command fails");
});
