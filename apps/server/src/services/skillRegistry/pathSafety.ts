import path from 'node:path';

const WINDOWS_ABSOLUTE = /^[a-z]:[/\\]/i;

const getPathApi = (root: string) => (WINDOWS_ABSOLUTE.test(root) ? path.win32 : path.posix);

export const assertSafeSkillName = (name: string): void => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new ProjectSkillPathError(
      'INVALID_SKILL_NAME',
      'Skill names must use 1-64 lowercase letters, digits, and hyphens.',
    );
  }
};

export const normalizeRelativeSkillPath = (relativePath: string): string => {
  const normalized = relativePath.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    WINDOWS_ABSOLUTE.test(normalized) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new ProjectSkillPathError('PATH_OUTSIDE_SKILL', `Unsafe skill path: ${relativePath}`);
  }
  return segments.join('/');
};

export const resolveWithin = (root: string, relativePath: string): string => {
  const api = getPathApi(root);
  if (!api.isAbsolute(root)) {
    throw new ProjectSkillPathError('INVALID_ROOT', 'Workspace root must be absolute.');
  }

  const normalizedRelative = normalizeRelativeSkillPath(relativePath);
  const normalizedRoot = api.resolve(root);
  const resolved = api.resolve(normalizedRoot, ...normalizedRelative.split('/'));
  const rootPrefix = normalizedRoot.endsWith(api.sep) ? normalizedRoot : normalizedRoot + api.sep;
  const compareResolved = api === path.win32 ? resolved.toLowerCase() : resolved;
  const comparePrefix = api === path.win32 ? rootPrefix.toLowerCase() : rootPrefix;
  if (!compareResolved.startsWith(comparePrefix)) {
    throw new ProjectSkillPathError('PATH_OUTSIDE_SKILL', `Unsafe skill path: ${relativePath}`);
  }
  return resolved;
};

export const joinAbsolute = (root: string, ...segments: string[]): string => {
  const api = getPathApi(root);
  return api.join(root, ...segments);
};

export class ProjectSkillPathError extends Error {
  constructor(
    readonly code: 'INVALID_ROOT' | 'INVALID_SKILL_NAME' | 'PATH_OUTSIDE_SKILL',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectSkillPathError';
  }
}
