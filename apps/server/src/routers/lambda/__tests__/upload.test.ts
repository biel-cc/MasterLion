// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadRouter } from '../upload';

const { mockAppEnv, mockCreatePreSignedUrl, mockCreateS3UploadProxyUrl, mockFileS3 } = vi.hoisted(
  () => {
    const mockAppEnv = { APP_URL: 'https://app.example.com' };
    const mockCreatePreSignedUrl = vi.fn();
    const mockCreateS3UploadProxyUrl = vi.fn();
    const mockFileS3 = vi.fn(() => ({
      createPreSignedUrl: mockCreatePreSignedUrl,
    }));

    return { mockAppEnv, mockCreatePreSignedUrl, mockCreateS3UploadProxyUrl, mockFileS3 };
  },
);

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/envs/app', () => ({
  appEnv: mockAppEnv,
}));

vi.mock('@/server/modules/S3', () => ({
  FileS3: mockFileS3,
}));

vi.mock('@/server/services/file/uploadProxyToken', () => ({
  createS3UploadProxyUrl: mockCreateS3UploadProxyUrl,
}));

describe('uploadRouter', () => {
  const caller = () => uploadRouter.createCaller({ userId: 'user-1' });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppEnv.APP_URL = 'https://app.example.com';
    mockCreateS3UploadProxyUrl.mockImplementation(
      (key: string) =>
        `/api/upload/s3-proxy?key=${encodeURIComponent(key)}&expires=1&signature=sig`,
    );
    mockCreatePreSignedUrl.mockResolvedValue('https://s3.example.com/bucket/files/test.png?sig=1');
  });

  it('returns an absolute HTTPS upload proxy URL for released desktop clients', async () => {
    const result = await caller().createS3PreSignedUpload({ pathname: 'files/test image.png' });

    expect(result).toEqual({
      requiresConfirmation: true,
      url: 'https://app.example.com/api/upload/s3-proxy?key=files%2Ftest%20image.png&expires=1&signature=sig',
    });
    expect(mockCreateS3UploadProxyUrl).toHaveBeenCalledWith('files/test image.png');
    expect(mockFileS3).not.toHaveBeenCalled();
  });

  it.each(['', 'not-a-url', 'http://localhost:3210', 'https://localhost:3210'])(
    'keeps a same-origin URL when APP_URL is not a public HTTPS origin: %s',
    async (appUrl) => {
      mockAppEnv.APP_URL = appUrl;

      const result = await caller().createS3PreSignedUpload({ pathname: 'files/test.png' });

      expect(result).toEqual({
        requiresConfirmation: true,
        url: '/api/upload/s3-proxy?key=files%2Ftest.png&expires=1&signature=sig',
      });
    },
  );

  it('keeps the legacy presigned URL endpoint for CLI uploads', async () => {
    const result = await caller().createS3PreSignedUrl({ pathname: 'files/test.png' });

    expect(result).toBe('https://s3.example.com/bucket/files/test.png?sig=1');
    expect(mockFileS3).toHaveBeenCalledTimes(1);
    expect(mockCreatePreSignedUrl).toHaveBeenCalledWith('files/test.png');
  });
});
