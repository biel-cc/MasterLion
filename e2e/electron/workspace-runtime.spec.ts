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
  await expect(workspaceSection.getByTestId('workspace-group')).toContainText(
    'Masterino product workspace',
  );
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
