import type * as LobeChatConst from '@lobechat/const';
import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import { SettingsTabs } from '@/store/global/initialState';
import { initServerConfigStore, Provider } from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';

import { useCategory } from './useCategory';

const platform = vi.hoisted(() => ({ isDesktop: false }));
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobeChatConst>()),
  get isDesktop() {
    return platform.isDesktop;
  },
}));

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    },
  });
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const createWrapper = (showProvider: boolean, enableMemory = false) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider
      createStore={() =>
        initServerConfigStore({
          featureFlags: {
            ...mapFeatureFlagsEnvToState({
              provider_settings: true,
            }),
            showProvider,
            enableMemory,
          },
        })
      }
    >
      {children}
    </Provider>
  );

  return Wrapper;
};

const getItemKeys = () => {
  const { result } = renderHook(() => useCategory(), {
    wrapper: createWrapper(true),
  });

  return result.current.flatMap((group) => group.items.map((item) => item.key));
};

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  platform.isDesktop = false;
  useUserStore.setState(initialUserStoreState, true);
});

describe('settings useCategory', () => {
  it('exposes device workspace settings only in Electron', () => {
    platform.isDesktop = true;
    expect(getItemKeys()).toContain(SettingsTabs.Devices);
    platform.isDesktop = false;
    expect(getItemKeys()).not.toContain(SettingsTabs.Devices);
  });
  it('keeps Provider visible when provider settings are enabled', () => {
    expect(getItemKeys()).toContain(SettingsTabs.Provider);
  });

  it('hides Provider when provider settings are disabled', () => {
    const { result } = renderHook(() => useCategory(), {
      wrapper: createWrapper(false),
    });

    const keys = result.current.flatMap((group) => group.items.map((item) => item.key));

    expect(keys).not.toContain(SettingsTabs.Provider);
  });

  it('hides non-core settings while the product is converged to chat', () => {
    const keys = getItemKeys();

    expect(keys).toContain(SettingsTabs.Profile);
    expect(keys).toContain(SettingsTabs.Appearance);
    expect(keys).toContain(SettingsTabs.Provider);
    expect(keys).toContain(SettingsTabs.ServiceModel);
    expect(keys).not.toContain(SettingsTabs.Devices);
    expect(keys).not.toContain(SettingsTabs.Skill);
    expect(keys).not.toContain(SettingsTabs.Memory);
    expect(keys).not.toContain(SettingsTabs.Creds);
    expect(keys).not.toContain(SettingsTabs.Messenger);
    expect(keys).not.toContain(SettingsTabs.Storage);
    expect(keys).not.toContain(SettingsTabs.Advanced);
  });

  it('shows Memory only when the runtime flag is enabled', () => {
    const { result } = renderHook(() => useCategory(), {
      wrapper: createWrapper(true, true),
    });

    const keys = result.current.flatMap((group) => group.items.map((item) => item.key));

    expect(keys).toContain(SettingsTabs.Memory);
  });
});
