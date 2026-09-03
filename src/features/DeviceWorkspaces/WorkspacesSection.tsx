'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
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
  const seamAvailable = useProjectWorkspaceStore(projectWorkspaceSelectors.isSeamAvailable);
  const isWorkspacesInit = useProjectWorkspaceStore((s) => s.isWorkspacesInit);
  const workspaces = useProjectWorkspaceStore(
    projectWorkspaceSelectors.getDeviceWorkspaces(deviceId),
  );
  const { error, isLoading, mutate } = useProjectWorkspaceStore((s) => s.useFetchWorkspaces)(true, {
    deviceId,
  });

  const renderBody = () => {
    // "Unavailable" is reserved for a genuinely missing seam; a failed request is retryable.
    if (!seamAvailable)
      return (
        <Text fontSize={12} type="secondary">
          {t('workspaceRuntime.settings.workspacesUnavailable')}
        </Text>
      );

    if (error)
      return (
        <Flexbox align="flex-start" gap={6} role="alert">
          <Text fontSize={12} type="secondary">
            {t('workspaceRuntime.settings.workspacesError')}
          </Text>
          <Button size="small" onClick={() => void mutate()}>
            {t('workspaceRuntime.settings.workspacesRetry')}
          </Button>
        </Flexbox>
      );

    if (isLoading || !isWorkspacesInit)
      return (
        <Text fontSize={12} type="secondary">
          {t('workspaceRuntime.settings.workspacesLoading')}
        </Text>
      );

    if (workspaces.length === 0)
      return (
        <Text fontSize={12} type="secondary">
          {t('workspaceRuntime.settings.workspacesEmpty')}
        </Text>
      );

    return workspaces.map((workspace) => (
      <WorkspaceRow deviceId={deviceId} key={workspace.id} workspace={workspace} />
    ));
  };

  return (
    <Flexbox data-testid="device-workspaces-section" gap={6}>
      <Text fontSize={12} type="secondary">
        {t('workspaceRuntime.settings.workspaces')}
      </Text>
      {renderBody()}
    </Flexbox>
  );
});

WorkspacesSection.displayName = 'WorkspacesSection';

export default WorkspacesSection;
