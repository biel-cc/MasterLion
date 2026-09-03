'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import DirIcon from '@/features/ChatInput/ControlBar/DirIcon';
import type { ProjectWorkspaceItem } from '@/services/projectWorkspace';

import WorkspaceExtensions from './WorkspaceExtensions';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  path: css`
    overflow: hidden;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface WorkspaceRowProps {
  deviceId: string;
  workspace: ProjectWorkspaceItem;
}

const getDirName = (path: string) => path.split('/').findLast(Boolean) || path;

const WorkspaceRow = memo<WorkspaceRowProps>(({ deviceId, workspace }) => (
  <Flexbox className={styles.container} data-testid="device-workspace-row" gap={8}>
    <Flexbox horizontal align="center" gap={8}>
      <DirIcon repoType={workspace.repoType} />
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Text ellipsis weight={500}>
          {workspace.displayName || getDirName(workspace.rootPath)}
        </Text>
        <span className={styles.path} title={workspace.rootPath}>
          {workspace.rootPath}
        </span>
      </Flexbox>
    </Flexbox>
    <WorkspaceExtensions deviceId={deviceId} workspace={workspace} />
  </Flexbox>
));

WorkspaceRow.displayName = 'WorkspaceRow';

export default WorkspaceRow;
