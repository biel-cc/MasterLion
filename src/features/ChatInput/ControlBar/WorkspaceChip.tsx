'use client';

import { Flexbox, Icon, Tag, Tooltip } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDownIcon, LockIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';

import DirIcon from './DirIcon';
import type { BindWorkspaceOnce } from './useBindWorkspaceOnce';
import WorkspacePicker from './WorkspacePicker';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    cursor: default;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border: none;
    border-radius: 4px;

    font: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  label: css`
    overflow: hidden;
    max-width: 140px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  lock: css`
    color: ${cssVar.colorTextQuaternary};
  `,
}));

const getDirName = (path: string) => path.split('/').findLast(Boolean) || path;

export interface WorkspaceChipProps {
  bind: BindWorkspaceOnce;
  effective: EffectiveWorkspace;
  repoType?: 'git' | 'github';
}

/**
 * Read-only chip for bound and scratch topics. The primary cwd cannot be
 * changed in place (bind-once); the only action is to start a new topic in
 * another directory that references this one. Scratch never upgrades in place.
 */
const WorkspaceChip = memo<WorkspaceChipProps>(({ bind, effective, repoType }) => {
  const { t } = useTranslation('chat');
  const tw = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const [referenceOpen, setReferenceOpen] = useState(false);

  const cwd = effective.cwd ?? effective.workspace?.rootPath ?? '';
  const isScratch = effective.state === 'scratch';
  const name = effective.workspace?.displayName || getDirName(cwd);

  const tooltip = isScratch
    ? tw('workspaceRuntime.chip.scratchTooltip', { path: cwd })
    : tw('workspaceRuntime.chip.boundTooltip', { path: cwd });

  const chip = (
    <button
      aria-label={tooltip}
      className={styles.chip}
      data-testid="workspace-chip"
      data-workspace-state={effective.state}
      type="button"
    >
      <DirIcon repoType={repoType} />
      <span className={styles.label}>{name}</span>
      {isScratch && (
        <Tag data-testid="workspace-chip-scratch" size={'small'}>
          {tw('workspaceRuntime.chip.scratch')}
        </Tag>
      )}
      <Icon className={styles.lock} icon={LockIcon} size={11} />
      {bind.canStartReferencedTopic && <Icon icon={ChevronDownIcon} size={12} />}
    </button>
  );

  if (!bind.canStartReferencedTopic) {
    return <Tooltip title={tooltip}>{chip}</Tooltip>;
  }

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <DropdownMenu
        items={[
          {
            key: 'new-referenced-topic',
            label: tw('workspaceRuntime.chip.newReferencedTopic'),
            onClick: () => setReferenceOpen(true),
          },
        ]}
      >
        {chip}
      </DropdownMenu>
      <WorkspacePicker
        bind={bind}
        effective={effective}
        mode="reference"
        open={referenceOpen}
        trigger={<span aria-hidden data-testid="workspace-chip-reference-anchor" />}
        onOpenChange={setReferenceOpen}
      />
      {bind.error?.code === 'WORKSPACE_ALREADY_BOUND' && !referenceOpen && (
        <Tooltip title={tw('workspaceRuntime.chip.alreadyBoundHint')}>
          <button
            className={styles.chip}
            data-testid="workspace-chip-already-bound"
            style={{ color: cssVar.colorWarningText }}
            type="button"
            onClick={() => setReferenceOpen(true)}
          >
            {tw('workspaceRuntime.chip.newReferencedTopic')}
          </button>
        </Tooltip>
      )}
    </Flexbox>
  );
});

WorkspaceChip.displayName = 'WorkspaceChip';

export default WorkspaceChip;
