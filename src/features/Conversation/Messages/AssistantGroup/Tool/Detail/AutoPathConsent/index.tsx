'use client';

import type { WorkspaceAccessGrant } from '@lobechat/types/src/executionContext';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { projectWorkspaceSelectors, useProjectWorkspaceStore } from '@/store/projectWorkspace';

import { type AutoPathConsentEvidence, isWithinRoot, normalizeCanonicalPath } from './evidence';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  card: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  error: css`
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorErrorText};
  `,
  note: css`
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  paths: css`
    display: flex;
    flex-direction: column;
    gap: 2px;

    margin: 0;
    padding: 0;

    list-style: none;

    li {
      overflow-wrap: anywhere;
      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      color: ${cssVar.colorText};
    }
  `,
  status: css`
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    font-size: 13px;
    font-weight: 600;
    line-height: 1.5;
    color: ${cssVar.colorText};
  `,
}));

export interface AutoPathConsentNoticeProps {
  evidence: AutoPathConsentEvidence;
  /** Tool message that carried the audit; recorded as the grant's provenance. */
  messageId?: string;
  toolCallId: string;
}

const isActiveReadGrant = (grant: WorkspaceAccessGrant) =>
  !grant.revokedAt && grant.modes.includes('read');

/**
 * Shown on a successful tool call whose runtime audit says the read was authorized by a
 * root taken from the user's own message. The card reports what was already released and
 * offers the only two authorizations that still exist server-side: keep it for the topic,
 * or revoke a topic authorization for exactly these roots.
 */
const AutoPathConsentNotice = memo<AutoPathConsentNoticeProps>(
  ({ evidence, messageId, toolCallId }) => {
    const { t } = useTranslation('tool');
    const baseId = useId();
    const noteId = `${baseId}-note`;
    const { deviceId, roots, topicId } = evidence;

    const grantTopicAccess = useProjectWorkspaceStore((s) => s.grantTopicAccess);
    const revokeTopicGrant = useProjectWorkspaceStore((s) => s.revokeTopicGrant);
    const grants = useProjectWorkspaceStore(
      projectWorkspaceSelectors.getTopicGrants(topicId, deviceId),
    );
    const {
      error: grantsError,
      isLoading,
      mutate,
    } = useProjectWorkspaceStore((s) => s.useFetchTopicGrants)(topicId, deviceId);

    const [pending, setPending] = useState<'revoke' | 'upgrade'>();
    const [errorKey, setErrorKey] = useState<string>();
    const [statusKey, setStatusKey] = useState<string>();

    const activeGrants = grants.filter(isActiveReadGrant);
    const uncoveredRoots = roots.filter(
      (root) => !activeGrants.some((grant) => isWithinRoot(grant.rootPath, root)),
    );
    // Only a grant for exactly one of these roots is this card's to revoke; a broader
    // ancestor grant was authorized elsewhere and must not be removed from here.
    const revocableGrants = activeGrants.filter((grant) =>
      roots.some((root) => normalizeCanonicalPath(root) === normalizeCanonicalPath(grant.rootPath)),
    );

    const busy = !!pending || isLoading;
    const canUpgrade = !busy && !grantsError && uncoveredRoots.length > 0;
    const canRevoke = !busy && !grantsError && revocableGrants.length > 0;

    const run = useCallback(
      async (action: 'revoke' | 'upgrade', task: () => Promise<void>) => {
        // Guards a second click while the first request is still in flight.
        if (pending) return;
        setPending(action);
        setErrorKey(undefined);
        setStatusKey(undefined);
        try {
          await task();
          setStatusKey(`workspaceAutoPathConsent.${action}Done`);
        } catch (error) {
          console.error(`[AutoPathConsent] ${action} failed:`, error);
          setErrorKey(`workspaceAutoPathConsent.${action}Failed`);
        } finally {
          setPending(undefined);
        }
      },
      [pending],
    );

    const upgrade = useCallback(
      () =>
        run('upgrade', async () => {
          // The grant is made from the authorization root the runtime matched, never
          // from the file the tool happened to touch inside it.
          for (const rootPath of uncoveredRoots) {
            const outcome = await grantTopicAccess({
              deviceId,
              modes: ['read'],
              requestedVia: { messageId, reason: 'direct-user-message-consent', toolCallId },
              rootPath,
              topicId,
            });
            if (!outcome.ok) throw new Error(outcome.message || outcome.code);
          }
        }),
      [deviceId, grantTopicAccess, messageId, run, toolCallId, topicId, uncoveredRoots],
    );

    const revoke = useCallback(
      () =>
        run('revoke', async () => {
          for (const grant of revocableGrants) {
            const outcome = await revokeTopicGrant({ deviceId, id: grant.id, topicId });
            if (!outcome.ok) throw new Error(outcome.message || outcome.code);
          }
        }),
      [deviceId, revocableGrants, revokeTopicGrant, run, topicId],
    );

    return (
      <Flexbox aria-busy={busy} className={styles.card} data-testid="auto-path-consent">
        <span className={styles.title}>{t('workspaceAutoPathConsent.title')}</span>
        <ul aria-label={t('workspaceAutoPathConsent.pathsLabel')} className={styles.paths}>
          {roots.map((root) => (
            <li key={root}>{root}</li>
          ))}
        </ul>
        <p className={styles.note} id={noteId}>
          {t('workspaceAutoPathConsent.note')}
        </p>

        {grantsError ? (
          <Flexbox align="flex-start" gap={6} role="alert">
            <p className={styles.error}>{t('workspaceAutoPathConsent.grantsError')}</p>
            <Button size="small" onClick={() => void mutate()}>
              {t('workspaceAutoPathConsent.grantsRetry')}
            </Button>
          </Flexbox>
        ) : (
          <div
            aria-label={t('workspaceAutoPathConsent.actions')}
            className={styles.actions}
            role="group"
          >
            <Button
              aria-describedby={noteId}
              disabled={!canUpgrade}
              loading={pending === 'upgrade'}
              size="small"
              type="primary"
              onClick={() => void upgrade()}
            >
              {t('workspaceAutoPathConsent.upgrade')}
            </Button>
            <Button
              danger
              aria-describedby={noteId}
              disabled={!canRevoke}
              loading={pending === 'revoke'}
              size="small"
              onClick={() => void revoke()}
            >
              {t('workspaceAutoPathConsent.revoke')}
            </Button>
          </div>
        )}

        {!grantsError && !isLoading && uncoveredRoots.length === 0 && (
          <p className={styles.status}>{t('workspaceAutoPathConsent.upgradeUnavailable')}</p>
        )}
        {!grantsError && !isLoading && revocableGrants.length === 0 && (
          <p className={styles.status}>{t('workspaceAutoPathConsent.revokeUnavailable')}</p>
        )}

        {statusKey && (
          <p aria-live="polite" className={styles.status} role="status">
            {t(statusKey as 'workspaceAutoPathConsent.upgradeDone')}
          </p>
        )}
        {errorKey && (
          <p className={styles.error} role="alert">
            {t(errorKey as 'workspaceAutoPathConsent.upgradeFailed')}
          </p>
        )}
      </Flexbox>
    );
  },
);

AutoPathConsentNotice.displayName = 'AutoPathConsentNotice';

export default AutoPathConsentNotice;
