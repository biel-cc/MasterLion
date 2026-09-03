'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import type { ProjectWorkspaceItem } from '@/services/projectWorkspace';
import { useWorkspaceExtensions } from '@/store/projectWorkspace';

interface WorkspaceExtensionsProps {
  deviceId: string;
  workspace: ProjectWorkspaceItem;
}

/**
 * Integration mount only. Environment and skill owners register renderers;
 * this lane deliberately imports neither feature nor guesses its API.
 */
const WorkspaceExtensions = memo<WorkspaceExtensionsProps>(({ deviceId, workspace }) => {
  const extensions = useWorkspaceExtensions();
  if (extensions.length === 0) return null;

  return (
    <Flexbox data-testid="workspace-extensions" gap={8}>
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
