<div align="center">

  <h1>Versioning</h1>

  <p>
    <strong>How versions are bumped, what triggers a publish, and how to cut a release for <code>@isogonic/codeplane-server-inventory</code>.</strong>
  </p>

  <p>
    <a href="https://codeplane-server-inventory.js.org">Package</a> &nbsp;·&nbsp;
    <a href="../">Docs</a> &nbsp;·&nbsp;
    <a href="https://github.com/isogonic/codeplane-server-inventory">GitHub</a>
  </p>
</div>

<br />

## SemVer Policy

This package follows [Semantic Versioning](https://semver.org/):

| Increment | When |
|-----------|------|
| `MAJOR` | Breaking changes to the MCP tool surface, file format, or secrets encryption scheme. |
| `MINOR` | New tools, new environment variables, or backward-compatible enhancements. |
| `PATCH` | Bug fixes, documentation updates, internal refactors, or CI/workflow changes that do not affect users. |

The current version lives in [`package.json`](../package.json) under the `version` field. There is no separate version file or lockfile-driven version.

## What Triggers a Publish

The [`publish.yml`](../.github/workflows/publish.yml) workflow runs automatically on:

1. **Push to `main`** — every commit that lands on `main` triggers a publish attempt.
2. **Manual `workflow_dispatch`** — you can trigger a publish from the GitHub UI without a new commit.

The workflow does **not** require a git tag. It reads the version directly from `package.json` and publishes that exact version to npm.

## Pre-Release Checklist

Before pushing a version bump to `main`:

- [ ] Update [`package.json`](../package.json) `version` field.
- [ ] Update [`CHANGELOG.md`](../CHANGELOG.md) with user-facing changes since the last release.
- [ ] Run the full test suite locally:
  ```bash
  npm run build && npm test
  ```
      - [ ] Verify the server starts cleanly and smoke tests pass:
  ```bash
  npm test
  ```
- [ ] If you added new tools or changed tool names, update [`README.md`](../README.md) tool tables and MCP config examples.
- [ ] If you changed the secrets scheme or file format, update the **Security model** section in the README.
- [ ] If you changed `SERVER_INVENTORY_ALLOW_EXEC` behavior, update the exec opt-in docs.

## Version Bump Workflow

### 1. Update package.json

```bash
# bump patch
npm version patch --no-git-tag-version

# bump minor
npm version minor --no-git-tag-version

# bump major
npm version major --no-git-tag-version
```

This updates `package.json` (and `package-lock.json` if present). Do **not** run plain `npm version` — the publish workflow does not use git tags, and npm's default behavior is to create a git tag, which will cause confusion.

### 2. Rebuild

```bash
npm run build
```

The `dist/` directory must be up to date. The publish workflow runs `tsc` again, but rebuilding locally catches type errors before the CI does.

### 3. Commit and Push

```bash
git add package.json package-lock.json dist/ README.md CHANGELOG.md
git commit -m "chore: release vX.Y.Z — <summary>"
git push origin main
```

Use a conventional prefix like `chore: release`, `feat:`, or `fix:` depending on the change type. The CI will pick up the new version from `package.json` and publish it.

## CI/CD Pipelines

Two workflows run on every push to `main`:

### `ci.yml`

| Step | What it does |
|------|--------------|
| Build | `npm ci` then `npm run build` |
| Unit tests | `npm run test:unit` (34 Node test suites) |
| Smoke test | `npm run smoke` (full MCP server lifecycle) |
| Smoke test | Full MCP server lifecycle via `npm run smoke` |

Matrix: `ubuntu-latest` / `macos-latest` × Node `20` / `22`.

### `publish.yml`

| Step | What it does |
|------|--------------|
| Auth | Writes `NPM_TOKEN` GitHub secret to `.npmrc` |
| Build | `npm ci` then `npm run build` |
| Publish | `npm publish --access public` |

The publish workflow does **not** require the repo to be public. It uses the manual `npm config set` approach so the token never leaks to `setup-node` logs.

## Version History

| Version | Date | Notes |
|---------|------|-------|
| `0.5.5` | 2026-05-31 | CLI removed; publish on GitHub release; Windows support documented; LICENSE attribution added. |
| `0.5.4` | 2026-05-31 | CI operationalization: changelog gate, TEAM_PAT support, docs expansion. |
| `0.5.3` | 2026-05-31 | README rewrite in Codeplane style; package renamed to `@isogonic/codeplane-server-inventory`; npm publish workflow added. |
| `0.5.2` | 2026-05-30 | CI cleanup; correct publish directory; optimize npm workflow. |
| `0.5.1` | 2026-05-29 | npm publish fixes; migrate to local git config; unpin @types/node. |
| `0.5.0` | 2026-05-28 | `ssh_check`, `exec_on`, secrets v2, agent-friendly defaults. |

## Cache and State Invalidation

This project does not use a long-lived file cache. State is invalidated by
design through direct disk reads and serialized writes.

- **Inventory reads**: every `list_servers`, `get_server`, `groups`, `tags`,
  and `validate_inventory` call opens the inventory file fresh from disk.
- **Secret reads**: every `get_secret`, `list_secrets`, and `list_all_secrets`
  call decrypts and returns the current value from the encrypted secrets file.
- **SSH config aliases**: `buildPathsReport` and `validate_inventory` re-parse
  `~/.ssh/config` on every invocation. No alias cache is held in memory across
  requests.
- **Audit log**: append-only. New entries are visible immediately; no buffering.

### Write Serialization

Concurrent writes to the inventory or secrets file are serialized through
`withInventoryLock`. This prevents race conditions when multiple MCP tool calls
or concurrent tool calls hit the server at the same time.

### Troubleshooting Publish Failures

If the publish workflow fails after a push to `main`:

1. **`E403: cannot publish over previously published versions`** — you pushed the same `package.json` version twice. Bump the patch version and push again.
2. **`E404: package not found`** — the `NPM_TOKEN` secret is missing or expired. Re-set it from `npm token create` output and re-run the workflow.
3. **`E422: private source repo`** — provenance requires a public repo. Either make the repo public or remove `--provenance` from the publish step.

## Repo Structure

```text
.
├── package.json            Version, name, scripts
├── CHANGELOG.md            Release notes
├── README.md               User-facing docs + Codeplane config
├── Versioning.md           This file
├── .github/
│   └── workflows/
│       ├── ci.yml          Test matrix
│       └── publish.yml     npm publish
├── src/                    TypeScript source
├── dist/                   Compiled output (do not edit by hand)
└── docs/                   Supplementary docs (this file lives here)
```
