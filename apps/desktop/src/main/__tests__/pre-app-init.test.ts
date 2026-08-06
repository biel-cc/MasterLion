import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { app, isDev } = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => 'C:\\Users\\test\\AppData\\Roaming'),
    setName: vi.fn(),
    setPath: vi.fn(),
  },
  isDev: vi.fn(() => false),
}));

vi.mock('electron', () => ({ app }));
vi.mock('electron-is', () => ({ dev: isDev }));

describe('pre-app-init user data isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.DESKTOP_BUILD_FLAVOR;
    isDev.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.DESKTOP_BUILD_FLAVOR;
  });

  it('keeps production on the default user data directory', async () => {
    await import('../pre-app-init');

    expect(app.setName).toHaveBeenCalledWith('Masterino');
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it('isolates development data from production', async () => {
    isDev.mockReturnValue(true);

    await import('../pre-app-init');

    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      path.join('C:\\Users\\test\\AppData\\Roaming', 'masterino-desktop-dev'),
    );
  });

  it('isolates packaged test builds from production', async () => {
    process.env.DESKTOP_BUILD_FLAVOR = 'test';

    await import('../pre-app-init');

    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      path.join('C:\\Users\\test\\AppData\\Roaming', 'masterino-desktop-test'),
    );
  });
});
