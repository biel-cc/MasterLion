import type { LobeChatDatabase } from '@/database/type';

import type { AihubReadinessTrigger } from './index';
import { createAihubReadiness } from './production';

export const ensureAihubReadinessBestEffort = async (input: {
  db: LobeChatDatabase;
  trigger: AihubReadinessTrigger;
  userId: string;
}) => {
  try {
    return await createAihubReadiness({ db: input.db }).ensure(input.userId, {
      trigger: input.trigger,
    });
  } catch (error) {
    console.warn(
      `[Aihub Readiness] ${input.trigger} prewarm failed for user ${input.userId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
};
