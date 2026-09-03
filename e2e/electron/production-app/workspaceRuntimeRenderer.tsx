import type { ContextBudgetFailCode } from '@lobechat/types/src/contextBudget';
import type {
  ChatInputModalityConclusion,
  EvidenceState,
  ModelCatalogEntry,
} from '@lobechat/types/src/modelCatalog';
import { getChatInputModalityConclusion } from '@lobechat/types/src/modelCatalog';
import type { ChatTopic } from '@lobechat/types/src/topic';
import { MotionProvider } from '@lobehub/ui';
import i18n from 'i18next';
import * as m from 'motion/react-m';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { InputModalityTags } from '@/components/ModelSelect/InputModalityTags';
import RecentSection from '@/features/AgentTopicSidebar/WorkspaceMode/RecentSection';
import type { WorkspaceTopicItemProps } from '@/features/AgentTopicSidebar/WorkspaceMode/types';
import ContextBudgetErrorCard from '@/features/Conversation/Error/ContextBudgetError/ContextBudgetErrorCard';
import CompressionProgress from '@/features/Conversation/Messages/CompressedGroup/CompressionProgress';
import {
  buildContextBudgetErrorViewModel,
  type ContextBudgetUIAction,
  getContextBudgetFailureFromErrorBody,
} from '@/features/Conversation/utils/contextBudgetView';

import chat from '../../../locales/en-US/chat.json';
import components from '../../../locales/en-US/components.json';
import error from '../../../locales/en-US/error.json';

void i18n.use(initReactI18next).init({
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
  lng: 'en-US',
  resources: { 'en-US': { chat, components, error } },
});

const modalityEntry = (
  id: string,
  states: Record<'audio' | 'file' | 'image' | 'video', EvidenceState>,
): ModelCatalogEntry => ({
  abilitySources: Object.fromEntries(
    Object.keys(states).map((modality) => [modality, `manual:electron-e2e-${id}`]),
  ),
  contextWindowSource: 'manual',
  inputModalities: { ...states, text: 'supported' },
  kind: 'chat',
  kindSource: 'manual',
  modelId: id,
  providerId: 'electron-product-renderer',
  verifiedAt: '2026-09-04T00:00:00.000Z',
});

const conclusions: Array<{ conclusion: ChatInputModalityConclusion; id: string }> = [
  {
    conclusion: getChatInputModalityConclusion(
      modalityEntry('vision', {
        audio: 'unsupported',
        file: 'unsupported',
        image: 'supported',
        video: 'unsupported',
      }),
    ),
    id: 'supported',
  },
  {
    conclusion: getChatInputModalityConclusion(
      modalityEntry('text', {
        audio: 'unsupported',
        file: 'unsupported',
        image: 'unsupported',
        video: 'unsupported',
      }),
    ),
    id: 'text-only',
  },
  {
    conclusion: getChatInputModalityConclusion(
      modalityEntry('unverified', {
        audio: 'unknown',
        file: 'unknown',
        image: 'unknown',
        video: 'unknown',
      }),
    ),
    id: 'unknown',
  },
];

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

const topic = (id: string, title: string): ChatTopic => ({
  createdAt: new Date('2026-09-04T00:00:00.000Z'),
  id,
  title,
  updatedAt: new Date('2026-09-04T00:00:00.000Z'),
});

/** Minimal row probe; RecentSection itself is the production module under test. */
const RecentTopicRowProbe = ({ id, scratchWorkspace, title }: WorkspaceTopicItemProps) => (
  <article data-scratch-root={scratchWorkspace?.rootPath} data-testid={`recent-topic-${id}`}>
    <span>{title}</span>
    {scratchWorkspace && <span data-testid={`temporary-marker-${id}`}>Temporary</span>}
  </article>
);

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
      <main data-testid="workspace-runtime-product-ui">
        <h1 data-testid="topic-heading">Topic</h1>
        <RecentSection
          TopicItemComponent={RecentTopicRowProbe}
          entries={[
            {
              placement: { kind: 'recent', reason: 'unbound' },
              topic: topic('topic-unbound', 'Pure chat'),
            },
            {
              placement: { kind: 'recent', reason: 'scratch' },
              topic: topic('topic-scratch', 'Temporary work'),
              workspace: {
                id: 'scratch-workspace',
                kind: 'scratch',
                rootPath: '/tmp/masterino/topic-scratch',
              },
            },
          ]}
        />

        <section aria-label="Model input capabilities" data-testid="model-capabilities">
          {conclusions.map(({ conclusion, id }) => (
            <div data-testid={`model-capability-${id}`} key={id}>
              <InputModalityTags disableTooltip conclusion={conclusion} />
            </div>
          ))}
        </section>

        <section data-testid="compression-progress">
          <CompressionProgress />
        </section>

        <ContextBudgetCards />
      </main>
    </MotionProvider>
  </I18nextProvider>
);

const root = document.querySelector('#workspace-runtime-production-root');
if (!root) throw new Error('Workspace Runtime production E2E root is missing');

createRoot(root).render(<WorkspaceRuntimeProductHarness />);
