import { useMemo } from 'react';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useAiInfraStore } from '@/store/aiInfra';
import { type AIProviderStoreState } from '@/store/aiInfra/initialState';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

import {
  type ChatModelCatalogInput,
  filterChatEligibleProviderModels,
  resolveChatModelCatalog,
  type ResolvedChatModelCatalog,
  toChatModelCatalogInput,
} from './modality';

const selectEnabledAiModels = (s: AIProviderStoreState) => s.enabledAiModels;

/**
 * Resolve the B1 catalog evidence for one model row. List rows and the detail panel share
 * this hook so both always reach the same input-modality conclusion.
 */
export const useChatModelCatalog = (row: ChatModelCatalogInput): ResolvedChatModelCatalog => {
  const enabledAiModels = useAiInfraStore(selectEnabledAiModels);
  const { abilities, id, providerId, settings, type } = row;

  return useMemo(
    () =>
      resolveChatModelCatalog(
        toChatModelCatalogInput({ abilities, id, providerId, settings, type }, enabledAiModels),
      ),
    [abilities, enabledAiModels, id, providerId, settings, type],
  );
};

/**
 * The enabled chat model list, re-checked against B1 chat eligibility. The store already
 * filters with the same helpers; this keeps the UI from ever rendering a non-chat row.
 */
export const useChatEligibleModelList = (): EnabledProviderWithModels[] => {
  const enabledChatModelList = useEnabledChatModels();
  const enabledAiModels = useAiInfraStore(selectEnabledAiModels);

  return useMemo(
    () => filterChatEligibleProviderModels(enabledChatModelList, enabledAiModels),
    [enabledAiModels, enabledChatModelList],
  );
};
