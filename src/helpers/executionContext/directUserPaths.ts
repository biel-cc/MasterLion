import { isAbsoluteFilesystemPath, normalizeRootPath } from './workspaceIdentity';

const MAX_DIRECT_ROOTS = 3;
const MARKDOWN_FENCE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g;
const INLINE_CODE = /`[^`\n]*(?:`|$)/g;
const MARKDOWN_QUOTE_LINE = /^\s*>.*$/gm;
const INJECTED_BLOCK =
  /<(?:attachment|file|refer_topic)\b[^>]*>[\s\S]*?<\/(?:attachment|file|refer_topic)>/gi;
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\([^)\n]*\)/g;

/**
 * A direct path may only be inferred from a plain, first-party text message.
 * Callers must separately reject attachments, automation and other injected
 * sources because those facts are not represented by the markdown string.
 */
export const containsNonPlainPathSource = (text: string): boolean =>
  /^\s*>|```|~~~|`|^(?: {4}|\t)\S|!?\[[^\]\n]*\]\([^)\n]*\)|<(?:attachments?|files?(?:_info)?|refer_topic)\b/im.test(
    text,
  );

const trimCandidate = (value: string): string =>
  value.trim().replace(/[，。；;！？!?、）)\]}]+$/u, '');

/**
 * Extract explicit absolute paths only from ordinary prose. Paths inside
 * references, code, attachments and links are removed before matching.
 * Results are normalized, unique, ordered, and capped to keep the authority
 * surface deliberately small.
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

