import type { ExecutionAccessRoot } from '@lobechat/types/src/executionContext';

import { isAbsoluteFilesystemPath, normalizeRootPath } from '@/helpers/executionContext';

const MAX_DIRECT_ROOTS = 3;
const MARKDOWN_FENCE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;
const INLINE_CODE = /`[^`\n]*(?:`|$)/g;
const MARKDOWN_QUOTE_LINE = /^\s*>.*$/gm;
const INJECTED_BLOCK =
  /<(?:attachment|file|refer_topic)\b[^>]*>[\s\S]*?<\/(?:attachment|file|refer_topic)>/gi;
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\([^)\n]*\)/g;
const INJECTED_REFERENCE = /<(?:attachments?|files?(?:_info)?|refer_topic)\b/i;
const NON_PLAIN_MARKDOWN = /^\s*>|```|~~~|`|^(?: {4}|\t)\S|!?\[[^\]\n]*\]\([^)\n]*\)/m;

const trimCandidate = (value: string): string =>
  value.trim().replace(/[，。；;！？!?、）)\]}]+$/u, '');

/**
 * Extract only explicit absolute paths from the current plain user message.
 * The output remains a candidate: the device must realpath the root and target
 * before it can authorize a concrete read.
 */
export const extractDirectUserAbsolutePathCandidates = (text: string): string[] => {
  const plain = text
    .replaceAll(MARKDOWN_FENCE, ' ')
    .replaceAll(MARKDOWN_QUOTE_LINE, ' ')
    .replaceAll(INJECTED_BLOCK, ' ')
    .replaceAll(MARKDOWN_LINK, ' ')
    .replaceAll(INLINE_CODE, ' ');
  const matches: Array<{ index: number; value: string }> = [];

  // Quoting is required for paths containing spaces. Unquoted paths stop at
  // whitespace or common prose delimiters, keeping this parser conservative.
  for (const match of plain.matchAll(/(?:^|[\s（(：:])(["'])([^"'\r\n]+)\1/gu)) {
    matches.push({ index: match.index ?? 0, value: trimCandidate(match[2]) });
  }
  for (const match of plain.matchAll(
    /(?:^|[\s（(：:])((?:\/(?!\/)|~[\\/]|[A-Za-z]:[\\/])[^\s，。；;！？!?、（）()[\]{}<>"']*)/gu,
  )) {
    matches.push({ index: match.index ?? 0, value: trimCandidate(match[1]) });
  }

  const unique = new Set<string>();
  for (const { value: candidate } of matches.sort((left, right) => left.index - right.index)) {
    if (!candidate || (!isAbsoluteFilesystemPath(candidate) && !/^~[\\/]/.test(candidate))) {
      continue;
    }
    unique.add(normalizeRootPath(candidate));
    if (unique.size === MAX_DIRECT_ROOTS) break;
  }
  return [...unique];
};

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
    NON_PLAIN_MARKDOWN.test(params.prompt) ||
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
