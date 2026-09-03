import { describe, expect, it } from 'vitest';

import enUSChat from '../../../../locales/en-US/chat.json';
import enUSComponents from '../../../../locales/en-US/components.json';
import enUSError from '../../../../locales/en-US/error.json';
import enUSSetting from '../../../../locales/en-US/setting.json';
import zhCNChat from '../../../../locales/zh-CN/chat.json';
import zhCNComponents from '../../../../locales/zh-CN/components.json';
import zhCNError from '../../../../locales/zh-CN/error.json';
import zhCNSetting from '../../../../locales/zh-CN/setting.json';
import chat from './chat';
import components from './components';
import error from './error';
import setting from './setting';

/**
 * The canonical `default/*` source is what type-checking and every un-translated locale fall
 * back to. A key that only exists in `locales/en-US` ships as a raw key id elsewhere, so these
 * namespaces are checked in all three files that are hand-maintained in the same PR.
 */
const namespaces = {
  chat: { canonical: chat, enUS: enUSChat, zhCN: zhCNChat },
  components: { canonical: components, enUS: enUSComponents, zhCN: zhCNComponents },
  error: { canonical: error, enUS: enUSError, zhCN: zhCNError },
  setting: { canonical: setting, enUS: enUSSetting, zhCN: zhCNSetting },
} as const;

const requiredKeys: Record<keyof typeof namespaces, string[]> = {
  chat: [
    'compression.inProgress',
    'compression.inProgressHint',
    'workspaceRuntime.settings.workspacesEmpty',
    'workspaceRuntime.settings.workspacesError',
    'workspaceRuntime.settings.workspacesLoading',
    'workspaceRuntime.settings.workspacesRetry',
    'workspaceRuntime.settings.workspacesUnavailable',
  ],
  components: [
    'ModelSelect.inputModality.audio',
    'ModelSelect.inputModality.file',
    'ModelSelect.inputModality.image',
    'ModelSelect.inputModality.notVerified',
    'ModelSelect.inputModality.separator',
    'ModelSelect.inputModality.source',
    'ModelSelect.inputModality.sourceKind.catalog',
    'ModelSelect.inputModality.sourceKind.default',
    'ModelSelect.inputModality.sourceKind.keyword',
    'ModelSelect.inputModality.sourceKind.manual',
    'ModelSelect.inputModality.sourceKind.observed',
    'ModelSelect.inputModality.sourceKind.providerMeta',
    'ModelSelect.inputModality.sourceKind.unknown',
    'ModelSelect.inputModality.state.supported',
    'ModelSelect.inputModality.state.unknown',
    'ModelSelect.inputModality.state.unsupported',
    'ModelSelect.inputModality.supported.audio',
    'ModelSelect.inputModality.supported.file',
    'ModelSelect.inputModality.supported.image',
    'ModelSelect.inputModality.supported.video',
    'ModelSelect.inputModality.textOnly',
    'ModelSelect.inputModality.textOnlyDesc',
    'ModelSelect.inputModality.unverified',
    'ModelSelect.inputModality.unverifiedDesc',
    'ModelSelect.inputModality.verifiedAt',
    'ModelSelect.inputModality.video',
  ],
  error: ['contextBudget.actionFailed'],
  setting: [
    'heterogeneousStatus.cloud.agentEnv.saveError',
    'heterogeneousStatus.cloud.tokenSaveError',
  ],
};

describe('workspace runtime UI locale keys', () => {
  for (const [namespace, files] of Object.entries(namespaces)) {
    describe(namespace, () => {
      for (const [source, bundle] of Object.entries(files)) {
        it(`defines every key the UI reads in ${source}`, () => {
          const missing = requiredKeys[namespace as keyof typeof namespaces].filter(
            (key) => !(bundle as Record<string, string>)[key],
          );

          expect(missing).toEqual([]);
        });
      }
    });
  }
});
