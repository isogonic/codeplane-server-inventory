# Contributing

Thanks for poking at this. The project is small enough that you can keep
the entire architecture in your head — the only moving parts are:

```
src/
  schema.ts    zod schemas for the inventory shape
  inventory.ts file-backed CRUD + write lock + ssh command builder
  secrets.ts   AES-256-GCM secrets store + Keychain / passphrase master keys
  paths.ts     paths_report builder
  audit.ts    append-only audit log + withAudit wrapper
  index.ts     stdio MCP server, registers every tool
  ssh.ts       ssh_check / exec_on implementation
tests/
  *.test.mjs  node:test unit suites
scripts/
  smoke.mjs   end-to-end JSON-RPC exercise of the built server
```

## Development loop

```bash
npm install
npm run build       # compile TS → dist
npm run test:unit   # node --test tests/*.test.mjs
npm run smoke       # end-to-end MCP smoke
npm test            # build + unit + smoke (what CI runs)
npm run dev         # run the MCP server directly via tsx
```

## Adding a tool

1. Add the handler in `src/index.ts` using `server.registerTool(name, schema, handler)`.
2. Wrap mutations in `withInventoryLock` or `withSecretsLock` as appropriate.
3. Emit an `audit({ tool, server, key?, ok, error? })` line in both the
   success and failure paths.
4. Add at least one assertion to `scripts/smoke.mjs` covering the happy
   path.
5. Add a unit test under `tests/` if the new behaviour has any logic
   beyond "call the store and return".
6. Update the tool table in `README.md` and add a recipe to
   `docs/COOKBOOK.md` if there's a notable workflow.

## Tone for commit messages

The history aims for one-paragraph "why" plus a bullet list of "what".
Look at `git log` for the current style.

## Things explicitly out of scope

- Networking (HTTP / SSE transports) — stdio only.
- Running ssh on the agent's behalf — the agent has its own ssh tool;
  this server is a lookup table, not a remote-execution engine.
- Team / multi-user sharing of the secrets store. Use 1Password or Vault.
- Any kind of plugin system. New backends should live in `src/secrets.ts`
  alongside the existing two, behind the `MasterKeyProvider` interface.

## Security disclosures

Open a GitHub issue marked **security** or email the maintainer (see
profile). Do not put proof-of-concept exploits in a public PR.
