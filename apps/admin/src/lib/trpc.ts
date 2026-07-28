import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';

import type { LambdaRouter } from '@masterlion/server/routers/lambda';

import adminEnv from '@admin/env';

// The admin UI is deployed separately, so it must not bundle server-only modules.
// Market compatibility is contract-tested in the service package.
export const trpc = createTRPCReact<LambdaRouter>();
export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      fetch: (url, options) => fetch(url, { ...options, credentials: 'include' }),
      transformer: superjson,
      url: `${adminEnv.apiBaseUrl}/trpc/lambda`,
    }),
  ],
});
