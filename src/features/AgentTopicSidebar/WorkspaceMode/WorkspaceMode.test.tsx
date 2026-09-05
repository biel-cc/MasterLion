/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { message } from '@/components/AntdStaticMethods';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace';

import WorkspaceMode from './index';
import RecentSection from './RecentSection';
import WorkspaceGroupItem from './WorkspaceGroupItem';

const mocks = vi.hoisted(() => ({
  activeTopicId: 't-1' as string | undefined,
  accordionProps: [] as Array<Record<string, any>>,
  topicGroupKeys: undefined as string[] | undefined,
  topicSortBy: 'updatedAt' as string,
  navigation: {
    placementById: {},
    recent: [] as any[],
    workspaceGroups: [] as any[],
  },
  loadError: undefined as unknown,
  loading: false,
  reload: vi.fn(),
  selectFolder: vi.fn(),
  startNewTopic: vi.fn(),
  switchTopic: vi.fn(),
  topicItems: [] as Array<Record<string, unknown>>,
  updateAgentConfigById: vi.fn(),
  updateAgentRuntimeEnvConfigById: vi.fn(),
  updateSystemStatus: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;

  return { ...original, isDesktop: true };
});
vi.mock('@lobehub/ui', () => ({
  Accordion: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => {
    mocks.accordionProps.push(props);
    return <div data-testid="accordion">{children}</div>;
  },
  AccordionItem: ({
    action,
    children,
    title,
  }: {
    action?: ReactNode;
    children?: ReactNode;
    title?: ReactNode;
  }) => (
    <div data-testid="accordion-item">
      {title}
      {action}
      {children}
    </div>
  ),
  ActionIcon: ({ onClick, title }: { onClick: (e: any) => void; title: string }) => (
    <button aria-label={title} type="button" onClick={onClick}>
      {title}
    </button>
  ),
  Center: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div
      data-testid={props['data-testid'] as string | undefined}
      role={props.role as string | undefined}
    >
      {children}
    </div>
  ),
  Icon: () => null,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_t, p) => String(p) }),
  cssVar: new Proxy({}, { get: (_t, p) => String(p) }),
  cx: (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' '),
  keyframes: () => 'kf',
}));
vi.mock('lucide-react', () => ({
  FolderClosedIcon: () => null,
  FolderOpenIcon: () => null,
  HandIcon: () => null,
  MoreHorizontal: () => null,
  PlusIcon: () => null,
  RefreshCwIcon: () => null,
  TriangleAlertIcon: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('url-join', () => ({ default: (...parts: string[]) => parts.join('/') }));
vi.mock('@/components/RingLoading', () => ({ default: () => null }));
vi.mock('@/components/AntdStaticMethods', () => ({ message: { error: vi.fn() } }));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ onClick, title }: { onClick?: () => void; title?: ReactNode }) =>
    onClick ? <button onClick={onClick}>{title}</button> : <span>{title}</span>,
}));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({ default: () => null }));
vi.mock('@/services/electron/system', () => ({
  electronSystemService: { selectFolder: mocks.selectFolder },
}));
vi.mock('./useWorkspaceTopicNavigation', () => ({
  useWorkspaceTopicNavigation: () => ({
    groupIds: mocks.navigation.workspaceGroups.map((g: any) => g.workspaceId),
    navigation: mocks.navigation,
    loadError: mocks.loadError,
    loading: mocks.loading,
    reload: mocks.reload,
    topicSortBy: mocks.topicSortBy,
  }),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: Object.assign(
    (selector: (s: any) => unknown) =>
      selector({
        updateAgentConfigById: mocks.updateAgentConfigById,
        updateAgentRuntimeEnvConfigById: mocks.updateAgentRuntimeEnvConfigById,
      }),
    {
      getState: () => ({
        updateAgentConfigById: mocks.updateAgentConfigById,
        updateAgentRuntimeEnvConfigById: mocks.updateAgentRuntimeEnvConfigById,
      }),
    },
  ),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (s: any) => unknown) =>
      selector({
        activeAgentId: 'agent-1',
        activeGroupId: undefined,
        activeThreadId: undefined,
        activeTopicId: mocks.activeTopicId,
        topicLoadingIds: [],
      }),
    {
      getState: () => ({
        startNewTopic: mocks.startNewTopic,
        switchTopic: mocks.switchTopic,
      }),
    },
  ),
}));
vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: { unreadCompletedCountForTopics: () => () => 0 },
  topicSelectors: {
    hasMoreTopicsForSidebar: () => false,
    isExpandingPageSize: () => false,
  },
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: any) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: 'device-1' } }),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: any) => unknown) =>
    selector({ updateSystemStatus: mocks.updateSystemStatus }),
}));
vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { topicGroupKeys: () => mocks.topicGroupKeys },
}));

const topic = (id: string) => ({ createdAt: 1, id, title: id, updatedAt: 1 });
const workspace = {
  deviceId: 'device-1',
  displayName: 'App',
  id: 'ws-app',
  kind: 'device' as const,
  rootPath: '/projects/app',
};
const TopicItemStub = (props: Record<string, unknown>) => {
  mocks.topicItems.push(props);
  return (
    <div data-testid="topic-item">
      {props.title as string}
      {props.scratchWorkspace ? <span data-testid="topic-scratch-tag" /> : null}
    </div>
  );
};

describe('WorkspaceMode sidebar', () => {
  beforeEach(() => {
    mocks.activeTopicId = 't-1';
    mocks.topicItems.length = 0;
    mocks.accordionProps.length = 0;
    mocks.topicGroupKeys = undefined;
    mocks.topicSortBy = 'updatedAt';
    mocks.updateSystemStatus.mockClear();
    mocks.switchTopic.mockClear();
    mocks.loadError = undefined;
    mocks.loading = false;
    mocks.reload.mockClear();
    mocks.selectFolder.mockReset();
    mocks.startNewTopic.mockReset();
    mocks.updateAgentConfigById.mockClear();
    mocks.updateAgentRuntimeEnvConfigById.mockClear();
    vi.mocked(message.error).mockClear();
    useProjectWorkspaceStore.setState({ draftByConversationKey: {}, seamAvailable: true });
    mocks.navigation = {
      placementById: {},
      recent: [
        { placement: { kind: 'recent', reason: 'unbound' }, topic: topic('plain') },
        {
          placement: { kind: 'recent', reason: 'scratch' },
          topic: topic('scratch'),
          workspace: { id: 'ws-s', kind: 'scratch', rootPath: '/tmp/scratch/x' },
        },
      ],
      workspaceGroups: [{ topics: [topic('bound')], workspace, workspaceId: 'ws-app' }],
    };
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders the workspace section above the fixed recent section', () => {
    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);

    const sections = [...document.querySelectorAll('[data-testid]')].map((node) =>
      node.getAttribute('data-testid'),
    );
    expect(sections.indexOf('topic-workspace-section')).toBeLessThan(
      sections.indexOf('topic-recent-section'),
    );
    expect(screen.getByText('workspaceRuntime.sidebar.workspaces')).toBeInTheDocument();
    expect(screen.getByText('workspaceRuntime.sidebar.recent')).toBeInTheDocument();
  });

  it('keeps workspace and recent rows disjoint and tags only scratch rows', () => {
    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);

    const rendered = mocks.topicItems.map((item) => item.id);
    expect(new Set(rendered).size).toBe(rendered.length);
    expect(rendered.sort()).toEqual(['bound', 'plain', 'scratch']);
    expect(screen.getAllByTestId('topic-scratch-tag')).toHaveLength(1);
    expect(mocks.topicItems.find((item) => item.id === 'scratch')?.scratchWorkspace).toEqual({
      rootPath: '/tmp/scratch/x',
    });
  });

  it('keeps the project section available when no project has been added yet', () => {
    mocks.navigation = { placementById: {}, recent: [], workspaceGroups: [] };
    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);

    expect(screen.getByTestId('topic-workspace-section')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'workspaceRuntime.sidebar.addProject' }),
    ).toBeInTheDocument();
    expect(screen.getByText('workspaceRuntime.sidebar.recentEmpty')).toBeInTheDocument();
  });

  it('chooses a folder before opening a new topic in a newly added project', async () => {
    const getOrCreateDeviceWorkspace = vi
      .spyOn(useProjectWorkspaceStore.getState(), 'getOrCreateDeviceWorkspace')
      .mockResolvedValue({ ok: true, value: workspace });
    mocks.selectFolder.mockResolvedValue({ path: '/projects/app', repoType: 'git' });

    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);
    fireEvent.click(screen.getByRole('button', { name: 'workspaceRuntime.sidebar.addProject' }));

    await vi.waitFor(() => expect(mocks.startNewTopic).toHaveBeenCalledOnce());
    expect(getOrCreateDeviceWorkspace).toHaveBeenCalledWith({
      deviceId: 'device-1',
      repoType: 'git',
      rootPath: '/projects/app',
    });
    expect(mocks.startNewTopic).toHaveBeenCalledWith({
      target: 'local',
      targetDeviceId: 'device-1',
      workspaceId: 'ws-app',
    });
  });

  it.each([true, false])(
    'opens the selected folder as a legacy draft when the project API is unavailable (known: %s)',
    async (knownUnavailable) => {
      useProjectWorkspaceStore.setState({ seamAvailable: !knownUnavailable });
      const getOrCreate = vi
        .spyOn(useProjectWorkspaceStore.getState(), 'getOrCreateDeviceWorkspace')
        .mockResolvedValue({ ok: false, code: 'SEAM_UNAVAILABLE' });
      mocks.selectFolder.mockResolvedValue({ path: '/projects/app', repoType: 'git' });

      render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);
      fireEvent.click(screen.getByRole('button', { name: 'workspaceRuntime.sidebar.addProject' }));

      await vi.waitFor(() =>
        expect(mocks.startNewTopic).toHaveBeenCalledWith({
          legacyWorkingDirectory: '/projects/app',
          target: 'local',
          targetDeviceId: 'device-1',
        }),
      );
      expect(getOrCreate).toHaveBeenCalledTimes(knownUnavailable ? 0 : 1);
      expect(message.error).not.toHaveBeenCalled();
      expect(mocks.updateAgentConfigById).not.toHaveBeenCalled();
      expect(mocks.updateAgentRuntimeEnvConfigById).not.toHaveBeenCalled();
    },
  );

  it('does not hide an ordinary project creation failure behind the legacy fallback', async () => {
    vi.spyOn(useProjectWorkspaceStore.getState(), 'getOrCreateDeviceWorkspace').mockResolvedValue({
      ok: false,
      code: 'UNKNOWN',
    });
    mocks.selectFolder.mockResolvedValue({ path: '/projects/app' });

    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);
    fireEvent.click(screen.getByRole('button', { name: 'workspaceRuntime.sidebar.addProject' }));

    await vi.waitFor(() =>
      expect(message.error).toHaveBeenCalledWith('workspaceRuntime.sidebar.addProjectFailed'),
    );
    expect(mocks.startNewTopic).not.toHaveBeenCalled();
  });

  it('does nothing when adding a project is cancelled', async () => {
    const getOrCreateDeviceWorkspace = vi.spyOn(
      useProjectWorkspaceStore.getState(),
      'getOrCreateDeviceWorkspace',
    );
    mocks.selectFolder.mockResolvedValue(undefined);

    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);
    fireEvent.click(screen.getByRole('button', { name: 'workspaceRuntime.sidebar.addProject' }));

    await vi.waitFor(() => expect(mocks.selectFolder).toHaveBeenCalledOnce());
    expect(getOrCreateDeviceWorkspace).not.toHaveBeenCalled();
    expect(mocks.startNewTopic).not.toHaveBeenCalled();
  });

  it('opens a fresh local topic from the Recent section', () => {
    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'workspaceRuntime.sidebar.addRecentTopic' }),
    );

    expect(mocks.startNewTopic).toHaveBeenCalledWith({ target: 'local' });
  });

  it('does not flash an empty Recent section while workspace evidence is loading', () => {
    mocks.navigation = { placementById: {}, recent: [], workspaceGroups: [] };
    mocks.loading = true;

    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);

    expect(screen.queryByText('workspaceRuntime.sidebar.recentEmpty')).not.toBeInTheDocument();
  });

  describe('expanded group state', () => {
    // WorkspaceMode is memo'd and `TopicItemComponent` is a stable reference, so
    // an unused varying prop is what makes `rerender` actually re-render it.
    const modeElement = (nonce = 0) => (
      <WorkspaceMode {...({ nonce } as any)} TopicItemComponent={TopicItemStub as any} />
    );

    it('defaults to every group expanded when nothing is stored', () => {
      render(modeElement());

      expect(mocks.accordionProps.at(-1)?.expandedKeys).toEqual(['ws-app']);
      expect(mocks.updateSystemStatus).not.toHaveBeenCalled();
    });

    it('keeps a stored collapse selection across rerenders and remounts', () => {
      // The user collapsed every workspace group.
      mocks.topicGroupKeys = [];

      const view = render(modeElement(0));
      view.rerender(modeElement(1));
      view.unmount();
      render(modeElement(0));

      expect(mocks.updateSystemStatus).not.toHaveBeenCalled();
      expect(mocks.accordionProps.at(-1)?.expandedKeys).toEqual([]);
    });

    it('keeps a partial expand selection across a remount', () => {
      mocks.navigation.workspaceGroups = [
        { topics: [topic('bound')], workspace, workspaceId: 'ws-app' },
        { topics: [topic('other')], workspace, workspaceId: 'ws-api' },
      ];
      mocks.topicGroupKeys = ['ws-api'];

      const view = render(modeElement());
      view.unmount();
      render(modeElement());

      expect(mocks.updateSystemStatus).not.toHaveBeenCalled();
      expect(mocks.accordionProps.at(-1)?.expandedKeys).toEqual(['ws-api']);
    });

    it.each(['ws-new', 'legacy-directory:%2Fnew-project'])(
      'expands a new active project after its first topic arrives (%s)',
      (workspaceId) => {
        mocks.topicGroupKeys = ['ws-app'];
        mocks.activeTopicId = undefined;
        const view = render(modeElement());
        mocks.activeTopicId = 'new-topic';
        view.rerender(modeElement(1));
        expect(mocks.updateSystemStatus).not.toHaveBeenCalled();
        mocks.navigation.workspaceGroups = [
          ...mocks.navigation.workspaceGroups,
          {
            workspaceId,
            workspace: { ...workspace, id: workspaceId },
            topics: [topic('new-topic')],
          },
        ];
        view.rerender(modeElement(2));
        expect(mocks.updateSystemStatus).toHaveBeenCalledWith({
          expandTopicGroupKeys: ['ws-app', workspaceId],
        });
        // A later manual collapse must not be undone by title/streaming updates.
        mocks.topicGroupKeys = ['ws-app'];
        mocks.updateSystemStatus.mockClear();
        view.rerender(modeElement(3));
        expect(mocks.updateSystemStatus).not.toHaveBeenCalled();
      },
    );

    it('waits for the new topic to become active if its project row arrives first', () => {
      mocks.topicGroupKeys = [];
      mocks.activeTopicId = undefined;
      const view = render(modeElement());
      mocks.navigation.workspaceGroups = [
        ...mocks.navigation.workspaceGroups,
        {
          workspaceId: 'ws-new',
          workspace,
          topics: [topic('new-topic')],
        },
      ];
      view.rerender(modeElement(1));
      expect(mocks.updateSystemStatus).not.toHaveBeenCalled();
      mocks.activeTopicId = 'new-topic';
      view.rerender(modeElement(2));
      expect(mocks.updateSystemStatus).toHaveBeenCalledWith({ expandTopicGroupKeys: ['ws-new'] });
    });

    it('resets the selection only when the sort key actually changes', () => {
      mocks.topicGroupKeys = [];

      const view = render(modeElement(0));
      view.rerender(modeElement(1));
      expect(mocks.updateSystemStatus).not.toHaveBeenCalled();

      mocks.topicSortBy = 'createdAt';
      view.rerender(modeElement(2));

      expect(mocks.updateSystemStatus).toHaveBeenCalledWith({ expandTopicGroupKeys: undefined });
      expect(mocks.updateSystemStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces workspace load errors with a retry action', () => {
    mocks.loadError = new Error('offline');

    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);
    fireEvent.click(screen.getByRole('button', { name: 'workspaceRuntime.sidebar.retry' }));

    expect(screen.getByTestId('topic-workspace-load-error')).toHaveAttribute('role', 'alert');
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it('workspace group "+" opens a new topic page with the project fixed', () => {
    render(
      <WorkspaceGroupItem
        expanded
        TopicItemComponent={TopicItemStub as any}
        activeTopicId="t-1"
        group={{ topics: [topic('bound')], workspace, workspaceId: 'ws-app' }}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'workspaceRuntime.sidebar.addTopicInWorkspace' }),
    );

    expect(mocks.startNewTopic).toHaveBeenCalledWith({
      target: 'local',
      targetDeviceId: 'device-1',
      workspaceId: 'ws-app',
    });
    expect(mocks.switchTopic).not.toHaveBeenCalled();
    expect(mocks.updateAgentConfigById).not.toHaveBeenCalled();
    expect(mocks.updateAgentRuntimeEnvConfigById).not.toHaveBeenCalled();
  });

  it('legacy directory group "+" opens a new topic page without inventing a workspace id', () => {
    render(
      <WorkspaceGroupItem
        expanded
        TopicItemComponent={TopicItemStub as any}
        activeTopicId="t-1"
        group={{
          legacyWorkingDirectory: '/legacy/app',
          topics: [topic('legacy')],
          workspace: { deviceId: 'device-1', kind: 'device', rootPath: '/legacy/app' },
          workspaceId: 'legacy-directory:%2Flegacy%2Fapp',
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'workspaceRuntime.sidebar.addTopicInWorkspace' }),
    );

    expect(mocks.startNewTopic).toHaveBeenCalledWith({
      legacyWorkingDirectory: '/legacy/app',
      target: 'local',
      targetDeviceId: 'device-1',
    });
    expect(mocks.switchTopic).not.toHaveBeenCalled();
  });

  it('RecentSection passes scratch root only for scratch placements', () => {
    render(
      <RecentSection
        TopicItemComponent={TopicItemStub as any}
        activeTopicId="t-1"
        entries={mocks.navigation.recent}
      />,
    );

    expect(mocks.topicItems.find((item) => item.id === 'plain')?.scratchWorkspace).toBeUndefined();
    expect(mocks.topicItems.find((item) => item.id === 'scratch')?.scratchWorkspace).toEqual({
      rootPath: '/tmp/scratch/x',
    });
  });
});
