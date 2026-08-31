import { serverDB } from '@lobechat/database';
import { after } from 'next/server';

import { ensureAihubReadinessBestEffort } from '@/server/services/newApi/readiness/bestEffort';

type Dependencies = {
  ensure?: typeof ensureAihubReadinessBestEffort;
  schedule?: typeof after;
};

export const scheduleAihubReadinessAfterOidcAuthorization = (
  userId: string,
  { ensure = ensureAihubReadinessBestEffort, schedule = after }: Dependencies = {},
) => {
  try {
    schedule(() =>
      ensure({
        db: serverDB,
        trigger: 'oidc_authorized',
        userId,
      }),
    );
  } catch (error) {
    console.warn(
      '[Aihub Readiness] OIDC prewarm could not be scheduled:',
      error instanceof Error ? error.message : String(error),
    );
  }
};
