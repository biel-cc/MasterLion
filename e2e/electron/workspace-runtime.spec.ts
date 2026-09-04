import { expect, type Locator, test } from '@playwright/test';

import {
  type ElectronWorkspaceRuntimeSession,
  launchElectronWorkspaceRuntimeSession,
} from '../workspace-runtime/electronHarness';

let session: ElectronWorkspaceRuntimeSession;

test.beforeAll(async () => {
  session = await launchElectronWorkspaceRuntimeSession();
});

test.afterAll(async () => {
  await session?.close();
});

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

/** `data-input-modality` + its accessible label, in render order. */
const readCapabilityLabels = (section: Locator) =>
  section
    .locator('[data-input-modality]')
    .evaluateAll((nodes) =>
      nodes.map(
        (node) =>
          `${node.getAttribute('data-input-modality')}|${node.getAttribute('aria-label') ?? ''}`,
      ),
    );

test('AC-W05 production renderer keeps Topic and flat Recent independent from Task UI', async () => {
  const { page } = session;
  await expect(page.getByTestId('workspace-runtime-product-ui')).toBeVisible();
  const sidebar = page.getByTestId('production-agent-sidebar');
  await expect(sidebar.getByText('Topics', { exact: true })).toBeVisible();
  await expect(sidebar.getByText('Tasks', { exact: true })).toBeVisible();

  const recent = page.getByTestId('topic-recent-section');
  await expect(recent).toContainText('Recent');
  // Exactly the two unbound/scratch rows — the workspace-bound row belongs to
  // the group above, and the system-owned rows must never have been fetched.
  await expect(recent.getByTestId('topic-item')).toHaveCount(2);
  const pureChat = recent.getByTestId('topic-item').filter({ hasText: 'Pure chat' });
  await expect(pureChat).toHaveCount(1);
  await expect(pureChat.locator('animateTransform')).toHaveCount(0);
  await expect(recent).not.toContainText(/Task|T-\d+/i);

  const order = await sidebar.evaluate((node) => {
    const topicLabel = [...node.querySelectorAll('*')].find(
      (element) => element.textContent === 'Topics',
    );
    const taskLabel = [...node.querySelectorAll('*')].find(
      (element) => element.textContent === 'Tasks',
    );
    return Boolean(
      topicLabel &&
      taskLabel &&
      topicLabel.compareDocumentPosition(taskLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(order).toBe(true);
});

test('AC-W06 production Workspace groups stay above Recent and real TopicItem marks scratch', async () => {
  const { page } = session;
  const workspaceSection = page.getByTestId('topic-workspace-section');
  // The group title and the scratch tooltip path both come from the fetched
  // `projectWorkspace.list` rows, so they only render when the production
  // projectWorkspace store, service and placement selectors stay connected.
  await expect(workspaceSection.getByTestId('workspace-group')).toHaveCount(1);
  await expect(workspaceSection.getByTestId('workspace-group')).toContainText(
    'Masterino product workspace',
  );
  await expect(workspaceSection.getByTestId('topic-item')).toHaveCount(1);
  await expect(workspaceSection.getByTestId('topic-item')).toContainText('Workspace feature work');

  const recent = page.getByTestId('topic-recent-section');
  const scratch = recent.getByTestId('topic-item').filter({ hasText: 'Temporary work' });
  await expect(scratch).toContainText('Temporary work');
  await expect(scratch.getByTestId('topic-scratch-tag')).toHaveText('Temporary');
  await expect(scratch.getByTestId('topic-scratch-tag')).toHaveAttribute(
    'aria-label',
    /\/tmp\/masterino\/topic-scratch/,
  );
  await expect(recent).not.toContainText('Workspace feature work');
  // Recent keeps the production `updatedAt` ordering, newest first.
  await expect(recent.getByTestId('topic-item')).toHaveText([/Temporary work/, /Pure chat/]);

  const sectionOrder = await page.getByTestId('production-agent-sidebar').evaluate((node) => {
    const workspace = node.querySelector('[data-testid="topic-workspace-section"]');
    const recentSection = node.querySelector('[data-testid="topic-recent-section"]');
    return Boolean(
      workspace &&
      recentSection &&
      workspace.compareDocumentPosition(recentSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(sectionOrder).toBe(true);
});

test('production Topic and Workspace data reach the deterministic TRPC boundary', async () => {
  const { page } = session;
  const sidebar = page.getByTestId('production-agent-sidebar');
  await expect(page.getByTestId('topic-recent-section').getByTestId('topic-item')).toHaveCount(2);

  // System-owned rows exist at the boundary and are only filtered out when the
  // production `useFetchChatTopics` params travel the whole chain.
  await expect(sidebar).not.toContainText('Task run sweep');
  await expect(sidebar).not.toContainText('Completed retro');

  const calls = await page.evaluate(
    () =>
      ((window as unknown as Record<string, any>).__masterinoWorkspaceRuntimeTrpc?.calls ?? []) as {
        input: Record<string, unknown>;
        path: string;
      }[],
  );

  const topicCalls = calls.filter((call) => call.path === 'topic.getTopics');
  expect(topicCalls.length).toBeGreaterThan(0);
  expect(topicCalls[0].input).toMatchObject({
    agentId: 'electron-e2e-agent',
    current: 0,
    excludeStatuses: ['completed'],
    excludeTriggers: ['cron', 'eval', 'task'],
    pageSize: 20,
  });

  expect(calls.some((call) => call.path === 'projectWorkspace.list')).toBe(true);
});

test('AC-M03 identical capability labels in production and development builds', async () => {
  const { page } = session;
  await expect(page.getByTestId('workspace-runtime-development-ui')).toBeVisible();

  const production = page.getByTestId('model-capabilities');
  const development = page.getByTestId('model-capabilities-development');

  await expect(
    production.getByTestId('model-row-vision-chat').locator('[data-input-modality="supported"]'),
  ).toHaveCount(1);
  await expect(
    production.getByTestId('model-row-text-chat').locator('[data-input-modality="text-only"]'),
  ).toHaveCount(1);
  await expect(
    production.getByTestId('model-row-unverified-chat').locator('[data-input-modality="unknown"]'),
  ).toHaveCount(1);
  // The rerank entry is filtered out of both builds by the production
  // chat-eligibility resolver, so it has no row anywhere on the page.
  await expect(page.locator('[data-model-id="qwen3-vl-rerank"]')).toHaveCount(0);

  const productionLabels = await readCapabilityLabels(production);
  const developmentLabels = await readCapabilityLabels(development);

  expect(productionLabels.map((label) => label.split('|')[0])).toEqual([
    'supported',
    'text-only',
    'unknown',
  ]);
  expect(productionLabels.every((label) => label.split('|')[1].length > 0)).toBe(true);
  // The two bundles differ only in `__DEV__` / `NODE_ENV`, so a label that
  // moves with dev mode fails here instead of being asserted twice.
  expect(developmentLabels).toEqual(productionLabels);
});

test('AC-C04 production no-candidates card gives manual feedback and disables futile retry', async () => {
  const card = session.page.locator('[data-context-budget-code="NO_CANDIDATES"]');
  await expect(card.getByRole('heading', { name: 'Nothing left to compress' })).toBeVisible();
  await expect(card.getByRole('list', { name: 'What you can do' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Retry summary' })).toBeDisabled();
  await expect(card).toContainText('Compressing again will not help');
});

test('production compression progress is visible and accessible', async () => {
  const progress = session.page.getByTestId('compression-progress').getByRole('status');
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute('aria-busy', 'true');
  await expect(progress).toContainText('Compressing context');
});

test('AC-C08 production terminal cards expose bounded actions and dispatch clicks', async () => {
  const { page } = session;
  const tail = page.locator('[data-context-budget-code="TAIL_TOO_LARGE"]');
  const noCandidates = page.locator('[data-context-budget-code="NO_CANDIDATES"]');
  const summary = page.locator('[data-context-budget-code="SUMMARY_FAILED"]');
  const exhausted = page.locator('[data-context-budget-code="RETRY_EXHAUSTED"]');

  await expect(tail.getByRole('group').getByRole('button')).toHaveCount(4);
  await expect(noCandidates.getByRole('group').getByRole('button')).toHaveCount(5);
  await expect(summary.getByRole('group').getByRole('button')).toHaveCount(4);
  await expect(exhausted.getByRole('group').getByRole('button')).toHaveCount(2);
  await expect(exhausted.getByRole('button', { name: 'Retry summary' })).toHaveCount(0);

  await summary.getByRole('button', { name: 'Change compression model' }).click();
  await expect(page.getByTestId('context-budget-cards')).toHaveAttribute(
    'data-last-action',
    'switch_compression_model',
  );
});

test('AC-C08 production diagnostics are redacted before they reach the DOM', async () => {
  const card = session.page.locator('[data-context-budget-code="TAIL_TOO_LARGE"]');
  await card.getByRole('button', { name: 'Diagnostics' }).click();
  await expect(card).toContainText('aihub / masterino-chat');

  const html = await session.page.getByTestId('context-budget-cards').innerHTML();
  for (const secretFragment of ['hunter2', 'AKIA', 'sk-live', 'payroll']) {
    expect(html).not.toContain(secretFragment);
  }
});

// ─── Main-process seams: real isolated database, real filesystem, real counters ───

test('AC-W04 five pure-chat turns leave the workspace table and scratch tree untouched', async () => {
  const row = await session.run('AC-W04');

  // The provider counter proves the five turns actually ran: a harness that
  // silently skipped them could not produce this number.
  expect(row.providerCalls).toBe(5);
  expect(row.turnCwds).toHaveLength(5);
  expect(row.turnCwds.every((cwd) => cwd === undefined)).toBe(true);

  expect(row.projectWorkspaceRowsBefore).toBe(0);
  expect(row.projectWorkspaceRowsAfter).toBe(row.projectWorkspaceRowsBefore);
  expect(row.scratchDirectoriesBefore).toEqual([]);
  expect(row.scratchDirectoriesAfter).toEqual(row.scratchDirectoriesBefore);
  expect(row.boundWorkspaceIdAfter).toBeUndefined();
});

test('AC-W07 consented read creates no scratch and concurrent init persists exactly one', async () => {
  const row = await session.run('AC-W07');

  // 1. An absolute, consented structured read reaches the device boundary and
  //    still creates no scratch row and no scratch directory.
  expect(row.directReadDeviceCalls).toBe(1);
  expect(row.directReadScratchRows).toBe(0);
  expect(row.directReadScratchDirectories).toEqual([]);

  // 2. Two concurrent first default-cwd device operations converge on one row.
  expect(row.concurrentDeviceCalls).toBe(2);
  expect(row.scratchRowsAfter).toBe(1);
  expect(new Set(row.scratchWorkspaceIds).size).toBe(1);
  expect(row.scratchWorkspaceIds).toHaveLength(2);
  expect(row.snapshotWorkspaceId).toBe(row.scratchWorkspaceIds[0]);
  expect(row.scratchDirectoriesAfter).toEqual(['topic-w07-scratch']);
  expect(row.persistedScratchRootPath.endsWith('/topic-w07-scratch')).toBe(true);
  expect(row.placement).toEqual({ kind: 'recent', reason: 'scratch' });
});

test('AC-W08 a scratch topic is never rebound and the chip offers a referenced topic', async () => {
  const row = await session.run('AC-W08');

  // Database half: the bind-once writer rejected the formal directory and the
  // topic kept its scratch identity and cwd.
  expect(row.rejectionCode).toBe('WORKSPACE_ALREADY_BOUND');
  expect(row.cwdBefore).toBeTruthy();
  expect(row.cwdAfter).toBe(row.cwdBefore);
  expect(row.boundWorkspaceIdAfter).toBe(row.boundWorkspaceIdBefore);
  expect(row.boundWorkspaceIdAfter).toBe(row.scratchWorkspaceId);
  expect(row.workspaceStateAfter).toBe('scratch');
  expect(row.formalWorkspaceRootPath).not.toBe(row.cwdAfter);

  // UI half: the production chip renders those rows.
  const section = session.page.getByTestId('workspace-bind-once');
  await expect(section).toHaveAttribute('data-state', 'ready');
  const chip = section.getByTestId('workspace-chip');
  await expect(chip).toHaveAttribute('data-workspace-state', 'scratch');
  await expect(chip).toHaveAttribute('aria-label', new RegExp(escapeRegExp(row.cwdAfter!)));
  await expect(section.getByTestId('workspace-chip-scratch')).toHaveText('Temporary');
  await expect(section.getByTestId('workspace-chip-already-bound')).toHaveText(
    'New referenced topic',
  );
});

test('AC-W09 only explicit sources create workspace-topics and the agent default is untouched', async () => {
  const row = await session.run('AC-W09');

  expect(row.bindingBySource).toEqual({
    attachment: false,
    codeBlock: false,
    confirmedDirectory: true,
    quote: false,
    workspacePlus: true,
  });

  // Rejected sources never reach a write path: the table is still empty when
  // the negative matrix has been evaluated.
  expect(row.workspaceRowsBefore).toBe(0);
  expect(row.workspaceRowsAfterRejectedSources).toBe(0);

  expect(row.createdTopicWorkspaceIds).toHaveLength(2);
  expect(new Set(row.createdTopicWorkspaceIds).size).toBe(2);
  expect(row.workspaceRowsAfterExplicitSources).toBe(2);
  expect(Object.values(row.boundWorkspaceIdsByTopic).sort()).toEqual(
    [...row.createdTopicWorkspaceIds].sort(),
  );

  expect(row.agentDefaultAfter).toBe(row.agentDefaultBefore);
  expect(row.agentDefaultBefore).toContain('/agent/default');
});

test('AC-W10 unbound hetero send is blocked and resume uses the canonical identity', async () => {
  const row = await session.run('AC-W10');

  expect(row.preBindCode).toBe('WORKSPACE_REQUIRED');
  expect(row.preBindProviderCalls).toBe(0);

  expect(row.resumeError).toBeUndefined();
  expect(row.resumeProviderCalls).toBe(1);
  expect(row.resumeSessionId).toBe('session-w10');
  expect(row.resumeCwd).toBeTruthy();
  expect(row.normalizedResumeIdentity).toBe(row.persistedIdentity);
  expect(row.normalizedResumeIdentity).toMatch(/^id:[^:]+:device:[^:]+:\//);
});

test('AC-P08 consent surface shows the real cwd, command and out-of-scope risk', async () => {
  const row = await session.run('AC-P08');

  // Device-boundary half: the model's cwd is overridden, and the out-of-scope
  // read stops at the boundary asking for consent instead of executing.
  expect(row.interventionCode).toBe('INTERVENTION_REQUIRED');
  expect(row.warningCodes).toEqual(['MODEL_CWD_OVERRIDDEN']);
  expect(row.spawnCwd).not.toBe(row.requestedCwd);
  // The prepared spawn directory is the topic's primary cwd, not the model's.
  expect(row.consentRequest.primaryCwd).toBe(row.spawnCwd);
  expect(JSON.parse(row.displayedArguments).cwd).not.toBe(row.requestedCwd);
  // One counted directory probe establishes the persisted primary workspace;
  // the shell and read then cross the device execution boundary.
  expect(row.deviceCalls).toBe(3);
  expect(row.providerCalls).toBe(0);

  // UI half: the production consent component and argument view.
  const surface = session.page.getByTestId('workspace-path-consent-surface');
  await expect(surface).toHaveAttribute('data-state', 'ready');

  const consent = surface.getByTestId('workspace-path-consent');
  await expect(consent).toBeVisible();
  await expect(consent).toContainText('Additional path access requested');
  await expect(consent).toContainText(row.spawnCwd);
  await expect(consent).toContainText(row.consentRequest.requestedPath);

  const risk = surface.getByTestId('workspace-path-consent-risk');
  await expect(risk).toContainText(/Consent and audit only/i);
  await expect(risk).toContainText(/not OS isolation/i);
  await expect(risk).toContainText(/does not create an operating-system sandbox/i);
  // The shell confirmation must not hide the command or the full directory the
  // command will actually run in.
  const shell = surface.getByTestId('out-of-scope-shell-confirmation');
  await expect(shell.getByTestId('workspace-shell-full-arguments')).toContainText('cat');
  await expect(shell.getByTestId('workspace-shell-full-arguments')).toContainText(
    row.consentRequest.requestedPath,
  );
  await expect(shell).toContainText(row.spawnCwd);
});

test('AC-X02 every compatibility cell passes and only new/new/new is hard validated', async () => {
  const row = await session.run('AC-X02');

  expect(row.matrix).toHaveLength(8);
  expect(row.matrix.filter(({ passed }) => passed)).toHaveLength(8);
  // Only the four new-device cells reach the v2 execution boundary.
  expect(row.deviceCalls).toBe(4);

  const legacyCells = row.matrix.filter(
    ({ client, device, server }) => client === 'old' || device === 'old' || server === 'old',
  );
  expect(legacyCells).toHaveLength(7);
  expect(legacyCells.every(({ hardValidated }) => !hardValidated)).toBe(true);

  expect(
    row.matrix.find(
      ({ client, device, server }) => client === 'new' && device === 'new' && server === 'new',
    )?.hardValidated,
  ).toBe(true);
});

test('main-process provider and device ports are counted, not assumed', async () => {
  // Runs are memoized in the preload, so re-requesting the rows this test
  // reasons about is free and makes the assertion independent of test
  // selection or ordering.
  const pureChat = await session.run('AC-W04');
  const hetero = await session.run('AC-W10');
  const consent = await session.run('AC-P08');
  const grid = await session.run('AC-X02');

  const counters = await session.counters();

  // The provider port is only ever reached by the five pure-chat turns and the
  // one resumed heterogeneous turn; nothing else in the suite may call it.
  expect(counters.providerCalls).toBe(
    pureChat.providerCalls + hetero.preBindProviderCalls + hetero.resumeProviderCalls,
  );
  expect(counters.providerCalls).toBe(6);
  expect(counters.deviceCalls).toBeGreaterThanOrEqual(consent.deviceCalls + grid.deviceCalls);
});
