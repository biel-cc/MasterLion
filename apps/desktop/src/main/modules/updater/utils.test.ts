import { describe, expect, it } from 'vitest';

import { getManualUpdateDownloadUrl } from './utils';

describe('getManualUpdateDownloadUrl', () => {
  const common = {
    channel: 'canary',
    updateServerUrl: 'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases',
    version: '1.1.2',
  } as const;

  it('returns the Windows x64 installer URL', () => {
    expect(getManualUpdateDownloadUrl({ ...common, arch: 'x64', platform: 'win32' })).toBe(
      'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases/canary/1.1.2/Masterino-1.1.2-setup.exe',
    );
  });

  it.each(['arm64', 'x64'] as const)('returns the macOS %s installer URL', (arch) => {
    expect(getManualUpdateDownloadUrl({ ...common, arch, platform: 'darwin' })).toBe(
      `https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases/canary/1.1.2/Masterino-1.1.2-${arch}.dmg`,
    );
  });

  it('strips a channel suffix from the configured update URL', () => {
    expect(
      getManualUpdateDownloadUrl({
        ...common,
        arch: 'x64',
        platform: 'win32',
        updateServerUrl: `${common.updateServerUrl}/canary/`,
      }),
    ).toBe(
      'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases/canary/1.1.2/Masterino-1.1.2-setup.exe',
    );
  });

  it('returns undefined for unsupported platforms or missing update server', () => {
    expect(
      getManualUpdateDownloadUrl({ ...common, arch: 'x64', platform: 'linux' }),
    ).toBeUndefined();
    expect(
      getManualUpdateDownloadUrl({
        ...common,
        arch: 'x64',
        platform: 'win32',
        updateServerUrl: undefined,
      }),
    ).toBeUndefined();
  });
});
