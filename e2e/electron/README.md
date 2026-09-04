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

The Notebook scenarios mount the production `NotebookBody`, `useFetchNotebookDocuments`, Zustand
Notebook action, SWR configuration, and `NotebookService` inside the Electron renderer. Only the
TRPC transport is replaced with a deterministic in-process fake. They verify the real 5s/15s
bounded retry path, terminal error UI, and recovery after the user clicks the production Retry
button.

## Workspace Runtime scenarios

`workspace-runtime.spec.ts` mounts the production agent sidebar (`Sidebar/Body` → `Topic` →
`TopicList` → `WorkspaceMode`) in the Electron renderer and runs the real data chains end to end:

- `useWorkspaceTopicNavigation` → production `projectWorkspace` store `useFetchWorkspaces` →
  `@/libs/swr` → `projectWorkspaceService` → `lambdaClient.projectWorkspace.list.query`
- `useFetchChatTopics` → `useFetchTopics` → production chat store `useFetchTopics` action →
  `@/libs/swr` → `topicService` → `lambdaClient.topic.getTopics.query` → production store writes,
  `topicSelectors`, placement classification and sidebar UI

The renderer only seeds conversation identity (active agent, active topic, gateway device). Topic
rows and workspace rows are fetched by production code.

### Remaining test doubles

1. **TRPC transport** (`production-app/workspaceRuntimeTrpcClient.ts`) — the only data-chain
   substitution, so the suite needs no server, database or account. It applies the same
   `agentId` / `excludeTriggers` / `excludeStatuses` / `pageSize` filtering the real routers apply
   and records every call, so the spec fails if the production params stop arriving.
2. **Shell-only UI substitutions** (`workspace-runtime-product-boundaries` plugin) — the Topic and
   TopicItem overflow menus (`useDropdownMenu`, `Actions`, `Editing`), the sidebar `Filter` and
   `ToggleGroups` affordances, `AllTopicsDrawer` and `ThreadList`. These are presentation surfaces
   outside the Topic navigation contract; they pull heavy portal/menu machinery into a headless
   window without adding coverage. No store, action, selector, SWR hook or service is substituted.

This remains a focused Electron-hosted contract rather than a signed packaged-app smoke test. The
tool-call and Aihub scenarios use deterministic lifecycle adapters; the Notebook and Workspace
Runtime scenarios run the production renderer data and UI chain through the TRPC client boundary.
Approval actions, message services, routers, and database behavior remain covered by their Vitest
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
