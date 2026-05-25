/**
 * Encrypted secrets storage for the inventory.
 *
 * Goals:
 *   - Secret values never appear in the public inventory.json on disk.
 *   - On macOS we anchor the master key in the user's login Keychain so the
 *     agent never needs to know a passphrase and the user is prompted at
 *     most once per machine (Always Allow).
 *   - On Linux / Windows / non-keychain hosts, derive the master key from a
 *     passphrase env var (SERVER_INVENTORY_PASSPHRASE) via scrypt.
 *   - All secret values live in a single AES-256-GCM file so we get one
 *     atomic write + tamper detection (auth tag) for the whole store.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, platform } from "node:os";
import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";

// createCipheriv is used in writeAll; the import is intentionally kept.

const exec = promisify(execFile);

// ---------- master key providers ----------

export interface MasterKeyProvider {
  /** Return (creating if needed) the 32-byte AES-256-GCM key. */
  getOrCreate(): Promise<Buffer>;
  /** Return the same key if it already exists, else null (no side effects). */
  peek(): Promise<Buffer | null>;
  /** Human-readable location for paths_report. */
  describe(): string;
}

/**
 * Stores a random 32-byte key as a generic password in the macOS login
 * keychain. -A makes it readable without further prompts after the user's
 * one-time "Always Allow" — that's the macOS convention used by every
 * developer-tool credential manager (gh, brew, npm, etc.).
 */
export class MacKeychainMasterKey implements MasterKeyProvider {
  constructor(
    private service = "server-inventory-mcp",
    private account = "master-key",
  ) {}

  async peek(): Promise<Buffer | null> {
    try {
      const { stdout } = await exec("security", [
        "find-generic-password",
        "-s",
        this.service,
        "-a",
        this.account,
        "-w",
      ]);
      return Buffer.from(stdout.trim(), "hex");
    } catch {
      return null;
    }
  }

  async getOrCreate(): Promise<Buffer> {
    const existing = await this.peek();
    if (existing) return existing;
    const key = randomBytes(32);
    await exec("security", [
      "add-generic-password",
      "-s",
      this.service,
      "-a",
      this.account,
      "-w",
      key.toString("hex"),
      "-U", // update if exists (defensive)
      "-A", // allow all apps to read (so subsequent runs don't prompt)
    ]);
    return key;
  }

  describe(): string {
    return `macOS Keychain (service="${this.service}", account="${this.account}")`;
  }

  async destroy(): Promise<void> {
    try {
      await exec("security", [
        "delete-generic-password",
        "-s",
        this.service,
        "-a",
        this.account,
      ]);
    } catch {
      /* not found is fine */
    }
  }
}

/**
 * Derives a 32-byte key from a passphrase read from an environment variable
 * via scrypt. Same passphrase → same key (deterministic), so the file is
 * portable as long as the env var is set on every machine that reads it.
 */
export class EnvPassphraseMasterKey implements MasterKeyProvider {
  constructor(private envName = "SERVER_INVENTORY_PASSPHRASE") {}

  async peek(): Promise<Buffer | null> {
    const passphrase = process.env[this.envName];
    if (!passphrase) return null;
    return this.derive(passphrase);
  }

  async getOrCreate(): Promise<Buffer> {
    const existing = await this.peek();
    if (existing) return existing;
    throw new Error(
      `Secrets storage requires the ${this.envName} environment variable to be set ` +
        `to a strong passphrase. The MCP server then derives a stable AES key from it.`,
    );
  }

  describe(): string {
    return `env var ${this.envName} (scrypt-derived)`;
  }

  private derive(passphrase: string): Buffer {
    // Fixed salt → deterministic key. The threat model assumes the file is
    // not exfiltrated AND the passphrase is strong; if either fails we lose
    // anyway. Using a fixed salt keeps "set env var on new machine, decrypt
    // existing file" working.
    const salt = Buffer.from("server-inventory-mcp:v1:scrypt-salt", "utf8");
    const N = 1 << 15; // 32768
    const r = 8;
    const p = 1;
    // Node's default maxmem is 32MB; this scrypt config needs ~33MB.
    // Bump the cap explicitly so the call doesn't get rejected.
    const maxmem = 64 * 1024 * 1024;
    return scryptSync(passphrase, salt, 32, { N, r, p, maxmem });
  }
}

export function defaultMasterKey(): MasterKeyProvider {
  if (process.env.SERVER_INVENTORY_PASSPHRASE) {
    return new EnvPassphraseMasterKey();
  }
  if (platform() === "darwin") return new MacKeychainMasterKey();
  return new EnvPassphraseMasterKey(); // throws on first use until env is set
}

// ---------- secrets store ----------

export interface SecretsBackendInfo {
  backend: string;
  location: string;
  master_key: string;
  exists: boolean;
}

export interface SecretsStore {
  set(server: string, key: string, value: string): Promise<void>;
  get(server: string, key: string): Promise<string | null>;
  list(server: string): Promise<string[]>;
  listAll(): Promise<Record<string, string[]>>;
  delete(server: string, key: string): Promise<boolean>;
  deleteServer(server: string): Promise<number>;
  describe(): Promise<SecretsBackendInfo>;
}

interface SecretsFileWrapper {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string; // hex (12 bytes)
  tag: string; // hex (16 bytes)
  ciphertext: string; // hex
  // associated data: literal "server-inventory-mcp:v1" — provides domain
  // separation so the same key can't be tricked into reading an attacker's
  // ciphertext from a different application.
}

const AAD = Buffer.from("server-inventory-mcp:v1", "utf8");

type SecretsMap = Record<string, Record<string, string>>;

let secretsChain: Promise<unknown> = Promise.resolve();
export function withSecretsLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = secretsChain.then(fn, fn);
  secretsChain = next.catch(() => undefined);
  return next;
}

export class EncryptedFileSecretsStore implements SecretsStore {
  constructor(
    public readonly filePath: string,
    public readonly masterKey: MasterKeyProvider,
  ) {}

  // ---- low-level encrypted file io ----

  private async readAll(): Promise<SecretsMap> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
    const wrapper = JSON.parse(raw) as SecretsFileWrapper;
    if (wrapper.version !== 1) {
      throw new Error(
        `Unsupported secrets file version: ${wrapper.version}. Expected 1.`,
      );
    }
    if (wrapper.algorithm !== "aes-256-gcm") {
      throw new Error(
        `Unsupported algorithm: ${wrapper.algorithm}. Expected aes-256-gcm.`,
      );
    }
    const key = await this.masterKey.getOrCreate();
    const iv = Buffer.from(wrapper.iv, "hex");
    const tag = Buffer.from(wrapper.tag, "hex");
    const ciphertext = Buffer.from(wrapper.ciphertext, "hex");
    if (iv.length !== 12) throw new Error("Corrupt secrets file: bad IV length.");
    if (tag.length !== 16) throw new Error("Corrupt secrets file: bad tag length.");
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(AAD);
    d.setAuthTag(tag);
    let plain: Buffer;
    try {
      plain = Buffer.concat([d.update(ciphertext), d.final()]);
    } catch {
      throw new Error(
        "Failed to decrypt secrets file. The master key may be wrong (passphrase changed?) or the file may be corrupt.",
      );
    }
    return JSON.parse(plain.toString("utf8")) as SecretsMap;
  }

  private async writeAll(map: SecretsMap): Promise<void> {
    const key = await this.masterKey.getOrCreate();
    if (key.length !== 32) {
      throw new Error(`Master key must be 32 bytes, got ${key.length}.`);
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(AAD);
    const plaintext = Buffer.from(JSON.stringify(map), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrapper: SecretsFileWrapper = {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      ciphertext: ciphertext.toString("hex"),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${randomBytes(6).toString("hex")}.tmp`,
    );
    await fs.writeFile(tmp, JSON.stringify(wrapper, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  // ---- public API ----

  async set(server: string, key: string, value: string): Promise<void> {
    assertId(server, "server");
    assertId(key, "key");
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("Secret value must be a non-empty string.");
    }
    const map = await this.readAll();
    if (!map[server]) map[server] = {};
    map[server][key] = value;
    await this.writeAll(map);
  }

  async get(server: string, key: string): Promise<string | null> {
    const map = await this.readAll();
    return map[server]?.[key] ?? null;
  }

  async list(server: string): Promise<string[]> {
    const map = await this.readAll();
    return Object.keys(map[server] ?? {}).sort();
  }

  async listAll(): Promise<Record<string, string[]>> {
    const map = await this.readAll();
    const out: Record<string, string[]> = {};
    for (const [s, m] of Object.entries(map)) out[s] = Object.keys(m).sort();
    return out;
  }

  async delete(server: string, key: string): Promise<boolean> {
    const map = await this.readAll();
    if (!map[server] || !(key in map[server])) return false;
    delete map[server][key];
    if (Object.keys(map[server]).length === 0) delete map[server];
    await this.writeAll(map);
    return true;
  }

  async deleteServer(server: string): Promise<number> {
    const map = await this.readAll();
    const n = Object.keys(map[server] ?? {}).length;
    if (n === 0) return 0;
    delete map[server];
    await this.writeAll(map);
    return n;
  }

  async describe(): Promise<SecretsBackendInfo> {
    let exists = false;
    try {
      await fs.access(this.filePath);
      exists = true;
    } catch {
      /* not yet */
    }
    return {
      backend: "encrypted-file (aes-256-gcm)",
      location: this.filePath,
      master_key: this.masterKey.describe(),
      exists,
    };
  }
}

// ---------- defaults ----------

export function resolveSecretsPath(): string {
  const fromEnv = process.env.SERVER_INVENTORY_SECRETS_PATH;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.startsWith("~")
      ? path.join(homedir(), fromEnv.slice(1))
      : fromEnv;
  }
  return path.join(homedir(), ".config", "server-inventory", "secrets.enc");
}

let _cached: SecretsStore | null = null;
export function defaultSecretsStore(): SecretsStore {
  if (_cached) return _cached;
  _cached = new EncryptedFileSecretsStore(resolveSecretsPath(), defaultMasterKey());
  return _cached;
}
export function _resetSecretsStoreCacheForTests(): void {
  _cached = null;
}

// ---------- helpers ----------

function assertId(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  if (value.length > 256) {
    throw new Error(`${fieldName} must be 256 characters or fewer.`);
  }
}

/**
 * Constant-time string comparison helper exported for tests / future use
 * (e.g. comparing user-supplied secret previews without short-circuiting).
 */
export function safeEquals(a: string, b: string): boolean {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}
