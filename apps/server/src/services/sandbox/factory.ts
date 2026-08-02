import { sandboxEnv } from '@/envs/sandbox';
import { MarketService } from '@/server/services/market';

import { DisabledSandboxProvider } from './providers/disabled';
import { MarketSandboxProvider } from './providers/market';
import { OnlyboxesSandboxProvider } from './providers/onlyboxes';
import { SandboxMiddlewareService } from './service';
import type {
  SandboxProvider,
  SandboxProviderKind,
  SandboxService,
  SandboxServiceOptions,
} from './types';

export const isSandboxConfigured = (): boolean => {
  if (sandboxEnv.SANDBOX_PROVIDER === 'market') return true;

  if (sandboxEnv.SANDBOX_PROVIDER === 'onlyboxes') {
    return Boolean(sandboxEnv.ONLYBOXES_BASE_URL && sandboxEnv.ONLYBOXES_JIT_SIGNING_KEY);
  }

  return false;
};

export const getSandboxProviderKind = (): SandboxProviderKind => {
  if (!isSandboxConfigured()) return 'disabled';

  return sandboxEnv.SANDBOX_PROVIDER === 'market' ? 'market' : 'onlyboxes';
};

const createSandboxProvider = (options: SandboxServiceOptions): SandboxProvider => {
  switch (getSandboxProviderKind()) {
    case 'disabled': {
      return new DisabledSandboxProvider();
    }

    case 'onlyboxes': {
      return new OnlyboxesSandboxProvider(options);
    }

    case 'market': {
      if (!options.marketService && !process.env.MARKET_BASE_URL) {
        throw new Error('MARKET_BASE_URL is required for the Market sandbox provider');
      }

      const marketService =
        options.marketService ??
        new MarketService({
          userInfo: { userId: options.userId },
        });

      return new MarketSandboxProvider({ ...options, marketService });
    }
  }
};

export const createSandboxService = (options: SandboxServiceOptions): SandboxService => {
  return new SandboxMiddlewareService(createSandboxProvider(options), options);
};
