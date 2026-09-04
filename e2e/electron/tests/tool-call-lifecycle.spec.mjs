import { expect, test } from '@playwright/test';

import { launchElectronTestApp } from '../support/electronTestApp.mjs';

const observeSpinnerLifecycle = async (page) => {
  const spinner = page.getByTestId('tool-spinner');
  await spinner.evaluate((node) => {
    window.__masterinoToolSpinnerWasVisible = !node.hidden;
    new MutationObserver((records) => {
      // Removing the initially-present `hidden` attribute proves the spinner
      // entered its visible state even when the operation settles before the
      // next Playwright polling interval.
      if (records.some((record) => record.oldValue !== null)) {
        window.__masterinoToolSpinnerWasVisible = true;
      }
    }).observe(node, {
      attributeFilter: ['hidden'],
      attributeOldValue: true,
      attributes: true,
    });
  });
};

const expectSpinnerWasVisible = async (page) => {
  await expect
    .poll(() => page.evaluate(() => window.__masterinoToolSpinnerWasVisible))
    .toBe(true);
};

test('retries a transient prepare failure before executing the local tool once', async () => {
  const electronApp = await launchElectronTestApp();

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId('electron-runtime')).toHaveText('ready');
    await observeSpinnerLifecycle(page);

    await page.getByTestId('run-transient').click();

    await expectSpinnerWasVisible(page);
    await expect(page.getByTestId('tool-status')).toHaveText('completed');
    await expect(page.getByTestId('tool-spinner')).toBeHidden();
    await expect(page.getByTestId('prepare-attempts')).toHaveText('3');
    await expect(page.getByTestId('local-execution-count')).toHaveText('1');
    await expect(page.getByTestId('result-sync-attempts')).toHaveText('1');
    await expect(page.getByTestId('running-operation-count')).toHaveText('0');
  } finally {
    await electronApp.close();
  }
});

test('stops the spinner without executing the local tool when prepare retries are exhausted', async () => {
  const electronApp = await launchElectronTestApp();

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId('electron-runtime')).toHaveText('ready');
    await observeSpinnerLifecycle(page);

    await page.getByTestId('run-exhausted').click();

    await expectSpinnerWasVisible(page);
    await expect(page.getByTestId('tool-status')).toHaveText('failed');
    await expect(page.getByTestId('tool-spinner')).toBeHidden();
    await expect(page.getByTestId('prepare-attempts')).toHaveText('3');
    await expect(page.getByTestId('local-execution-count')).toHaveText('0');
    await expect(page.getByTestId('result-sync-attempts')).toHaveText('0');
    await expect(page.getByTestId('running-operation-count')).toHaveText('0');
  } finally {
    await electronApp.close();
  }
});

test('does not re-execute the local tool when result synchronization retries are exhausted', async () => {
  const electronApp = await launchElectronTestApp();

  try {
    const page = await electronApp.firstWindow();
    await page.getByTestId('run-sync-exhausted').click();

    await expect(page.getByTestId('tool-status')).toHaveText('failed');
    await expect(page.getByTestId('tool-spinner')).toBeHidden();
    await expect(page.getByTestId('local-execution-count')).toHaveText('1');
    await expect(page.getByTestId('result-sync-attempts')).toHaveText('3');
    await expect(page.getByTestId('running-operation-count')).toHaveText('0');
  } finally {
    await electronApp.close();
  }
});

test('cancels a non-settling local executor, settles the UI, and leaves no running operation', async () => {
  const electronApp = await launchElectronTestApp();

  try {
    const page = await electronApp.firstWindow();
    await page.getByTestId('run-cancelled').click();

    await expect(page.getByTestId('tool-status')).toHaveText('failed');
    await expect(page.getByTestId('tool-spinner')).toBeHidden();
    await expect(page.getByTestId('local-execution-count')).toHaveText('1');
    await expect(page.getByTestId('result-sync-attempts')).toHaveText('0');
    await expect(page.getByTestId('running-operation-count')).toHaveText('0');
  } finally {
    await electronApp.close();
  }
});
