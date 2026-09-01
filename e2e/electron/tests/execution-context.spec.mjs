import path from 'node:path';

import { expect, test } from '@playwright/test';

import { launchElectronTestApp } from '../support/electronTestApp.mjs';

// Playwright requires the first fixture argument to use object destructuring.
// eslint-disable-next-line no-empty-pattern
test('uses one fail-closed workspace, environment, and runtime plan for a local Electron operation', async ({}, testInfo) => {
  const electronApp = await launchElectronTestApp();

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId('electron-runtime')).toHaveText('ready');

    await page.getByTestId('run-execution-context').click();

    await expect(page.getByTestId('execution-context-spinner')).toBeVisible();
    await expect(page.getByTestId('execution-context-status')).toHaveText('completed');
    await expect(page.getByTestId('execution-context-spinner')).toBeHidden();

    const selectedWorkspace = await page.getByTestId('selected-workspace').textContent();
    const selectedExecutionCwd = await page.getByTestId('selected-execution-cwd').textContent();
    expect(selectedWorkspace).toContain('selected:');
    expect(selectedWorkspace).toContain(selectedExecutionCwd);
    await expect(page.getByTestId('selected-runtime')).toHaveText('node');
    await expect(page.getByTestId('selected-environment')).toHaveText(
      'from-frozen-environment; secret=absent',
    );

    await expect(page.getByTestId('managed-workspace')).toContainText('managed:');
    await expect(page.getByTestId('managed-workspace-stable')).toHaveText('true');
    await expect(page.getByTestId('missing-runtime')).toHaveText(
      'node/pnpm: missing; no-bun-substitution=true',
    );
    await expect(page.getByTestId('security-checks')).toHaveText(
      'INVALID_WORKSPACE, PATH_OUTSIDE_WORKSPACE, CONTEXT_NOT_FOUND',
    );

    await page.screenshot({
      fullPage: true,
      path: path.join(testInfo.outputDir, 'execution-context-electron.png'),
    });
  } finally {
    await electronApp.close();
  }
});
