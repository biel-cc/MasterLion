import type { ExecutionAccessRoot } from '@lobechat/types/src/executionContext';

import {
  containsNonPlainPathSource,
  extractDirectUserAbsolutePathCandidates,
} from '@/helpers/executionContext';

const INJECTED_REFERENCE = /<(?:attachments?|files?(?:_info)?|refer_topic)\b/i;

export { extractDirectUserAbsolutePathCandidates };

export const buildDirectUserMessageAccessRoots = (params: {
  appScope?: string | null;
  automationMode?: string | null;
  botConversation: boolean;
  cronJobId?: string;
  ephemeralUserMessage?: string;
  evalRun: boolean;
  hasAttachments: boolean;
  headless: boolean;
  operationId: string;
  prompt: string;
  suppressUserMessage: boolean;
  taskId?: string;
  topicId: string;
  trigger?: string;
}): ExecutionAccessRoot[] => {
  const excluded =
    params.botConversation ||
    !!params.cronJobId ||
    !!params.ephemeralUserMessage ||
    params.evalRun ||
    params.hasAttachments ||
    params.headless ||
    params.suppressUserMessage ||
    !!params.taskId ||
    params.appScope === 'task' ||
    params.automationMode === 'heartbeat' ||
    params.automationMode === 'schedule' ||
    INJECTED_REFERENCE.test(params.prompt) ||
    containsNonPlainPathSource(params.prompt) ||
    params.trigger === 'cron' ||
    params.trigger === 'task';
  if (excluded) return [];

  return extractDirectUserAbsolutePathCandidates(params.prompt).map((rootPath) => ({
    modes: ['read'],
    operationId: params.operationId,
    rootPath,
    scope: 'operation',
    source: 'direct-user-message',
    topicId: params.topicId,
  }));
};
