'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, Icon, Popover, Tag, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  MonitorOffIcon,
} from 'lucide-react';
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';
import { deviceService } from '@/services/device';
import { electronSystemService } from '@/services/electron/system';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { projectWorkspaceSelectors, useProjectWorkspaceStore } from '@/store/projectWorkspace';

import { openAddWorkingDirModal } from './AddWorkingDirModal';
import DirIcon from './DirIcon';
import type { BindWorkspaceOnce, WorkspaceSelection } from './useBindWorkspaceOnce';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

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

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  buttonAttention: css`
    color: ${cssVar.colorWarningText};
    background: ${cssVar.colorWarningBg};
  `,
  buttonLabel: css`
    overflow: hidden;
    max-width: 160px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  error: css`
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorErrorText};

    background: ${cssVar.colorErrorBg};
  `,
  errorAction: css`
    cursor: pointer;

    margin-block-start: 4px;
    padding: 0;
    border: none;

    font: inherit;
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorPrimary};

    background: transparent;
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    padding-block: 6px;
    padding-inline: 8px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    font: inherit;
    text-align: start;

    background: transparent;

    transition: background-color 0.2s;

    &:hover,
    &:focus-visible {
      background: ${cssVar.colorFillTertiary};
      outline: none;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
  `,
  itemName: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  itemPath: css`
    overflow: hidden;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  note: css`
    padding-block: 2px 4px;
    padding-inline: 8px;

    font-size: 11px;
    line-height: 1.4;
    color: ${cssVar.colorTextQuaternary};
  `,
  scroll: css`
    overflow-y: auto;
    max-height: 320px;
  `,
  sectionTitle: css`
    padding-block: 6px 2px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

const getDirName = (path: string) => path.split('/').findLast(Boolean) || path;

interface PickerRow extends WorkspaceSelection {
  kind: 'recommendation' | 'recent' | 'workspace';
  label: string;
  recommendationSource?: 'agent' | 'device';
}

export interface WorkspacePickerProps {
  bind: BindWorkspaceOnce;
  effective: EffectiveWorkspace;
  /**
   * `select` binds the current draft/unbound topic (bind-once).
   * `reference` starts a new draft topic in the picked directory that
   * references the current (already bound/scratch) topic.
   */
  mode?: 'reference' | 'select';
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  /** Custom trigger; defaults to the "select workspace" chip. */
  trigger?: ReactNode;
}

/**
 * Workspace picker for draft / unbound topics. Recommendations (agent default
 * directory, device default directory) are listed as suggestions only — they
 * never populate the cwd until the user explicitly picks one. Sandbox is never
 * offered here; it must be chosen from the target switcher.
 */
const WorkspacePicker = memo<WorkspacePickerProps>(
  ({ bind, effective, mode = 'select', onOpenChange, open: controlledOpen, trigger }) => {
    const { t } = useTranslation('chat');
    const tw = t as unknown as (key: string, options?: Record<string, unknown>) => string;

    const [innerOpen, setInnerOpen] = useState(false);
    const open = controlledOpen ?? innerOpen;
    const setOpen = (next: boolean) => {
      setInnerOpen(next);
      onOpenChange?.(next);
      if (!next) bind.clearError();
    };

    const triggerRef = useRef<HTMLButtonElement>(null);
    const pickerFocusNonce = useProjectWorkspaceStore(projectWorkspaceSelectors.pickerFocusNonce);
    const lastFocusNonce = useRef(pickerFocusNonce);
    useEffect(() => {
      if (pickerFocusNonce === lastFocusNonce.current) return;
      lastFocusNonce.current = pickerFocusNonce;
      triggerRef.current?.focus();
      setInnerOpen(true);
      onOpenChange?.(true);
    }, [mode, onOpenChange, pickerFocusNonce]);

    const deviceId = bind.deviceId;
    const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
    const isLocalDevice = isDesktop && !!deviceId && deviceId === currentDeviceId;

    const workspaces = useProjectWorkspaceStore(
      projectWorkspaceSelectors.getDeviceWorkspaces(deviceId),
    );
    const recents = useDeviceStore(deviceSelectors.getDeviceWorkingDirs(deviceId));
    const seamAvailable = useProjectWorkspaceStore(projectWorkspaceSelectors.isSeamAvailable);

    const rows = useMemo<PickerRow[]>(() => {
      const seen = new Set<string>();
      const list: PickerRow[] = [];
      const push = (row: PickerRow) => {
        if (seen.has(row.path)) return;
        seen.add(row.path);
        list.push(row);
      };
      const { agentDefault, deviceDefault } = effective.recommendation;
      if (agentDefault) {
        push({
          kind: 'recommendation',
          label: getDirName(agentDefault),
          path: agentDefault,
          recommendationSource: 'agent',
        });
      }
      if (deviceDefault) {
        push({
          kind: 'recommendation',
          label: getDirName(deviceDefault),
          path: deviceDefault,
          recommendationSource: 'device',
        });
      }
      for (const workspace of workspaces) {
        push({
          kind: 'workspace',
          label: workspace.displayName || getDirName(workspace.rootPath),
          path: workspace.rootPath,
          repoType: workspace.repoType,
        });
      }
      for (const entry of recents) {
        push({
          kind: 'recent',
          label: getDirName(entry.path),
          path: entry.path,
          repoType: entry.repoType,
        });
      }
      return list;
    }, [effective.recommendation, recents, workspaces]);

    const run = mode === 'reference' ? bind.startReferencedTopic : bind.select;

    const pick = async (selection: WorkspaceSelection) => {
      const ok = await run(selection);
      if (ok) setOpen(false);
    };

    const chooseLocalFolder = async () => {
      const result = await electronSystemService.selectFolder({
        title: tw('workspaceRuntime.picker.chooseFolder'),
      });
      if (result?.path) await pick({ path: result.path, repoType: result.repoType });
    };

    const addRemotePath = () => {
      setOpen(false);
      openAddWorkingDirModal({
        onSubmit: async (path) => {
          const stat = deviceId ? await deviceService.statPath(deviceId, path) : undefined;
          if (stat) {
            if (!stat.exists) return tw('workspaceRuntime.picker.pathNotExist');
            if (!stat.isDirectory) return tw('workspaceRuntime.picker.pathNotDirectory');
          }
          const ok = await run({ path, repoType: stat?.repoType });
          return ok ? undefined : tw('workspaceRuntime.picker.bindFailed');
        },
      });
    };

    const unavailable =
      effective.state === 'unrouted'
        ? tw(`workspaceRuntime.picker.unrouted.${effective.unroutedReason ?? 'no-bound-device'}`)
        : effective.target === 'sandbox'
          ? tw('workspaceRuntime.picker.sandboxFixed')
          : effective.target === 'none'
            ? tw('workspaceRuntime.picker.targetNone')
            : undefined;

    const renderError = () => {
      if (!bind.error) return null;
      if (bind.error.code === 'WORKSPACE_ALREADY_BOUND') {
        return (
          <div className={styles.error} role="alert">
            {tw('workspaceRuntime.picker.alreadyBound')}
          </div>
        );
      }
      return (
        <div className={styles.error} role="alert">
          {bind.error.code === 'SEAM_UNAVAILABLE'
            ? tw('workspaceRuntime.picker.seamUnavailable')
            : (bind.error.message ?? tw('workspaceRuntime.picker.bindFailed'))}
        </div>
      );
    };

    const sections: Array<{ key: PickerRow['kind']; title: string }> = [
      { key: 'recommendation', title: tw('workspaceRuntime.picker.recommended') },
      { key: 'workspace', title: tw('workspaceRuntime.picker.workspaces') },
      { key: 'recent', title: tw('workspaceRuntime.picker.recentDirs') },
    ];

    const content = (
      <Flexbox
        aria-label={tw('workspaceRuntime.picker.title')}
        data-testid="workspace-picker"
        gap={4}
        role="dialog"
        style={{ minWidth: 300 }}
      >
        <div className={styles.sectionTitle}>
          {mode === 'reference'
            ? tw('workspaceRuntime.picker.referenceTitle')
            : tw('workspaceRuntime.picker.title')}
        </div>
        {!seamAvailable && (
          <div className={styles.note}>{tw('workspaceRuntime.picker.seamUnavailable')}</div>
        )}
        {unavailable ? (
          <div className={styles.note} data-testid="workspace-picker-unavailable">
            {unavailable}
          </div>
        ) : (
          <>
            <div className={styles.scroll}>
              {sections.map(({ key, title }) => {
                const items = rows.filter((row) => row.kind === key);
                if (items.length === 0) return null;
                return (
                  <Flexbox gap={2} key={key}>
                    <div className={styles.sectionTitle}>{title}</div>
                    {key === 'recommendation' && (
                      <div className={styles.note}>
                        {tw('workspaceRuntime.picker.recommendedNote')}
                      </div>
                    )}
                    {items.map((row) => (
                      <button
                        className={styles.item}
                        data-testid={`workspace-picker-row-${row.kind}`}
                        disabled={bind.pending}
                        key={row.path}
                        type="button"
                        onClick={() => void pick(row)}
                      >
                        <DirIcon repoType={row.repoType} />
                        <Flexbox flex={1} style={{ minWidth: 0 }}>
                          <Flexbox horizontal align={'center'} gap={6}>
                            <span className={styles.itemName}>{row.label}</span>
                            {row.kind === 'recommendation' && (
                              <Tag size={'small'}>
                                {row.recommendationSource === 'agent'
                                  ? tw('workspaceRuntime.picker.recommendedAgent')
                                  : tw('workspaceRuntime.picker.recommendedDevice')}
                              </Tag>
                            )}
                          </Flexbox>
                          <span className={styles.itemPath}>{row.path}</span>
                        </Flexbox>
                      </button>
                    ))}
                  </Flexbox>
                );
              })}
              {rows.length === 0 && (
                <div className={styles.note}>{tw('workspaceRuntime.picker.empty')}</div>
              )}
            </div>
            {isLocalDevice ? (
              <button
                className={styles.item}
                data-testid="workspace-picker-choose-folder"
                disabled={bind.pending}
                type="button"
                onClick={() => void chooseLocalFolder()}
              >
                <Icon icon={FolderOpenIcon} size={14} />
                <span>{tw('workspaceRuntime.picker.chooseFolder')}</span>
              </button>
            ) : (
              <button
                className={styles.item}
                data-testid="workspace-picker-add-path"
                disabled={bind.pending}
                type="button"
                onClick={addRemotePath}
              >
                <Icon icon={FolderPlusIcon} size={14} />
                <span>{tw('workspaceRuntime.picker.addPath')}</span>
              </button>
            )}
          </>
        )}
        {renderError()}
      </Flexbox>
    );

    const needsAttention = effective.state === 'unbound' || effective.state === 'unrouted';
    const defaultTrigger = (
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cx(styles.button, needsAttention && styles.buttonAttention)}
        data-testid="workspace-picker-trigger"
        ref={triggerRef}
        type="button"
      >
        <Icon icon={effective.state === 'unrouted' ? MonitorOffIcon : FolderIcon} size={14} />
        <span className={styles.buttonLabel}>
          {effective.state === 'unrouted'
            ? tw('workspaceRuntime.picker.unroutedLabel')
            : tw('workspaceRuntime.picker.selectWorkspace')}
        </span>
        <Icon icon={ChevronDownIcon} size={12} />
      </button>
    );

    return (
      <Popover
        content={content}
        open={open}
        placement="topLeft"
        trigger="click"
        onOpenChange={setOpen}
      >
        {trigger ?? (
          <Tooltip title={tw('workspaceRuntime.picker.unboundTooltip')}>{defaultTrigger}</Tooltip>
        )}
      </Popover>
    );
  },
);

WorkspacePicker.displayName = 'WorkspacePicker';

export default WorkspacePicker;
