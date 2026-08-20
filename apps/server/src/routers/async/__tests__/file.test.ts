// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { ChunkService } from '@/server/services/chunk';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { AsyncTaskStatus } from '@/types/asyncTask';

import { fileRouter } from '../file';

vi.mock('@/database/models/asyncTask', () => ({ AsyncTaskModel: vi.fn() }));
vi.mock('@/database/models/chunk', () => ({ ChunkModel: vi.fn() }));
vi.mock('@/database/models/embedding', () => ({ EmbeddingModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('@/server/services/chunk', () => ({ ChunkService: vi.fn() }));
vi.mock('@/server/services/document', () => ({ DocumentService: vi.fn() }));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/business/server/trpc-middlewares/async', () => ({
  checkEmbeddingUsage: async (opts: any) => opts.next({ ctx: opts.ctx }),
}));

vi.mock('@/libs/trpc/async', async () => {
  const init = await vi.importActual<{ asyncTrpc: any }>('@/libs/trpc/async/init');
  const { asyncTrpc } = init;
  return {
    asyncAuthedProcedure: asyncTrpc.procedure,
    asyncRouter: asyncTrpc.router,
    createAsyncCallerFactory: asyncTrpc.createCallerFactory,
    publicProcedure: asyncTrpc.procedure,
  };
});

describe('fileRouter.parseFileToChunks — NoSuchKey + internal:// branches', () => {
  const userId = 'user_test';
  let mockCtx: any;
  let asyncTaskModelMock: any;
  let fileModelMock: any;
  let fileServiceMock: any;
  let chunkServiceMock: any;
  let documentServiceMock: any;
  let chunkModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    asyncTaskModelMock = { findById: vi.fn(), update: vi.fn() };
    fileModelMock = { findById: vi.fn(), delete: vi.fn() };
    fileServiceMock = { getFileByteArray: vi.fn() };
    chunkServiceMock = {
      asyncEmbeddingFileChunks: vi.fn(),
      chunkContent: vi.fn(),
    };
    documentServiceMock = { parseFile: vi.fn() };
    chunkModelMock = { bulkCreate: vi.fn(), bulkCreateUnstructuredChunks: vi.fn() };

    vi.mocked(AsyncTaskModel).mockImplementation(() => asyncTaskModelMock);
    vi.mocked(FileModel).mockImplementation(() => fileModelMock);
    vi.mocked(FileService).mockImplementation(() => fileServiceMock);
    vi.mocked(ChunkService).mockImplementation(() => chunkServiceMock);
    vi.mocked(DocumentService).mockImplementation(() => documentServiceMock);
    vi.mocked(ChunkModel).mockImplementation(() => chunkModelMock);
    vi.mocked(EmbeddingModel).mockImplementation(() => ({}) as any);
    Reflect.set(FileModel, 'getFileById', undefined);

    mockCtx = { serverDB: {}, userId };
  });

  it.each([
    ['GetObject Code', { Code: 'NoSuchKey' }],
    ['AWS error name', { name: 'NoSuchKey' }],
    ['HTTP metadata', { $metadata: { httpStatusCode: 404 } }],
  ])(
    'preserves the file row and reports STORAGE_OBJECT_MISSING via %s',
    async (_label, storageError) => {
      fileModelMock.findById.mockResolvedValue({
        id: 'file_xyz',
        name: 'doc.pdf',
        url: 'https://example.com/doc.pdf',
      });
      fileServiceMock.getFileByteArray.mockRejectedValue(storageError);

      const caller = fileRouter.createCaller(mockCtx);

      await expect(
        caller.parseFileToChunks({ fileId: 'file_xyz', taskId: 'task_1' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'STORAGE_OBJECT_MISSING' });

      expect(fileModelMock.delete).not.toHaveBeenCalled();
      expect(asyncTaskModelMock.update).toHaveBeenCalledWith(
        'task_1',
        expect.objectContaining({
          status: AsyncTaskStatus.Error,
          error: expect.objectContaining({
            body: { detail: 'STORAGE_OBJECT_MISSING' },
            name: expect.any(String),
          }),
        }),
      );
    },
  );

  it('skips storage fetch and returns gracefully when url is internal://', async () => {
    fileModelMock.findById.mockResolvedValue({
      id: 'file_inline',
      name: 'note',
      url: 'internal://document/placeholder',
    });

    const caller = fileRouter.createCaller(mockCtx);
    const result = await caller.parseFileToChunks({
      fileId: 'file_inline',
      taskId: 'task_2',
    });

    expect(fileServiceMock.getFileByteArray).not.toHaveBeenCalled();
    expect(fileModelMock.delete).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith(
      'task_2',
      expect.objectContaining({ status: AsyncTaskStatus.Error }),
    );
    expect(result).toMatchObject({ success: false });
  });

  it('resolves workspaceId from the file row when async payload omits it', async () => {
    Reflect.set(
      FileModel,
      'getFileById',
      vi.fn().mockResolvedValue({
        id: 'file_workspace',
        userId,
        workspaceId: 'workspace-1',
      }),
    );
    fileModelMock.findById.mockResolvedValue({
      id: 'file_workspace',
      name: 'workspace note',
      url: 'internal://document/placeholder',
    });

    const caller = fileRouter.createCaller(mockCtx);

    await caller.parseFileToChunks({
      fileId: 'file_workspace',
      taskId: 'task_workspace',
    });

    expect(AsyncTaskModel).toHaveBeenCalledWith(mockCtx.serverDB, userId, 'workspace-1');
    expect(ChunkModel).toHaveBeenCalledWith(mockCtx.serverDB, userId, 'workspace-1');
    expect(ChunkService).toHaveBeenCalledWith(mockCtx.serverDB, userId, 'workspace-1');
    expect(DocumentService).toHaveBeenCalledWith(mockCtx.serverDB, userId, 'workspace-1');
    expect(FileModel).toHaveBeenCalledWith(mockCtx.serverDB, userId, 'workspace-1');
  });

  it('marks the task Error and reports STORAGE_OBJECT_UNAVAILABLE for access errors', async () => {
    fileModelMock.findById.mockResolvedValue({
      id: 'file_other',
      name: 'doc.pdf',
      url: 'https://example.com/doc.pdf',
    });
    fileServiceMock.getFileByteArray.mockRejectedValue({
      Code: 'AccessDenied',
      message: 'forbidden',
    });

    const caller = fileRouter.createCaller(mockCtx);

    await expect(
      caller.parseFileToChunks({ fileId: 'file_other', taskId: 'task_3' }),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'STORAGE_OBJECT_UNAVAILABLE',
    });

    expect(fileModelMock.delete).not.toHaveBeenCalled();
    expect(asyncTaskModelMock.update).toHaveBeenCalledWith(
      'task_3',
      expect.objectContaining({
        error: expect.objectContaining({
          body: { detail: 'STORAGE_OBJECT_UNAVAILABLE' },
        }),
        status: AsyncTaskStatus.Error,
      }),
    );
  });
});
