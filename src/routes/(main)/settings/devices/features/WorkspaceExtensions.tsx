'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceEnv, type WorkspaceEnvClient } from '@/features/WorkspaceEnv';
import { WorkspaceEnvFiles } from '@/features/WorkspaceEnvFiles';
import { WorkspaceSkillsSettings } from '@/features/WorkspaceSkillsSettings';
import type { ProjectWorkspaceItem } from '@/services/projectWorkspace';
import { projectWorkspaceService } from '@/services/projectWorkspace';
import { useWorkspaceExtensions } from '@/store/projectWorkspace';

interface WorkspaceExtensionsProps {
  deviceId: string;
  workspace: ProjectWorkspaceItem;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    padding-block-start: 8px;
  `,
  section: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  summary: css`
    cursor: pointer;
    padding-block: 8px;
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    &:focus-visible {
      border-radius: ${cssVar.borderRadius};
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
    }
  `,
}));

const workspaceEnvClient: WorkspaceEnvClient = {
  list: (workspaceId) => projectWorkspaceService.listEnv(workspaceId),
  revoke: (workspaceId, key) => projectWorkspaceService.revokeEnv(workspaceId, key),
  save: (workspaceId, entry) => projectWorkspaceService.saveEnv(workspaceId, entry),
};

const WorkspaceExtensions = memo<WorkspaceExtensionsProps>(({ deviceId, workspace }) => {
  const { t: translate } = useTranslation('setting');
  const t = translate as unknown as (key: string) => string;
  const extensions = useWorkspaceExtensions();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  return (
    <Flexbox data-testid="workspace-extensions" gap={8}>
      <details
        className={styles.section}
        onToggle={(event) => {
          const { open } = event.currentTarget;
          setExpandedKeys((keys) =>
            open
              ? [...new Set([...keys, 'environment'])]
              : keys.filter((key) => key !== 'environment'),
          );
        }}
      >
        <summary className={styles.summary}>{t('workspaceEnv.title')}</summary>
        <div className={styles.body}>
          {expandedKeys.includes('environment') && (
            <WorkspaceEnv client={workspaceEnvClient} workspaceId={workspace.id} />
          )}
        </div>
      </details>
      <details
        className={styles.section}
        onToggle={(event) => {
          const { open } = event.currentTarget;
          setExpandedKeys((keys) =>
            open
              ? [...new Set([...keys, 'environment-files'])]
              : keys.filter((key) => key !== 'environment-files'),
          );
        }}
      >
        <summary className={styles.summary}>{t('workspaceEnvFiles.title')}</summary>
        <div className={styles.body}>
          {expandedKeys.includes('environment-files') && (
            <WorkspaceEnvFiles workspace={workspace} />
          )}
        </div>
      </details>
      <details
        className={styles.section}
        onToggle={(event) => {
          const { open } = event.currentTarget;
          setExpandedKeys((keys) =>
            open ? [...new Set([...keys, 'skills'])] : keys.filter((key) => key !== 'skills'),
          );
        }}
      >
        <summary className={styles.summary}>{t('workspaceSkills.title')}</summary>
        <div className={styles.body}>
          {expandedKeys.includes('skills') && (
            <WorkspaceSkillsSettings deviceId={deviceId} workspace={workspace} />
          )}
        </div>
      </details>
      {extensions.map((extension) => (
        <div data-extension-key={extension.key} key={extension.key}>
          {extension.render({ deviceId, workspace })}
        </div>
      ))}
    </Flexbox>
  );
});

WorkspaceExtensions.displayName = 'WorkspaceExtensions';

export default WorkspaceExtensions;
