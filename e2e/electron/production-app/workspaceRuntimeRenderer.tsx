import { mergeModelCatalogEntry } from '@lobechat/business-model-bank';
import type { ContextBudgetFailCode } from '@lobechat/types/src/contextBudget';
import type { EvidenceState } from '@lobechat/types/src/modelCatalog';
import { MotionProvider } from '@lobehub/ui';
import { App as AntdApp } from 'antd';
import i18n from 'i18next';
import * as m from 'motion/react-m';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';

import { ModelItemRender } from '@/components/ModelSelect';
import { resolveChatModelCatalog } from '@/components/ModelSelect/modality';
import ContextBudgetErrorCard from '@/features/Conversation/Error/ContextBudgetError/ContextBudgetErrorCard';
import CompressionProgress from '@/features/Conversation/Messages/CompressedGroup/CompressionProgress';
import {
  buildContextBudgetErrorViewModel,
  type ContextBudgetUIAction,
  getContextBudgetFailureFromErrorBody,
} from '@/features/Conversation/utils/contextBudgetView';
import SidebarBody from '@/routes/(main)/agent/_layout/Sidebar/Body';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';

import { AGENT_ID, DEVICE_ID } from './workspaceRuntimeTrpcClient';
import chat from '../../../locales/en-US/chat.json';
import common from '../../../locales/en-US/common.json';
import components from '../../../locales/en-US/components.json';
import error from '../../../locales/en-US/error.json';
import topicLocale from '../../../locales/en-US/topic.json';

void i18n.use(initReactI18next).init({
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
  lng: 'en-US',
  resources: { 'en-US': { chat, common, components, error, topic: topicLocale } },
});

/**
 * Seed conversation identity only — the two things a signed-in desktop session
 * would already hold: which agent is open and which topic the route points at.
 *
 * Nothing else is seeded. Topic rows and workspace rows are fetched by the
 * production hooks through the production stores, SWR and services, and only
 * the TRPC transport is deterministic (see `workspaceRuntimeTrpcClient`). If
 * any of that production wiring is disconnected the sidebar stays empty and
 * the spec fails.
 */
const seedProductionSessionIdentity = () => {
  useAgentStore.setState({ activeAgentId: AGENT_ID });
  useChatStore.setState({ activeAgentId: AGENT_ID, activeTopicId: 'topic-scratch' });
  useElectronStore.setState({
    gatewayDeviceInfo: {
      description: 'Electron production E2E device',
      deviceId: DEVICE_ID,
      hostname: 'electron-e2e.local',
      name: 'Electron E2E',
      platform: 'darwin',
    },
  });
};

seedProductionSessionIdentity();

interface ProductModelFixture {
  displayName: string;
  id: string;
  providerId: string;
  settings: { modelCatalog: ReturnType<typeof mergeModelCatalogEntry> };
  type: 'chat';
}

const productModel = (
  id: string,
  displayName: string,
  inputModalities?: Partial<Record<'audio' | 'file' | 'image' | 'text' | 'video', EvidenceState>>,
  endpointTypes: readonly string[] = ['chat'],
): ProductModelFixture => ({
  displayName,
  id,
  providerId: 'electron-product-provider',
  settings: {
    modelCatalog: mergeModelCatalogEntry({
      modelId: id,
      now: '2026-09-04T00:00:00.000Z',
      providerId: 'electron-product-provider',
      providerMetadata: {
        endpointTypes,
        inputModalities,
        verifiedAt: '2026-09-04T00:00:00.000Z',
      },
    }),
  },
  type: 'chat',
});

const modelEvidence = [
  productModel('vision-chat', 'Vision chat', {
    audio: 'unsupported',
    file: 'unsupported',
    image: 'supported',
    text: 'supported',
    video: 'unsupported',
  }),
  productModel('text-chat', 'Text chat', {
    audio: 'unsupported',
    file: 'unsupported',
    image: 'unsupported',
    text: 'supported',
    video: 'unsupported',
  }),
  productModel('unverified-chat', 'Unverified chat'),
  productModel('qwen3-vl-rerank', 'Qwen rerank', undefined, ['rerank']),
];

const chatModels = modelEvidence.filter((model) => resolveChatModelCatalog(model).chatEligible);

const secret = {
  attachment: 'payroll-2026-Q3-CONFIDENTIAL.xlsx',
  message: 'password=hunter2-super-secret',
  toolResult: 'apiKey=AKIA-SECRET-TOOL-RESULT',
  url: 'https://files.internal.example/payroll.xlsx?token=sk-live-9f8e7d',
};

const failureBody = (code: ContextBudgetFailCode) => ({
  attachments: [{ name: secret.attachment, url: secret.url }],
  contextBudget: {
    decision: {
      actions: ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'],
      code,
      kind: 'fail',
      offending: [
        { content: secret.toolResult, estimatedTokens: 120_000, source: 'tool-result' },
        { content: secret.message, estimatedTokens: 30_000, source: 'attachment' },
      ],
    },
    trace: {
      attempt: 1,
      effectiveWindowSource: 'assumed',
      effectiveWindowTokens: 32_000,
      estimatedPromptTokens: 150_000,
      modelId: 'masterino-chat',
      providerId: 'aihub',
      rawPrompt: secret.message,
      warnings: ['WINDOW_UNKNOWN'],
    },
  },
  message: secret.message,
  toolResult: secret.toolResult,
});

const failureViewModel = (code: ContextBudgetFailCode) => {
  const payload = getContextBudgetFailureFromErrorBody(failureBody(code));
  if (!payload) throw new Error(`Could not build ${code} context-budget fixture`);
  return buildContextBudgetErrorViewModel(payload);
};

const ContextBudgetCards = () => {
  const [lastAction, setLastAction] = useState<ContextBudgetUIAction>();

  return (
    <section data-last-action={lastAction} data-testid="context-budget-cards">
      {(['TAIL_TOO_LARGE', 'NO_CANDIDATES', 'SUMMARY_FAILED', 'RETRY_EXHAUSTED'] as const).map(
        (code) => (
          <div data-context-budget-code={code} key={code}>
            <ContextBudgetErrorCard
              viewModel={failureViewModel(code)}
              onAction={(action) => setLastAction(action)}
            />
          </div>
        ),
      )}
    </section>
  );
};

const WorkspaceRuntimeProductHarness = () => (
  <I18nextProvider i18n={i18n}>
    <MotionProvider motion={m}>
      <MemoryRouter initialEntries={[`/agent/${AGENT_ID}/topic/topic-scratch`]}>
        <AntdApp>
          <main data-testid="workspace-runtime-product-ui">
            <section data-testid="production-agent-sidebar">
              <SidebarBody />
            </section>

            <section aria-label="Model input capabilities" data-testid="model-capabilities">
              {chatModels.map((model) => (
                <div data-model-id={model.id} data-testid={`model-row-${model.id}`} key={model.id}>
                  <ModelItemRender {...model} showInfoTag={false} />
                </div>
              ))}
            </section>

            <section data-testid="compression-progress">
              <CompressionProgress />
            </section>

            <ContextBudgetCards />
          </main>
        </AntdApp>
      </MemoryRouter>
    </MotionProvider>
  </I18nextProvider>
);

const root = document.querySelector('#workspace-runtime-production-root');
if (!root) throw new Error('Workspace Runtime production E2E root is missing');

createRoot(root).render(<WorkspaceRuntimeProductHarness />);
