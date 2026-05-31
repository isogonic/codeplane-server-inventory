# Testing Strategy

This project maintains a high test-to-code ratio. Every module has dedicated
unit tests, and a single smoke test exercises the full MCP server lifecycle.

## Test Suites

### Unit Tests

- **Location**: `tests/*.test.mjs`
- **Runner**: Node's built-in test runner (`node --test`)
- **Command**: `npm run test:unit`
- **Coverage**: audit, inventory, paths, schema, secrets, SSH

### Smoke Test

- **Location**: `scripts/smoke.mjs`
- **Runner**: Node
- **Command**: `npm run smoke`
- **Scope**: Spawns `dist/index.js`, speaks JSON-RPC over stdio, and exercises
  every MCP tool against a throwaway inventory in the system temp directory.

## CI Matrix

Tests run on every push to `main` and every pull request:

| OS          | Node |
|-------------|------|
| ubuntu-latest | 20   |
| ubuntu-latest | 22   |
| macos-latest | 20   |
| macos-latest | 22   |

All four combinations must pass.

## Writing New Tests

1. Add a `test()` block to the appropriate file in `tests/`.
2. Use descriptive names that match the format:
   `module — specific behavior`
3. Prefer synchronous tests when possible.
4. For async tests, clean up temp files in a `finally` block.
5. Run `npm run test:unit` locally before pushing.

### Example

```js
test("InventoryStore add/get round-trip", async () => {
  const store = await InventoryStore.open();
  const s = store.add({ name: "x", host: "1.2.3.4", groups: [], tags: [] });
  assert.equal(store.get("x").name, "x");
});
```

## Debugging Tests

```bash
# Run a single test file
node --test tests/inventory.test.mjs

# Run with Node inspector
node --test --inspect tests/inventory.test.mjs
```

## Performance

The full suite runs in under 10 seconds on a modern laptop. The smoke test is
the longest single step (~1–2 seconds). If a change makes tests significantly
slower, profile before merging.
