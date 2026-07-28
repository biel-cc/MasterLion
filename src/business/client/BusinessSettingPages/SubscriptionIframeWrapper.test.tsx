import { render, waitFor } from '@testing-library/react';

import { SubscriptionIframeWrapper } from './SubscriptionIframeWrapper';

const mocks = vi.hoisted(() => ({
  cloudServer: 'https://masterion.bielcrystal.com',
  setupSubscriptionWebviewSession: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: (key: string) => key }),
}));

vi.mock('@/hooks/useIsCloudActive', () => ({
  useIsCloudActive: () => true,
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/electron/selectors/sync', () => ({
  electronSyncSelectors: {
    remoteServerUrl: () => mocks.cloudServer,
  },
}));

vi.mock('@/services/electron/remoteServer', () => ({
  remoteServerService: {
    setupSubscriptionWebviewSession: mocks.setupSubscriptionWebviewSession,
  },
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openExternalLink: vi.fn() },
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: () => true,
}));

vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: { enableBusinessFeatures: vi.fn() },
}));

describe('SubscriptionIframeWrapper', () => {
  beforeEach(() => {
    mocks.cloudServer = 'https://masterion.bielcrystal.com';
  });

  it('loads desktop cloud subscription pages from the Masterino origin', async () => {
    const { container } = render(<SubscriptionIframeWrapper page="usage" />);

    await waitFor(() => expect(container.querySelector('webview')).toBeTruthy());

    expect(mocks.setupSubscriptionWebviewSession).toHaveBeenCalledWith('persist:subscription');
    expect(container.querySelector('webview')).toHaveAttribute(
      'src',
      'https://masterion.bielcrystal.com/embed/subscription/usage?hl=zh-CN',
    );
  });

  it('uses the selected test Cloud alias for subscription pages', async () => {
    mocks.cloudServer = 'https://mlai-test.bielcrystal.com';

    const { container } = render(<SubscriptionIframeWrapper page="usage" />);

    await waitFor(() => expect(container.querySelector('webview')).toBeTruthy());
    expect(container.querySelector('webview')).toHaveAttribute(
      'src',
      'https://mlai-test.bielcrystal.com/embed/subscription/usage?hl=zh-CN',
    );
  });
});
