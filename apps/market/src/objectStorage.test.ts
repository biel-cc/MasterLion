import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MarketConfig } from './config.js';
import { MarketObjectStorage } from './objectStorage.js';

const config = {
  MARKET_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
  MARKET_OBJECT_STORAGE_BUCKET: 'test-bucket',
  MARKET_OBJECT_STORAGE_ENDPOINT: 'https://s3.oss-cn-shenzhen.aliyuncs.com',
  MARKET_OBJECT_STORAGE_FORCE_PATH_STYLE: '0',
  MARKET_OBJECT_STORAGE_REGION: 'cn-shenzhen',
  MARKET_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
} as MarketConfig;

describe('MarketObjectStorage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('checks readiness with a least-privilege object listing request', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);

    await new MarketObjectStorage(config).ping();

    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect(command.input).toEqual({ Bucket: 'test-bucket', MaxKeys: 1 });
  });
});
