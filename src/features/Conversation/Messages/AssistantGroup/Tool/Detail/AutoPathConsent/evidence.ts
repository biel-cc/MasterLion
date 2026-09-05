import type { PathAccessMode } from '@lobechat/types/src/executionContext';

/**
 * The frozen contract auto-allows at most three read-only roots taken from a direct
 * user message. More roots than that means the state is not the evidence we expect.
 */
export const MAX_AUTO_CONSENT_ROOTS = 3;

/**
 * Canonical, device-authored evidence that a successful tool call read paths the user
 * named in their own message. It is assembled only from the runtime `scopeAudit` the
 * desktop gateway returns; tool arguments and message text are never consulted.
 */
export interface AutoPathConsentEvidence {
  deviceId: string;
  operationId: string;
  /**
   * Device-canonical authorization roots that matched, deduplicated in audit order.
   * These — never the access targets below them — are what a topic grant is made from.
   */
  roots: string[];
  topicId: string;
}

interface AuditEntry {
  deviceId?: string;
  mode: PathAccessMode;
  operationId?: string;
  path: string;
  rootPath: string;
  scopeVerdict: string;
  source: string;
  topicId?: string;
}

/** Compare device-canonical paths; only the separator flavor is normalized. */
export const normalizeCanonicalPath = (value: string) =>
  value.replaceAll('\\', '/').replace(/(?!^)\/+$/, '');

export const isWithinRoot = (rootPath: string, target: string): boolean => {
  const root = normalizeCanonicalPath(rootPath);
  const path = normalizeCanonicalPath(target);
  return root === path || path.startsWith(root.endsWith('/') ? root : `${root}/`);
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const asAuditEntry = (value: unknown): AuditEntry | undefined => {
  if (!value || typeof value !== 'object') return;
  const entry = value as Record<string, unknown>;
  if (
    !isNonEmptyString(entry.path) ||
    !isNonEmptyString(entry.scopeVerdict) ||
    !isNonEmptyString(entry.source) ||
    !isNonEmptyString(entry.mode)
  ) {
    return;
  }

  return {
    deviceId: isNonEmptyString(entry.deviceId) ? entry.deviceId : undefined,
    mode: entry.mode as PathAccessMode,
    operationId: isNonEmptyString(entry.operationId) ? entry.operationId : undefined,
    path: entry.path,
    // Absent on runtimes that predate the root-carrying audit; such an entry is
    // dropped below rather than falling back to the target.
    rootPath: isNonEmptyString(entry.rootPath) ? entry.rootPath : '',
    scopeVerdict: entry.scopeVerdict,
    source: entry.source,
    topicId: isNonEmptyString(entry.topicId) ? entry.topicId : undefined,
  };
};

/**
 * Accept only a fully formed, self-consistent success audit. Anything partial,
 * mixed across operations, or larger than the frozen cap is rejected outright:
 * a half-known authorization must not be presented to the user as a known one.
 */
export const parseAutoPathConsentEvidence = (
  pluginState: unknown,
): AutoPathConsentEvidence | undefined => {
  if (!pluginState || typeof pluginState !== 'object') return;
  const audit = (pluginState as Record<string, unknown>).scopeAudit;
  if (!Array.isArray(audit) || audit.length === 0) return;

  const entries = audit.map(asAuditEntry);
  // One malformed entry means the whole audit is untrustworthy.
  if (entries.some((entry) => !entry)) return;

  const auto = (entries as AuditEntry[]).filter((entry) => entry.source === 'direct-user-message');
  if (auto.length === 0) return;

  const { deviceId, operationId, topicId } = auto[0];
  if (!deviceId || !operationId || !topicId) return;

  const consistent = auto.every(
    (entry) =>
      entry.mode === 'read' &&
      entry.scopeVerdict === `consent:${operationId}` &&
      entry.deviceId === deviceId &&
      entry.operationId === operationId &&
      entry.topicId === topicId &&
      // The runtime must name the root it matched, and the audited target has to
      // sit inside it. A target that escapes its own root is contradictory evidence.
      !!entry.rootPath &&
      isWithinRoot(entry.rootPath, entry.path),
  );
  if (!consistent) return;

  const roots: string[] = [];
  for (const { rootPath } of auto) {
    // Several targets commonly share one authorized root; it is granted once.
    if (!roots.some((root) => normalizeCanonicalPath(root) === normalizeCanonicalPath(rootPath))) {
      roots.push(rootPath);
    }
  }
  if (roots.length > MAX_AUTO_CONSENT_ROOTS) return;

  return { deviceId, operationId, roots, topicId };
};
