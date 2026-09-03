import { vi } from 'vitest';

/**
 * Legacy AiAgent unit suites use intentionally tiny database doubles. Make
 * their execution authority explicit: the topic exists but is unbound and has
 * no persisted additional-directory grants. Security-specific suites provide
 * their own stateful mocks instead of importing this fixture.
 */
vi.mock('@/server/services/projectWorkspace/bindingStore', () => ({
  DatabaseTopicWorkspaceBindingStore: vi.fn().mockImplementation(() => ({
    captureTargetIfAbsent: vi.fn(),
    getState: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/server/services/workspaceAccessGrant', () => ({
  WorkspaceAccessGrantService: vi.fn().mockImplementation(() => ({
    buildAccessRoots: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/aiModel', async () => {
  const { mergeModelCatalogEntry } = await import('@lobechat/business-model-bank');
  return {
    AiModelModel: vi.fn().mockImplementation(() => ({
      findByIdAndProvider: vi
        .fn()
        .mockImplementation(async (modelId: string, providerId: string) => ({
          settings: {
            modelCatalog: mergeModelCatalogEntry({
              modelId,
              providerId,
              providerMetadata: { endpointTypes: ['chat/completions'] },
            }),
          },
          type: 'chat',
        })),
      getAllModels: vi.fn().mockResolvedValue([]),
    })),
  };
});
