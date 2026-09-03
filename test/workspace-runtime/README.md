# Workspace Runtime independent acceptance harness

This harness is derived only from approved AC-W01..W10, AC-P01..P08, AC-M01..M06,
AC-C01..C08, AC-X01..X02 and the accepted C0 contracts at
`348d5cb6bfd2e57f43a7ff021b6eadfcc0d254f6`.

- `acceptanceMatrix.ts` is the exhaustive 34-row mapping and frozen argv source.
- `acceptanceAssertions.ts` is the reusable behavioral suite.
- `referenceAdapter.ts` proves that every assertion and fixture contract is executable.
- `acceptedRefAdapter.ts` binds AC-W01..W03 to accepted production seams. Every other method throws
  `MISSING_ACCEPTANCE_SEAM` at invocation time, so red results identify integration work rather than
  compile/import failures.
- `e2e/electron/workspace-runtime.spec.ts` is the focused Electron UI/DB/filesystem suite.

The security-sensitive oracle details are intentional: AC-C08 enables `retry_compression` and
`switch_compression_model` only for `SUMMARY_FAILED`; AC-P06 uses the device boundary's stable
`SCOPE_DENIED` code for both denied cases with zero provider calls; and AC-P07 keeps the model's
requested cwd as fixture input while exposing only `MODEL_CWD_OVERRIDDEN` in audit warnings.

## Integration wiring requests

1. Replace each `missingAcceptanceSeam` entry in `acceptedRefAdapter.ts` with a thin call into the
   integrated production boundary. Preserve the fixture values and return only observable output;
   do not substitute the reference adapter or mock the behavior being accepted.
2. Implement `launchElectronWorkspaceRuntimeSession` with the production renderer/IPC, an isolated
   test database, a unique temporary filesystem root, and provider/device counters. `close` must
   clean up that isolated state.
3. The existing Electron Playwright config fixes `testDir` to `e2e/electron/tests`, while this lane
   may write only `e2e/electron/workspace-runtime.spec.ts`. The integration owner must widen
   `e2e/electron/playwright.config.mjs` to `testDir: '..'` and set `testMatch` to
   `['electron/tests/**/*.spec.mjs', 'electron/workspace-runtime.spec.ts']`, or provide an equivalent
   controller-owned config that makes the frozen argv collect this exact spec.

## Frozen verification argv

```text
bunx vitest run --silent=passed-only test/workspace-runtime
pnpm exec playwright test --config=e2e/electron/playwright.config.mjs --list e2e/electron/workspace-runtime.spec.ts
bun run type-check
git diff --check
```
