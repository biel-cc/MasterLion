import { expect, test } from '@playwright/test';

import { launchElectronTestApp } from '../support/electronTestApp.mjs';

const expectBoundedRetryDelays = async (page) => {
  const delays = (await page.getByTestId('notebook-delays').textContent()).split(',').map(Number);
  expect(delays).toHaveLength(2);
  expect(delays[0]).toBeGreaterThanOrEqual(4_000);
  expect(delays[0]).toBeLessThanOrEqual(6_100);
  expect(delays[1]).toBeGreaterThanOrEqual(12_000);
  expect(delays[1]).toBeLessThanOrEqual(18_100);
};

test('recovers the notebook list on the third bounded attempt', async () => {
  const electronApp = await launchElectronTestApp();

  try {
    const page = await electronApp.firstWindow();
    await page.clock.install();
    await page.getByTestId('run-notebook-recovery').click();
    await page.clock.runFor(25_000);

    await expect(page.getByText('Existing report')).toBeVisible();
    await expect(page.getByTestId('notebook-attempts')).toHaveText('3');
    await expectBoundedRetryDelays(page);
  } finally {
    await electronApp.close();
  }
});

test('stops after two retries and recovers when the user clicks Retry', async () => {
  const electronApp = await launchElectronTestApp();

  try {
    const page = await electronApp.firstWindow();
    await page.clock.install();
    await page.getByTestId('run-notebook-exhausted').click();
    await page.clock.runFor(25_000);

    await expect(page.getByText('Notebook list is temporarily unavailable.')).toBeVisible();
    await expect(page.getByTestId('notebook-attempts')).toHaveText('3');
    await expectBoundedRetryDelays(page);

    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByText('Existing report')).toBeVisible();
    await expect(page.getByTestId('notebook-attempts')).toHaveText('4');
    await expect(page.getByText('Notebook list is temporarily unavailable.')).toBeHidden();
  } finally {
    await electronApp.close();
  }
});
