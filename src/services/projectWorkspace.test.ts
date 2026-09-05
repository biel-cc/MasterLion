import { describe, expect, it, vi } from 'vitest';

import {
  createProjectWorkspaceService,
  isProjectWorkspaceSeamUnavailableError,
  type ProjectWorkspaceClient,
} from './projectWorkspace';

const createClient = (): ProjectWorkspaceClient =>
  ({
    list: vi.fn(),
  }) as unknown as ProjectWorkspaceClient;

describe('ProjectWorkspaceService', () => {
  it('reports an old server missing the workspace router as an unavailable seam', async () => {
    const client = createClient();
    vi.mocked(client.list).mockRejectedValue({
      data: { code: 'NOT_FOUND' },
      message: 'No "query"-procedure on path "projectWorkspace.list"',
    });
    const service = createProjectWorkspaceService(client);

    await expect(service.list()).rejects.toSatisfy(isProjectWorkspaceSeamUnavailableError);
  });

  it('does not disguise ordinary workspace request failures as a missing seam', async () => {
    const client = createClient();
    const failure = { data: { code: 'NOT_FOUND' }, message: 'Workspace not found' };
    vi.mocked(client.list).mockRejectedValue(failure);
    const service = createProjectWorkspaceService(client);

    await expect(service.list()).rejects.toBe(failure);
  });
});
