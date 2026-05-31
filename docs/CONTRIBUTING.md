# Contributing

Contributions are welcome! Please follow these guidelines to keep the project
maintainable.

## Development Setup

```bash
git clone https://github.com/isogonic/codeplane-server-inventory.git
cd codeplane-server-inventory
npm ci
npm run build
npm test
```

## Branching Model

- `main` is the protected, production-ready branch.
- Feature work should be done in short-lived branches and submitted as pull requests.
- Every PR must pass the full CI matrix before merge.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature (minor bump)
- `fix:` — bug fix (patch bump)
- `docs:` — documentation changes
- `test:` — test additions or corrections
- `chore:` — maintenance tasks (CI, dependencies, build)
- `refactor:` — code change that neither fixes a bug nor adds a feature

## Pull Request Checklist

- [ ] `npm run build` passes with no TypeScript errors
- [ ] `npm run test:unit` passes (100+ tests)
- [ ] `npm run smoke` passes (full MCP server lifecycle)
- [ ] New tools or flags are documented in `README.md` and `docs/INTERACTIONS.md`
- [ ] `CHANGELOG.md` contains an entry for user-facing changes
- [ ] `docs/Versioning.md` Pre-Release Checklist items are satisfied

## Code Style

- TypeScript strict mode
- 2-space indentation
- No trailing whitespace
- Single quotes preferred
- No `any` types

## Questions?

Open a [GitHub Discussion](https://github.com/isogonic/codeplane-server-inventory/discussions) or an issue.
