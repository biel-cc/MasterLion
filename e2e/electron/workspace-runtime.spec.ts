import { expect, test } from '@playwright/test';

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

test('production renderer keeps Topic and flat Recent independent from Task UI', async () => {
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
  await expect(recent.getByTestId('topic-item').filter({ hasText: 'Pure chat' })).toHaveCount(1);
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

test('production Workspace groups stay above Recent and real TopicItem marks scratch', async () => {
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

test('production model pipeline excludes rerank and renders all capability states', async () => {
  const { page } = session;
  await expect(
    page.getByTestId('model-row-vision-chat').locator('[data-input-modality="supported"]'),
  ).toHaveCount(1);
  await expect(
    page.getByTestId('model-row-text-chat').locator('[data-input-modality="text-only"]'),
  ).toHaveCount(1);
  await expect(
    page.getByTestId('model-row-unverified-chat').locator('[data-input-modality="unknown"]'),
  ).toHaveCount(1);
  await expect(page.locator('[data-model-id="qwen3-vl-rerank"]')).toHaveCount(0);
});

test('production compression progress is visible and accessible', async () => {
  const progress = session.page.getByTestId('compression-progress').getByRole('status');
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute('aria-busy', 'true');
  await expect(progress).toContainText('Compressing context');
});

test('production no-candidates card gives manual feedback and disables futile retry', async () => {
  const card = session.page.locator('[data-context-budget-code="NO_CANDIDATES"]');
  await expect(card.getByRole('heading', { name: 'Nothing left to compress' })).toBeVisible();
  await expect(card.getByRole('list', { name: 'What you can do' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Retry summary' })).toBeDisabled();
  await expect(card).toContainText('Compressing again will not help');
});

test('production terminal cards expose bounded actions and dispatch clicks', async () => {
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

test('production diagnostics are redacted before they reach the DOM', async () => {
  const card = session.page.locator('[data-context-budget-code="TAIL_TOO_LARGE"]');
  await card.getByRole('button', { name: 'Diagnostics' }).click();
  await expect(card).toContainText('aihub / masterino-chat');

  const html = await session.page.getByTestId('context-budget-cards').innerHTML();
  for (const secretFragment of ['hunter2', 'AKIA', 'sk-live', 'payroll']) {
    expect(html).not.toContain(secretFragment);
  }
});
