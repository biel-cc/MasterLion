# Electron focused lifecycle E2E

This Electron-hosted integration suite launches a real Electron process with Playwright. The test-only app imports the
production `ToolCallLifecycle` source after transpiling it into the ignored `.artifacts/`
directory, then supplies deterministic message, operation, retry, and local-execution adapters.
It uses the same Electron runtime version declared by `apps/desktop`. The test renderer clears its
pending indicator only when the lifecycle promise settles, and separately asserts that the
production operation snapshot has no `running` nodes.

The same real Electron harness also imports the production `AihubReadiness` state machine. It verifies that concurrent
OIDC/runtime requests enter provisioning once and that a same-user Electron relaunch reuses persisted readiness instead
of creating another managed token.

The local execution-context scenario imports the production `ExecutionContextManager` and runs a
real child process from the Electron main process. It covers a Topic-selected folder, the stable
managed fallback for a Topic without a folder, frozen shell environment filtering, independent
runtime/package-manager planning, symlink escape rejection, missing workspace rejection, and stale
context rejection after a simulated Electron relaunch.

Renderer/runloop integration is intentionally tested separately with focused Vitest suites. Those
suites cover the Topic/Agent/Device selection precedence, immutable Operation snapshot, Prompt,
direct and Gateway callbacks, local file and shell tools, Skills resource preparation, the `lh`
route, and human-intervention continuations. Do not treat this small deterministic Electron app as
the full production renderer chain.

For this change, a development-build product smoke was also performed in the real Masterino App:
selecting a Topic folder and approving `pwd` returned that folder's canonical path; clearing the
selection and repeating the operation returned the App-managed workspace under
`userData/execution-workspaces`. This manual smoke connects the automated seams to the visible UI,
but is not a substitute for this repeatable suite.

The Notebook scenarios mount the production `NotebookBody`, `useFetchNotebookDocuments`, Zustand
Notebook action, SWR configuration, and `NotebookService` inside the Electron renderer. Only the
TRPC transport is replaced with a deterministic in-process fake. They verify the real 5s/15s
bounded retry path, terminal error UI, and recovery after the user clicks the production Retry
button.

This remains a focused Electron-hosted contract rather than a signed packaged-app smoke test. The
tool-call and Aihub scenarios use deterministic lifecycle adapters; the Notebook scenarios run the
production renderer data and UI chain through the TRPC client boundary. Production Zustand adapters,
approval actions, message services, routers, and database behavior remain covered by their Vitest
and database integration suites. A packaged desktop smoke test remains separate follow-up work.

It intentionally does not use the Chromium/Next.js harness under `e2e/src`: that harness cannot
exercise Electron preload or IPC.

## Prerequisites

Install the workspace dependencies and ensure Electron's downloaded runtime is present:

```bash
pnpm install --frozen-lockfile
pnpm --dir apps/desktop install
```

No Playwright browser download, database, Next.js server, or external network service is needed.

## Run

From the repository root:

```bash
pnpm exec playwright test --config=e2e/electron/playwright.config.mjs
```

To use a separately installed Electron executable:

```bash
ELECTRON_EXECUTABLE_PATH=/absolute/path/to/electron \
  pnpm exec playwright test --config=e2e/electron/playwright.config.mjs
```
