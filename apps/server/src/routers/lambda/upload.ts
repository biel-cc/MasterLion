import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { appEnv } from '@/envs/app';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { FileS3 } from '@/server/modules/S3';
import { createS3UploadProxyUrl } from '@/server/services/file/uploadProxyToken';

const getBrowserUploadUrl = (proxyUrl: string): string => {
  try {
    const configuredUrl = new URL(appEnv.APP_URL);
    const hostname = configuredUrl.hostname.toLowerCase();
    const isLoopback =
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('127.') ||
      hostname === '[::1]' ||
      hostname === '::1';

    if (configuredUrl.protocol !== 'https:' || isLoopback) return proxyUrl;

    return new URL(proxyUrl, configuredUrl.origin).href;
  } catch {
    return proxyUrl;
  }
};

export const uploadRouter = router({
  createS3PreSignedUpload: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(z.object({ pathname: z.string() }))
    .mutation(async ({ input }) => {
      const proxyUrl = createS3UploadProxyUrl(input.pathname);
      const upload: {
        headers?: Record<string, string>;
        requiresConfirmation?: true;
        url: string;
      } = {
        requiresConfirmation: true,
        url: getBrowserUploadUrl(proxyUrl),
      };

      return upload;
    }),
  createS3PreSignedUrl: authedProcedure
    .use(withScopedPermission('file:upload'))
    .input(z.object({ pathname: z.string() }))
    .mutation(async ({ input }) => {
      const s3 = new FileS3();

      return await s3.createPreSignedUrl(input.pathname);
    }),
});

export type FileRouter = typeof uploadRouter;
