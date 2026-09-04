'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { type ProjectWorkspaceErrorCode, useProjectWorkspaceStore } from '@/store/projectWorkspace';

import CloudRepoSwitcher from './CloudRepoSwitcher';
import GitStatus from './GitStatus';
import HeteroDeviceSwitcher from './HeteroDeviceSwitcher';
import { useBindWorkspaceOnce } from './useBindWorkspaceOnce';
import { useRepoType } from './useRepoType';
import WorkspaceChip from './WorkspaceChip';
import WorkspacePicker from './WorkspacePicker';

const styles = createStaticStyles(({ css }) => ({
  targetError: css`
    padding-inline: 4px;
    font-size: 11px;
    color: ${cssVar.colorErrorText};
    white-space: nowrap;
  `,
}));

interface WorkspaceControlsProps {
  agentId: string;
  /**
   * Force the workspace cluster to show even when the runtime isn't in local
   * mode. Heterogeneous agents always run inside a working directory, so they
   * pass `true`; normal agents only surface it for device-capable plans.
   */
  alwaysShowWorkspace?: boolean;
}

/**
 * Workspace/Project control strip shared by the chat-input control bars:
 * target switcher + (picker | read-only chip) + git status.
 *
 * All state comes from `useEffectiveWorkspace` (the accepted contract). A
 * draft/unbound topic gets the bind-once picker; bound and scratch topics get
 * a read-only chip. Target switches only touch the draft intent or the current
 * topic snapshot, never the agent's stored defaults.
 */
const WorkspaceControls = memo<WorkspaceControlsProps>(
  ({ agentId, alwaysShowWorkspace = false }) => {
    const { t } = useTranslation('chat');
    const tw = t as unknown as (key: string, options?: Record<string, unknown>) => string;

    const isHeterogeneous = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
    const effective = useEffectiveWorkspace(agentId);
    const bind = useBindWorkspaceOnce(effective, agentId);

    const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
    const seamAvailable = useProjectWorkspaceStore((s) => s.seamAvailable);
    const setDraftTargetIntent = useProjectWorkspaceStore((s) => s.setDraftTargetIntent);
    const captureTopicTarget = useProjectWorkspaceStore((s) => s.captureTopicTarget);
    const [targetError, setTargetError] = useState<ProjectWorkspaceErrorCode>();

    const handleSelectTarget = useCallback(
      async (target: DeviceExecutionTarget, deviceId?: string) => {
        setTargetError(undefined);
        const targetDeviceId =
          target === 'device'
            ? deviceId
            : target === 'local'
              ? (deviceId ?? currentDeviceId)
              : undefined;
        if (effective.isDraft || !effective.topicId) {
          setDraftTargetIntent(effective.draftKey, { target, targetDeviceId });
          return;
        }
        const outcome = await captureTopicTarget({
          boundDeviceId: targetDeviceId,
          target,
          topicId: effective.topicId,
        });
        if (!outcome.ok) setTargetError(outcome.code);
      },
      [
        captureTopicTarget,
        currentDeviceId,
        effective.draftKey,
        effective.isDraft,
        effective.topicId,
        setDraftTargetIntent,
      ],
    );

    const isDeviceTarget = effective.target === 'local' || effective.target === 'device';
    const isLocalDevice =
      isDesktop && !!effective.targetDeviceId && effective.targetDeviceId === currentDeviceId;
    const cwd = effective.cwd;

    // Local machine probes the filesystem for repoType; a remote device's repoType
    // comes from the cached `workingDirs` entry (we can't probe a remote fs here).
    const localRepoType = useRepoType(isLocalDevice ? cwd : undefined);
    const remoteDirs = useDeviceStore(
      deviceSelectors.getDeviceWorkingDirs(effective.targetDeviceId),
    );
    const remoteRepoType = remoteDirs.find((d) => d.path === cwd)?.repoType;
    const repoType = isLocalDevice ? localRepoType : remoteRepoType;

    const renderWorkspace = () => {
      // Web has no local filesystem — cloud / heterogeneous agents browse the repo
      // through the cloud repo switcher when they are not routed to a device.
      if (!isDesktop && !isDeviceTarget) {
        return isHeterogeneous || alwaysShowWorkspace ? (
          <CloudRepoSwitcher agentId={agentId} />
        ) : null;
      }

      // Plain chat (plan none) has no execution environment: nothing to pick,
      // nothing to bind, no service call.
      if (!isDeviceTarget || (!alwaysShowWorkspace && effective.context.plan.kind === 'none')) {
        return null;
      }

      if (seamAvailable && (effective.state === 'bound' || effective.state === 'scratch')) {
        return (
          <>
            <WorkspaceChip bind={bind} effective={effective} repoType={repoType} />
            {cwd && repoType && (
              <GitStatus
                deviceId={isLocalDevice ? undefined : effective.targetDeviceId}
                isGithub={repoType === 'github'}
                path={cwd}
              />
            )}
          </>
        );
      }

      return <WorkspacePicker bind={bind} effective={effective} />;
    };

    return (
      <>
        <HeteroDeviceSwitcher
          agentId={agentId}
          boundDeviceId={effective.targetDeviceId ?? effective.recommendation.deviceId}
          executionTarget={effective.target}
          onSelectTarget={handleSelectTarget}
        />
        {targetError && (
          <span className={styles.targetError} role="alert">
            {targetError === 'SEAM_UNAVAILABLE'
              ? tw('workspaceRuntime.target.seamUnavailable')
              : tw('workspaceRuntime.target.captureFailed')}
          </span>
        )}
        {renderWorkspace()}
      </>
    );
  },
);

WorkspaceControls.displayName = 'WorkspaceControls';

export default WorkspaceControls;
