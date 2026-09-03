'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceEnv, type WorkspaceEnvClient } from '@/features/WorkspaceEnv';
import { projectWorkspaceService } from '@/services/projectWorkspace';

const userEnvClient: WorkspaceEnvClient = {
  list: () => projectWorkspaceService.listUserEnv(),
  revoke: (_scope, key) => projectWorkspaceService.revokeUserEnv(key),
  save: (_scope, entry) => projectWorkspaceService.saveUserEnv(entry),
};

/** User-level environment inherited by every workspace; values never return to this renderer. */
const UserEnvironment = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <WorkspaceEnv
      client={userEnvClient}
      description={t('userEnv.description')}
      title={t('userEnv.title')}
      workspaceId="user"
    />
  );
});

UserEnvironment.displayName = 'UserEnvironment';

export default UserEnvironment;
