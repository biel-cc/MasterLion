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
  await expect(page.getByRole('heading', { level: 1, name: 'Topic' })).toBeVisible();

  const recent = page.getByTestId('topic-recent-section');
  await expect(recent).toContainText('Recent');
  await expect(recent.getByTestId('recent-topic-topic-unbound')).toContainText('Pure chat');
  await expect(recent).not.toContainText(/Task|T-\d+/i);
});

test('production Recent keeps scratch temporary and exposes its deterministic root', async () => {
  const scratch = session.page.getByTestId('recent-topic-topic-scratch');
  await expect(scratch).toContainText('Temporary work');
  await expect(scratch.getByTestId('temporary-marker-topic-scratch')).toHaveText('Temporary');
  await expect(scratch).toHaveAttribute('data-scratch-root', '/tmp/masterino/topic-scratch');
});

test('production model UI renders supported, text-only, and unknown capability states', async () => {
  const { page } = session;
  await expect(
    page.getByTestId('model-capability-supported').locator('[data-input-modality="supported"]'),
  ).toHaveCount(1);
  await expect(
    page.getByTestId('model-capability-text-only').locator('[data-input-modality="text-only"]'),
  ).toHaveCount(1);
  await expect(
    page.getByTestId('model-capability-unknown').locator('[data-input-modality="unknown"]'),
  ).toHaveCount(1);
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
