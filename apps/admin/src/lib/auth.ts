import { createAuthClient } from 'better-auth/react';

import adminEnv from '@admin/env';

export const { useSession } = createAuthClient({
  baseURL: adminEnv.apiBaseUrl || undefined,
});
