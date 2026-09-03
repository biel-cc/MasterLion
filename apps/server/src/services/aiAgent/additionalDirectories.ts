import type {
  ExecutionAccessRoot,
  PathAccessMode,
} from '@lobechat/types/src/executionContext';

import { isAbsoluteFilesystemPath, normalizeRootPath } from '@/helpers/executionContext';

const MODES: readonly PathAccessMode[] = ['read', 'write', 'exec'];
const SCOPE_PRIORITY = { operation: 1, primary: 3, topic: 2 } as const;

const escapeXmlAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

interface PromptDirectory {
  expiresAt?: string;
  modes: Set<PathAccessMode>;
  rootPath: string;
  scope: ExecutionAccessRoot['scope'];
}

/**
 * Describe the operation's effective filesystem roots to the model without
 * exposing grant ids, topic ids, device ids, or any file content. Persisted
 * grants have already been filtered for revoke/archive/expiry by the service.
 * Direct-message candidates are intentionally omitted: they are not approved
 * roots until the consent coordinator has produced user-approval evidence.
 */
export const buildAdditionalDirectoriesPrompt = (
  roots: readonly ExecutionAccessRoot[] | undefined,
  now = new Date(),
): string | undefined => {
  const directories = new Map<string, PromptDirectory>();

  for (const root of roots ?? []) {
    if (root.source === 'direct-user-message' || root.scope === 'primary') continue;

    const rootPath = normalizeRootPath(root.rootPath);
    if (!isAbsoluteFilesystemPath(rootPath)) continue;

    const modes = MODES.filter((mode) => root.modes.includes(mode));
    if (modes.length === 0) continue;

    const expiresAt = root.expiresAt ? new Date(root.expiresAt) : undefined;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)) continue;

    const existing = directories.get(rootPath);
    if (!existing) {
      directories.set(rootPath, {
        expiresAt: expiresAt?.toISOString(),
        modes: new Set(modes),
        rootPath,
        scope: root.scope,
      });
      continue;
    }

    for (const mode of modes) existing.modes.add(mode);
    if (SCOPE_PRIORITY[root.scope] > SCOPE_PRIORITY[existing.scope]) existing.scope = root.scope;
    // A non-expiring root dominates an expiring duplicate. Otherwise keep the
    // later expiry because it describes the effective union of permissions.
    if (!root.expiresAt || !existing.expiresAt) existing.expiresAt = undefined;
    else if (expiresAt && expiresAt.toISOString() > existing.expiresAt) {
      existing.expiresAt = expiresAt.toISOString();
    }
  }

  if (directories.size === 0) return undefined;

  const lines = [...directories.values()]
    .sort((left, right) => left.rootPath.localeCompare(right.rootPath))
    .map((directory) => {
      const modes = MODES.filter((mode) => directory.modes.has(mode)).join(',');
      const expiry = directory.expiresAt
        ? ` expires_at="${escapeXmlAttribute(directory.expiresAt)}"`
        : '';
      return `  <directory path="${escapeXmlAttribute(directory.rootPath)}" modes="${modes}" scope="${directory.scope}"${expiry} />`;
    });

  return [
    '<additional_directories>',
    'These directories are approved for this operation only in the listed modes. They do not change the primary working directory.',
    ...lines,
    '</additional_directories>',
  ].join('\n');
};
