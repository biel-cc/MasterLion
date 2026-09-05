'use client';

import { TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProjectWorkspaceItem } from '@/services/projectWorkspace';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace';

const MAX_ENV_FILES = 10;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  card: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  count: css`
    color: ${cssVar.colorTextTertiary};
    font-size: 12px;
  `,
  description: css`
    margin: 2px 0 0;
    color: ${cssVar.colorTextSecondary};
    font-size: 12px;
    line-height: 1.5;
  `,
  error: css`
    color: ${cssVar.colorErrorText};
    font-size: 12px;
  `,
  label: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 13px;
    font-weight: 500;
  `,
  status: css`
    color: ${cssVar.colorSuccessText};
    font-size: 12px;
  `,
  title: css`
    margin: 0;
    color: ${cssVar.colorText};
    font-size: 16px;
    line-height: 1.4;
  `,
}));

export const parseEnvFiles = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);

export const isWorkspaceRelativeEnvFile = (value: string): boolean => {
  const normalized = value.replaceAll('\\', '/');
  return (
    !normalized.startsWith('/') &&
    !/^[A-Z]:\//i.test(normalized) &&
    !normalized.split('/').includes('..')
  );
};

interface WorkspaceEnvFilesProps {
  workspace: ProjectWorkspaceItem;
}

export const WorkspaceEnvFiles = memo<WorkspaceEnvFilesProps>(({ workspace }) => {
  const { t } = useTranslation('setting');
  const inputId = useId();
  const persistedText = useMemo(() => (workspace.envFiles ?? []).join('\n'), [workspace.envFiles]);
  const [value, setValue] = useState(persistedText);
  const [baseline, setBaseline] = useState(persistedText);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);
  const updateWorkspace = useProjectWorkspaceStore((state) => state.updateWorkspace);

  useEffect(() => {
    setValue(persistedText);
    setBaseline(persistedText);
    setSaveError(false);
  }, [persistedText, workspace.id]);

  useEffect(() => {
    setSaved(false);
  }, [workspace.id]);

  const envFiles = parseEnvFiles(value);
  const invalidPath = envFiles.find((path) => !isWorkspaceRelativeEnvFile(path));
  const exceedsLimit = envFiles.length > MAX_ENV_FILES;
  const validationError = exceedsLimit
    ? t('workspaceEnvFiles.tooMany', { max: MAX_ENV_FILES })
    : invalidPath
      ? t('workspaceEnvFiles.invalidPath', { path: invalidPath })
      : undefined;
  const normalizedText = envFiles.join('\n');
  const dirty = normalizedText !== baseline;

  const save = async () => {
    if (!dirty || validationError || isSaving) return;
    setIsSaving(true);
    setSaveError(false);
    setSaved(false);
    const result = await updateWorkspace(workspace.id, { envFiles });
    if (result.ok) {
      const nextText = (result.value.envFiles ?? envFiles).join('\n');
      setValue(nextText);
      setBaseline(nextText);
      setSaved(true);
    } else {
      setSaveError(true);
    }
    setIsSaving(false);
  };

  return (
    <section aria-busy={isSaving} aria-labelledby={`${inputId}-title`} className={styles.card}>
      <div>
        <h3 className={styles.title} id={`${inputId}-title`}>
          {t('workspaceEnvFiles.title')}
        </h3>
        <p className={styles.description} id={`${inputId}-description`}>
          {t('workspaceEnvFiles.description')}
        </p>
      </div>

      <label className={styles.label} htmlFor={inputId}>
        {t('workspaceEnvFiles.label')}
      </label>
      <TextArea
        aria-describedby={`${inputId}-description ${inputId}-validation`}
        aria-invalid={!!validationError}
        id={inputId}
        placeholder={t('workspaceEnvFiles.placeholder')}
        rows={5}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setSaveError(false);
          setSaved(false);
        }}
      />
      <span className={styles.count}>
        {t('workspaceEnvFiles.count', { count: envFiles.length, max: MAX_ENV_FILES })}
      </span>

      <div className={styles.actions}>
        <Button
          disabled={!dirty || !!validationError}
          loading={isSaving}
          type="primary"
          onClick={() => void save()}
        >
          {t('workspaceEnvFiles.save')}
        </Button>
        {saved && (
          <span aria-live="polite" className={styles.status} role="status">
            {t('workspaceEnvFiles.saveSuccess')}
          </span>
        )}
      </div>

      <span
        className={styles.error}
        id={`${inputId}-validation`}
        role={validationError ? 'alert' : undefined}
      >
        {validationError}
      </span>
      {saveError && (
        <span className={styles.error} role="alert">
          {t('workspaceEnvFiles.saveError')}
        </span>
      )}
    </section>
  );
});

WorkspaceEnvFiles.displayName = 'WorkspaceEnvFiles';
