import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UserEnvironment from './UserEnvironment';

const { listUserEnv, revokeUserEnv, saveUserEnv, workspaceEnvRender } = vi.hoisted(() => ({
  listUserEnv: vi.fn().mockResolvedValue([{ key: 'USER_TOKEN', secret: true }]),
  revokeUserEnv: vi.fn(),
  saveUserEnv: vi.fn(),
  workspaceEnvRender: vi.fn(
    ({
      description,
      title,
    }: {
      client: { list: (scope: string) => Promise<Array<{ key: string; secret: boolean }>> };
      description: string;
      title: string;
      workspaceId: string;
    }) => (
      <div>
        {title}: {description}
      </div>
    ),
  ),
}));

vi.mock('@/services/projectWorkspace', () => ({
  projectWorkspaceService: { listUserEnv, revokeUserEnv, saveUserEnv },
}));
vi.mock('@/features/WorkspaceEnv', () => ({ WorkspaceEnv: workspaceEnvRender }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'userEnv.description': 'Inherited by every workspace',
        'userEnv.title': 'Personal environment',
      })[key] ?? key,
  }),
}));

describe('UserEnvironment', () => {
  it('provides a personal environment entry backed by the value-free user client', async () => {
    render(<UserEnvironment />);

    expect(
      screen.getByText('Personal environment: Inherited by every workspace'),
    ).toBeInTheDocument();
    const { client, workspaceId } = workspaceEnvRender.mock.calls[0][0];
    expect(workspaceId).toBe('user');
    await expect(client.list(workspaceId)).resolves.toEqual([{ key: 'USER_TOKEN', secret: true }]);
    expect(listUserEnv).toHaveBeenCalledOnce();
  });
});
