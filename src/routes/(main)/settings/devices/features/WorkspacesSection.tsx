'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { projectWorkspaceSelectors, useProjectWorkspaceStore } from '@/store/projectWorkspace';

import WorkspaceRow from './WorkspaceRow';

interface WorkspacesSectionProps {
  deviceId: string;
}

/** Formal workspaces only; scratch and project-less sandbox rows stay out. */
const WorkspacesSection = memo<WorkspacesSectionProps>(({ deviceId }) => {
  const { t } = useTranslation('chat');
  const tw = t as unknown as (key: string) => string;
  const seamAvailable = useProjectWorkspaceStore(projectWorkspaceSelectors.isSeamAvailable);
  const isWorkspacesInit = useProjectWorkspaceStore((s) => s.isWorkspacesInit);
  const workspaces = useProjectWorkspaceStore(
    projectWorkspaceSelectors.getDeviceWorkspaces(deviceId),
  );
  const { error, isLoading } = useProjectWorkspaceStore((s) => s.useFetchWorkspaces)(true, {
    deviceId,
  });

  return (
    <Flexbox data-testid="device-workspaces-section" gap={6}>
      <Text fontSize={12} type="secondary">
        {tw('workspaceRuntime.settings.workspaces')}
      </Text>
      {!seamAvailable || error ? (
        <Text fontSize={12} type="secondary">
          {tw('workspaceRuntime.settings.workspacesUnavailable')}
        </Text>
      ) : isLoading || !isWorkspacesInit ? (
        <Text fontSize={12} type="secondary">
          {tw('workspaceRuntime.settings.workspacesLoading')}
        </Text>
      ) : workspaces.length === 0 && isWorkspacesInit ? (
        <Text fontSize={12} type="secondary">
          {tw('workspaceRuntime.settings.workspacesEmpty')}
        </Text>
      ) : (
        workspaces.map((workspace) => (
          <WorkspaceRow deviceId={deviceId} key={workspace.id} workspace={workspace} />
        ))
      )}
    </Flexbox>
  );
});

WorkspacesSection.displayName = 'WorkspacesSection';

export default WorkspacesSection;
