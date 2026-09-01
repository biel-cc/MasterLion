import { expect, test } from '@playwright/test';

import { launchElectronTestApp } from '../support/electronTestApp.mjs';

test('twenty concurrent Electron requests provision Aihub exactly once', async () => {
  const electronApp = await launchElectronTestApp();
  try {
    const page = await electronApp.firstWindow();
    await page.getByTestId('run-aihub-concurrent').click();

    await expect(page.getByTestId('aihub-status')).toHaveText('completed');
    await expect(page.getByTestId('aihub-spinner')).toBeHidden();
    await expect(page.getByTestId('aihub-provision-count')).toHaveText('1');
    await expect(page.getByTestId('aihub-active-count')).toHaveText('1');
  } finally {
    await electronApp.close();
  }
});

test('same-user Electron relaunch reuses readiness without creating another token', async () => {
  const electronApp = await launchElectronTestApp();
  try {
    const page = await electronApp.firstWindow();
    await page.getByTestId('run-aihub-relaunch').click();

    await expect(page.getByTestId('aihub-status')).toHaveText('active');
    await expect(page.getByTestId('aihub-spinner')).toBeHidden();
    await expect(page.getByTestId('aihub-provision-count')).toHaveText('1');
    await expect(page.getByTestId('aihub-active-count')).toHaveText('1');
  } finally {
    await electronApp.close();
  }
});

test('historical active Electron user stays available when Aihub reconciliation is transiently unavailable', async () => {
  const electronApp = await launchElectronTestApp();
  try {
    const page = await electronApp.firstWindow();
    await page.getByTestId('run-aihub-legacy-transient').click();

    await expect(page.getByTestId('aihub-status')).toHaveText('active');
    await expect(page.getByTestId('aihub-spinner')).toBeHidden();
    await expect(page.getByTestId('aihub-provision-count')).toHaveText('1');
    await expect(page.getByTestId('aihub-active-count')).toHaveText('1');
    await expect(page.getByTestId('aihub-reconcile-error-count')).toHaveText('1');
  } finally {
    await electronApp.close();
  }
});

test('historical Electron user already marked error by the quota incident recovers to v2', async () => {
  const electronApp = await launchElectronTestApp();
  try {
    const page = await electronApp.firstWindow();
    await page.getByTestId('run-aihub-legacy-error').click();

    await expect(page.getByTestId('aihub-status')).toHaveText('active');
    await expect(page.getByTestId('aihub-spinner')).toBeHidden();
    await expect(page.getByTestId('aihub-provision-count')).toHaveText('1');
    await expect(page.getByTestId('aihub-active-count')).toHaveText('1');
    await expect(page.getByTestId('aihub-reconcile-error-count')).toHaveText('0');
  } finally {
    await electronApp.close();
  }
});
