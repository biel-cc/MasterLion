'use client';

import { Button, Empty, Input, Skeleton } from '@lobehub/ui';
import { confirmModal, Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkspaceEnvClient, WorkspaceEnvEntrySummary } from './types';

const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const MASKED_VALUE = '••••••••';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  `,
  card: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  description: css`
    margin: 4px 0 0;
    color: ${cssVar.colorTextSecondary};
  `,
  empty: css`
    padding-block: 24px;
  `,
  error: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadius};
    color: ${cssVar.colorErrorText};
    background: ${cssVar.colorErrorBg};
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  `,
  form: css`
    display: grid;
    grid-template-columns: minmax(160px, 1fr) minmax(220px, 2fr) auto;
    gap: 12px;
    align-items: end;

    @media (max-width: 720px) {
      grid-template-columns: 1fr;
    }
  `,
  header: css`
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;
  `,
  key: css`
    overflow: hidden;
    font-family: ${cssVar.fontFamilyCode};
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  label: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 13px;
    font-weight: 500;
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    margin: 0;
    list-style: none;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  row: css`
    display: grid;
    grid-template-columns: minmax(140px, 1fr) minmax(120px, 1fr) auto;
    gap: 12px;
    align-items: center;
    min-height: 52px;
    padding: 10px 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: 0;
    }
  `,
  secretControl: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 32px;
  `,
  title: css`
    margin: 0;
    color: ${cssVar.colorText};
    font-size: 18px;
    line-height: 1.4;
  `,
  value: css`
    color: ${cssVar.colorTextSecondary};
    font-family: ${cssVar.fontFamilyCode};
  `,
  validation: css`
    color: ${cssVar.colorErrorText};
    font-size: 12px;
  `,
}));

export interface WorkspaceEnvProps {
  client: WorkspaceEnvClient;
  description?: string;
  title?: string;
  workspaceId: string;
}

const sortEntries = (entries: WorkspaceEnvEntrySummary[]) =>
  [...entries].sort((left, right) => left.key.localeCompare(right.key));

const WorkspaceEnv = memo<WorkspaceEnvProps>(({ client, description, title, workspaceId }) => {
  const { t: translate } = useTranslation('setting');
  const t = translate as unknown as (key: string, options?: Record<string, string>) => string;
  const inputId = useId();
  const validationId = useId();
  const loadSequence = useRef(0);
  const [entries, setEntries] = useState<WorkspaceEnvEntrySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [revokingKey, setRevokingKey] = useState<string>();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [secret, setSecret] = useState(true);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      const nextEntries = await client.list(workspaceId);
      if (sequence !== loadSequence.current) return;
      setEntries(sortEntries(nextEntries));
    } catch {
      if (sequence !== loadSequence.current) return;
      setLoadError(true);
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const normalizedKey = key.trim();
  const keyIsInvalid = normalizedKey.length > 0 && !ENV_KEY_PATTERN.test(normalizedKey);
  const canSave = normalizedKey.length > 0 && value.length > 0 && !keyIsInvalid && !isSaving;

  const save = async () => {
    if (!canSave) return;
    setIsSaving(true);
    setMutationError(false);
    setStatus('');
    try {
      await client.save(workspaceId, { key: normalizedKey, secret, value });
      setEntries((current) =>
        sortEntries([
          ...current.filter((entry) => entry.key !== normalizedKey),
          { key: normalizedKey, secret },
        ]),
      );
      setKey('');
      setValue('');
      setSecret(true);
      setStatus(t('workspaceEnv.saveSuccess'));
    } catch {
      setMutationError(true);
    } finally {
      setIsSaving(false);
    }
  };

  const revoke = (entry: WorkspaceEnvEntrySummary) => {
    confirmModal({
      content: t('workspaceEnv.revokeConfirmDescription', { key: entry.key }),
      okButtonProps: { danger: true },
      okText: t('workspaceEnv.revoke'),
      onOk: async () => {
        setRevokingKey(entry.key);
        setMutationError(false);
        setStatus('');
        try {
          await client.revoke(workspaceId, entry.key);
          setEntries((current) => current.filter(({ key }) => key !== entry.key));
          setStatus(t('workspaceEnv.revokeSuccess', { key: entry.key }));
        } catch {
          setMutationError(true);
          throw new Error(t('workspaceEnv.saveError'));
        } finally {
          setRevokingKey(undefined);
        }
      },
      title: t('workspaceEnv.revokeConfirmTitle'),
    });
  };

  return (
    <section aria-busy={isLoading} aria-labelledby={`${inputId}-title`} className={styles.card}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title} id={`${inputId}-title`}>
            {title ?? t('workspaceEnv.title')}
          </h2>
          <p className={styles.description}>{description ?? t('workspaceEnv.description')}</p>
        </div>
      </div>

      {isLoading ? (
        <div aria-live="polite" role="status">
          <span className="sr-only">{t('workspaceEnv.loading')}</span>
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        </div>
      ) : loadError ? (
        <div className={styles.error} role="alert">
          <p>{t('workspaceEnv.loadError')}</p>
          <Button onClick={load}>{t('workspaceEnv.retry')}</Button>
        </div>
      ) : (
        <>
          {entries.length === 0 ? (
            <div className={styles.empty}>
              <Empty description={t('workspaceEnv.empty')} />
            </div>
          ) : (
            <ul aria-label={t('workspaceEnv.configuredList')} className={styles.list}>
              {entries.map((entry) => (
                <li className={styles.row} key={entry.key}>
                  <span className={styles.key}>{entry.key}</span>
                  <span
                    className={styles.value}
                    aria-label={
                      entry.secret
                        ? t('workspaceEnv.maskedValueLabel', { key: entry.key })
                        : t('workspaceEnv.configuredValueLabel', { key: entry.key })
                    }
                  >
                    {entry.secret ? MASKED_VALUE : t('workspaceEnv.configured')}
                  </span>
                  <Button
                    danger
                    aria-label={t('workspaceEnv.revokeLabel', { key: entry.key })}
                    disabled={!!revokingKey}
                    loading={revokingKey === entry.key}
                    size="small"
                    onClick={() => revoke(entry)}
                  >
                    {t('workspaceEnv.revoke')}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <form
            aria-label={t('workspaceEnv.formLabel')}
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${inputId}-key`}>
                {t('workspaceEnv.keyLabel')}
              </label>
              <Input
                aria-describedby={keyIsInvalid ? validationId : undefined}
                aria-invalid={keyIsInvalid}
                autoCapitalize="none"
                autoComplete="off"
                id={`${inputId}-key`}
                placeholder={t('workspaceEnv.keyPlaceholder')}
                spellCheck={false}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              {keyIsInvalid && (
                <span className={styles.validation} id={validationId} role="alert">
                  {t('workspaceEnv.invalidKey')}
                </span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${inputId}-value`}>
                {t('workspaceEnv.valueLabel')}
              </label>
              <Input
                autoComplete="new-password"
                id={`${inputId}-value`}
                placeholder={t('workspaceEnv.valuePlaceholder')}
                type={secret ? 'password' : 'text'}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>

            <div className={styles.actions}>
              <label className={styles.secretControl}>
                <Switch
                  aria-label={t('workspaceEnv.secretLabel')}
                  checked={secret}
                  onChange={setSecret}
                />
                <span>{t('workspaceEnv.secret')}</span>
              </label>
              <Button disabled={!canSave} htmlType="submit" loading={isSaving} type="primary">
                {t('workspaceEnv.save')}
              </Button>
            </div>
          </form>
        </>
      )}

      {mutationError && (
        <div className={styles.error} role="alert">
          {t('workspaceEnv.saveError')}
        </div>
      )}
      {status && (
        <span aria-live="polite" role="status">
          {status}
        </span>
      )}
    </section>
  );
});

WorkspaceEnv.displayName = 'WorkspaceEnv';

export default WorkspaceEnv;
