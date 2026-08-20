import { TRPCError } from '@trpc/server';

import { FileStorageErrorCode } from '@/const/fileUpload';

const getErrorField = (error: unknown, field: string): unknown =>
  error && typeof error === 'object' ? (error as Record<string, unknown>)[field] : undefined;

export const isStorageObjectMissingError = (error: unknown): boolean => {
  const code = getErrorField(error, 'Code') ?? getErrorField(error, 'code');
  const message = getErrorField(error, 'message');
  const name = getErrorField(error, 'name');
  const metadata = getErrorField(error, '$metadata');
  const statusCode = getErrorField(metadata, 'httpStatusCode');

  return (
    code === 'NoSuchKey' ||
    code === 'NotFound' ||
    name === 'NoSuchKey' ||
    name === 'NotFound' ||
    message === 'NoSuchKey' ||
    statusCode === 404
  );
};

export const createStorageObjectAccessError = (cause: unknown): TRPCError => {
  const isMissing = isStorageObjectMissingError(cause);

  return new TRPCError({
    cause,
    code: isMissing ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE',
    message: isMissing
      ? FileStorageErrorCode.ObjectMissing
      : FileStorageErrorCode.ObjectUnavailable,
  });
};
