/**
 * Append-only audit log of every mutation made through the MCP server.
 *
 * Each line is a single JSON object so the log is grep-able and
 * jq-friendly:
 *
 *   {"ts":"2026-05-26T00:42:15.881Z","tool":"set_secret",
 *    "server":"lp-web-1","key":"password","ok":true}
 *
 * Secret VALUES are never written. Only the action + identifiers
 * (server name + key name) + outcome are recorded. That gives the
 * user a real-after-the-fact trail without turning the log into
 * another secret store.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveAuditLogPath } from "./inventory.js";

export interface AuditEntry {
  ts: string;
  tool: string;
  server?: string;
  key?: string;
  rename_to?: string;
  ok: boolean;
  error?: string;
  extra?: Record<string, unknown>;
}

let auditChain: Promise<unknown> = Promise.resolve();

/** Append one structured entry to the audit log. */
export function audit(entry: Omit<AuditEntry, "ts">): Promise<void> {
  const full: AuditEntry = { ts: new Date().toISOString(), ...entry };
  // Serialize writes so concurrent calls produce well-formed lines.
  auditChain = auditChain.then(() => writeOne(full)).catch(() => undefined);
  return auditChain as Promise<void>;
}

async function writeOne(entry: AuditEntry): Promise<void> {
  const filePath = resolveAuditLogPath();
  const line = JSON.stringify(entry) + "\n";
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, line, { mode: 0o600 });
  } catch (err) {
    // Audit failures must never break the actual operation. Log to
    // stderr so the user can spot them but keep going.
    process.stderr.write(
      `[server-inventory-mcp] audit append failed: ${(err as Error).message}\n`,
    );
  }
}

/**
 * Higher-order helper: wrap a tool handler so success and failure both
 * land in the audit log automatically. The fields argument is whatever
 * identifying info the audit line should carry beyond the tool name.
 */
export async function withAudit<T>(
  tool: string,
  fields: Omit<AuditEntry, "ts" | "tool" | "ok" | "error">,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fn();
    await audit({ tool, ...fields, ok: true });
    return result;
  } catch (err) {
    await audit({
      tool,
      ...fields,
      ok: false,
      error: (err as Error).message,
    });
    throw err;
  }
}
