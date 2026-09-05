/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicItemDropdownMenu } from './useDropdownMenu';

const permissionMock = vi.hoisted(() => ({
  create_content: true,
  edit_own_content: true,
}));
const confirmModalMock = vi.hoisted(() => vi.fn());
const removeTopicMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: confirmModalMock,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        success: vi.fn(),
      },
      modal: {
        confirm: vi.fn(),
      },
    }),
  },
}));

vi.mock('@/components/RenameModal', () => ({
  openRenameModal: vi.fn(),
}));

vi.mock('@/const/version', () => ({
  isDesktop: false,
}));

vi.mock('@/features/Electron/titlebar/RecentlyViewed/plugins', () => ({
  pluginRegistry: {
    parseUrl: vi.fn(),
  },
}));

vi.mock('@/features/ShareModal', () => ({
  openShareModal: vi.fn(),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/useAppOrigin', () => ({
  useAppOrigin: () => 'https://example.com',
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: permissionMock[action],
    reason: '',
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeAgentId: 'agent-1' }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      autoRenameTopicTitle: vi.fn(),
      duplicateTopic: vi.fn(),
      favoriteTopic: vi.fn(),
      markTopicCompleted: vi.fn(),
      removeTopic: removeTopicMock,
      unmarkTopicCompleted: vi.fn(),
      updateTopicTitle: vi.fn(),
    }),
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ addTab: vi.fn() }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openTopicInNewWindow: vi.fn() }),
}));

const getMenuItem = (
  items: NonNullable<ReturnType<ReturnType<typeof useTopicItemDropdownMenu>['dropdownMenu']>>,
  key: string,
) => items.find((item) => item && 'key' in item && item.key === key);

describe('useTopicItemDropdownMenu', () => {
  beforeEach(() => {
    confirmModalMock.mockReset();
    removeTopicMock.mockReset().mockResolvedValue(undefined);
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;
  });

  it('disables topic management actions for workspace viewers', () => {
    permissionMock.create_content = false;
    permissionMock.edit_own_content = false;

    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({ id: 'topic-1', title: 'Topic 1' }),
    );
    const items = result.current.dropdownMenu();

    for (const key of [
      'markCompleted',
      'favorite',
      'autoRename',
      'rename',
      'duplicate',
      'moveToAgent',
      'share',
      'delete',
    ]) {
      expect(getMenuItem(items, key)).toMatchObject({ disabled: true });
    }

    expect(getMenuItem(items, 'copySessionId')).not.toMatchObject({ disabled: true });
    expect(getMenuItem(items, 'copyLink')).not.toMatchObject({ disabled: true });
  });

  it('routes scratch cleanup through the confirmed topic removal service', async () => {
    const { result } = renderHook(() =>
      useTopicItemDropdownMenu({
        id: 'topic-scratch',
        scratchWorkspace: { rootPath: '/tmp/masterino/topic-scratch' },
        title: 'Temporary topic',
      }),
    );
    const cleanup = getMenuItem(result.current.dropdownMenu(), 'delete');

    expect(cleanup).toMatchObject({ label: 'workspaceRuntime.sidebar.cleanupScratch' });
    cleanup && 'onClick' in cleanup && cleanup.onClick?.({} as never);
    expect(confirmModalMock).toHaveBeenCalledOnce();

    await confirmModalMock.mock.calls[0][0].onOk();
    expect(removeTopicMock).toHaveBeenCalledWith('topic-scratch');
  });
});
