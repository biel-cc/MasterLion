'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getAgentEnvKeyError, isEditableAgentEnvKey } from './agentEnvPolicy';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  description: css`
    margin: 2px 0 0;
    color: ${cssVar.colorTextSecondary};
    font-size: 12px;
    line-height: 1.5;
  `,
  empty: css`
    padding-block: 6px;
    color: ${cssVar.colorTextTertiary};
    font-size: 12px;
  `,
  error: css`
    color: ${cssVar.colorErrorText};
    font-size: 12px;
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  `,
  form: css`
    display: grid;
    grid-template-columns: minmax(140px, 1fr) minmax(180px, 2fr) auto;
    gap: 8px;
    align-items: end;

    @media (max-width: 720px) {
      grid-template-columns: 1fr;
    }
  `,
  key: css`
    overflow: hidden;
    color: ${cssVar.colorText};
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  label: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 12px;
    font-weight: 500;
  `,
  list: css`
    display: flex;
    flex-direction: column;
    padding: 0;
    margin: 0;
    list-style: none;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  row: css`
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(160px, 2fr) auto;
    gap: 8px;
    align-items: center;
    min-height: 40px;
    padding: 7px 9px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: 0;
    }
  `,
  status: css`
    color: ${cssVar.colorSuccessText};
    font-size: 12px;
  `,
  value: css`
    overflow: hidden;
    color: ${cssVar.colorTextSecondary};
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface AgentEnvironmentEditorProps {
  disabled?: boolean;
  env: Record<string, string>;
  onEnvChange: (env: Record<string, string>) => Promise<void> | void;
}

export const AgentEnvironmentEditor = memo<AgentEnvironmentEditorProps>(
  ({ disabled, env, onEnvChange }) => {
    const { t } = useTranslation('setting');
    const id = useId();
    const [key, setKey] = useState('');
    const [value, setValue] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [mutationError, setMutationError] = useState(false);
    const [status, setStatus] = useState('');

    const entries = useMemo(
      () =>
        Object.entries(env)
          .filter(([name]) => isEditableAgentEnvKey(name))
          .toSorted(),
      [env],
    );
    const normalizedKey = key.trim();
    const keyError = normalizedKey ? getAgentEnvKeyError(normalizedKey) : undefined;
    const validationMessage = keyError
      ? {
          invalid: t('heterogeneousStatus.cloud.agentEnv.invalidKey'),
          managed: t('heterogeneousStatus.cloud.agentEnv.managedKey', { key: normalizedKey }),
          reserved: t('heterogeneousStatus.cloud.agentEnv.reservedKey', { key: normalizedKey }),
          sensitive: t('heterogeneousStatus.cloud.agentEnv.sensitiveKey', { key: normalizedKey }),
        }[keyError]
      : undefined;
    const canSave =
      !disabled && !!normalizedKey && !!value.length && !validationMessage && !isSaving;
    const exists = !keyError && Object.hasOwn(env, normalizedKey);

    const save = async () => {
      if (!canSave) return;
      setIsSaving(true);
      setMutationError(false);
      setStatus('');
      try {
        await onEnvChange({ ...env, [normalizedKey]: value });
        setKey('');
        setValue('');
        setStatus(t('heterogeneousStatus.cloud.agentEnv.saveSuccess', { key: normalizedKey }));
      } catch {
        setMutationError(true);
      } finally {
        setIsSaving(false);
      }
    };

    const remove = async (name: string) => {
      if (disabled || isSaving || !isEditableAgentEnvKey(name)) return;
      const nextEnv = { ...env };
      delete nextEnv[name];
      setIsSaving(true);
      setMutationError(false);
      setStatus('');
      try {
        await onEnvChange(nextEnv);
        setStatus(t('heterogeneousStatus.cloud.agentEnv.removeSuccess', { key: name }));
      } catch {
        setMutationError(true);
      } finally {
        setIsSaving(false);
      }
    };

    return (
      <Flexbox aria-busy={isSaving} gap={8}>
        <div>
          <span className={styles.label}>{t('heterogeneousStatus.cloud.agentEnv.title')}</span>
          <p className={styles.description} id={`${id}-description`}>
            {t('heterogeneousStatus.cloud.agentEnv.description')}
          </p>
        </div>

        {entries.length === 0 ? (
          <span className={styles.empty}>{t('heterogeneousStatus.cloud.agentEnv.empty')}</span>
        ) : (
          <ul
            aria-label={t('heterogeneousStatus.cloud.agentEnv.listLabel')}
            className={styles.list}
          >
            {entries.map(([name, entryValue]) => (
              <li className={styles.row} key={name}>
                <span className={styles.key}>{name}</span>
                <span className={styles.value} title={entryValue}>
                  {entryValue}
                </span>
                <Button
                  aria-label={t('heterogeneousStatus.cloud.agentEnv.removeLabel', { key: name })}
                  disabled={disabled || isSaving}
                  size="small"
                  onClick={() => void remove(name)}
                >
                  {t('heterogeneousStatus.cloud.agentEnv.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          aria-label={t('heterogeneousStatus.cloud.agentEnv.formLabel')}
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-key`}>
              {t('heterogeneousStatus.cloud.agentEnv.keyLabel')}
            </label>
            <Input
              aria-describedby={`${id}-description ${id}-validation`}
              aria-invalid={!!validationMessage}
              autoCapitalize="characters"
              autoComplete="off"
              disabled={disabled || isSaving}
              id={`${id}-key`}
              placeholder={t('heterogeneousStatus.cloud.agentEnv.keyPlaceholder')}
              spellCheck={false}
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                setMutationError(false);
                setStatus('');
              }}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-value`}>
              {t('heterogeneousStatus.cloud.agentEnv.valueLabel')}
            </label>
            <Input
              disabled={disabled || isSaving}
              id={`${id}-value`}
              placeholder={t('heterogeneousStatus.cloud.agentEnv.valuePlaceholder')}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setMutationError(false);
                setStatus('');
              }}
            />
          </div>
          <Button disabled={!canSave} htmlType="submit" loading={isSaving} type="primary">
            {exists
              ? t('heterogeneousStatus.cloud.agentEnv.update')
              : t('heterogeneousStatus.cloud.agentEnv.add')}
          </Button>
        </form>

        <span
          className={styles.error}
          id={`${id}-validation`}
          role={validationMessage ? 'alert' : undefined}
        >
          {validationMessage}
        </span>
        {mutationError && (
          <span className={styles.error} role="alert">
            {t('heterogeneousStatus.cloud.agentEnv.saveError')}
          </span>
        )}
        {status && (
          <span aria-live="polite" className={styles.status} role="status">
            {status}
          </span>
        )}
      </Flexbox>
    );
  },
);

AgentEnvironmentEditor.displayName = 'AgentEnvironmentEditor';
