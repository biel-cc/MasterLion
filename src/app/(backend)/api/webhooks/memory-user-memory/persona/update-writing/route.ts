import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { isPersonalMemoryEnabled } from '@/server/services/memory/userMemory/access';
import {
  buildUserPersonaJobInput,
  UserPersonaService,
} from '@/server/services/memory/userMemory/persona/service';
import { MemoryExtractionQueueService } from '@/server/services/memory/userMemory/queue/service';

const userPersonaWebhookSchema = z.object({
  mode: z.enum(['workflow', 'direct']).optional(),
  userId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
});

type UserPersonaWebhookPayload = z.infer<typeof userPersonaWebhookSchema>;

const normalizeUserPersonaPayload = (payload: UserPersonaWebhookPayload) => {
  const parsed = userPersonaWebhookSchema.parse(payload);

  return {
    mode: parsed.mode ?? 'workflow',
    userIds: Array.from(
      new Set([...(parsed.userIds || []), ...(parsed.userId ? [parsed.userId] : [])]),
    ).filter(Boolean),
  } as const;
};

export const POST = async (req: Request) => {
  const { webhook } = parseMemoryExtractionConfig();

  if (webhook.headers && Object.keys(webhook.headers).length > 0) {
    for (const [key, value] of Object.entries(webhook.headers)) {
      const headerValue = req.headers.get(key);
      if (headerValue !== value) {
        return NextResponse.json(
          { error: `Unauthorized: Missing or invalid header '${key}'` },
          { status: 403 },
        );
      }
    }
  }

  try {
    const json = await req.json();
    const params = normalizeUserPersonaPayload(json);

    if (params.userIds.length === 0) {
      return NextResponse.json({ error: 'userId or userIds is required' }, { status: 400 });
    }

    const db = await getServerDB();
    const enabledChecks = await Promise.all(
      params.userIds.map(async (userId) => ({
        enabled: await isPersonalMemoryEnabled({ db, userId }),
        userId,
      })),
    );
    const enabledUserIds = enabledChecks.filter((item) => item.enabled).map((item) => item.userId);

    if (enabledUserIds.length === 0) {
      return NextResponse.json(
        { message: 'No users with Memory enabled; persona update skipped.', results: [] },
        { status: 200 },
      );
    }

    if (params.mode === 'workflow') {
      const results = await Promise.all(
        enabledUserIds.map(async (userId) => {
          const { jobId } = await MemoryExtractionQueueService.triggerPersonaUpdate(userId);

          return { jobId, userId };
        }),
      );

      return NextResponse.json(
        { message: 'User persona update scheduled on the internal queue.', results },
        { status: 202 },
      );
    }

    const service = new UserPersonaService(db);
    const results = [];

    for (const userId of enabledUserIds) {
      const context = await buildUserPersonaJobInput(db, userId);
      const result = await service.composeWriting({ ...context, userId });
      results.push({ userId, ...result });
    }

    return NextResponse.json(
      { message: 'User persona generated via webhook.', results },
      { status: 200 },
    );
  } catch (error) {
    console.error('[user-persona] failed', error);

    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
