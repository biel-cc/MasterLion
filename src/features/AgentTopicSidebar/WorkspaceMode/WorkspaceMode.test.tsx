/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDraftConversationKey, useProjectWorkspaceStore } from '@/store/projectWorkspace';

import WorkspaceMode from './index';
import RecentSection from './RecentSection';
import WorkspaceGroupItem from './WorkspaceGroupItem';

const mocks = vi.hoisted(() => ({
  navigation: {
    placementById: {},
    recent: [] as any[],
    workspaceGroups: [] as any[],
  },
  loadError: undefined as unknown,
  loading: false,
  reload: vi.fn(),
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
  Accordion: ({ children }: { children?: ReactNode }) => (
    <div data-testid="accordion">{children}</div>
  ),
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
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ onClick, title }: { onClick?: () => void; title?: ReactNode }) =>
    onClick ? <button onClick={onClick}>{title}</button> : <span>{title}</span>,
}));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({ default: () => null }));
vi.mock('./useWorkspaceTopicNavigation', () => ({
  useWorkspaceTopicNavigation: () => ({
    groupIds: mocks.navigation.workspaceGroups.map((g: any) => g.workspaceId),
    navigation: mocks.navigation,
    loadError: mocks.loadError,
    loading: mocks.loading,
    reload: mocks.reload,
    topicSortBy: 'updatedAt',
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
        activeTopicId: 't-1',
        topicLoadingIds: [],
      }),
    { getState: () => ({ switchTopic: mocks.switchTopic }) },
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
  systemStatusSelectors: { topicGroupKeys: () => undefined },
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
    mocks.topicItems.length = 0;
    mocks.switchTopic.mockClear();
    mocks.loadError = undefined;
    mocks.loading = false;
    mocks.reload.mockClear();
    mocks.updateAgentConfigById.mockClear();
    mocks.updateAgentRuntimeEnvConfigById.mockClear();
    useProjectWorkspaceStore.setState({ draftByConversationKey: {} });
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

  it('shows the empty recent copy without a workspace section when nothing is grouped', () => {
    mocks.navigation = { placementById: {}, recent: [], workspaceGroups: [] };
    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);

    expect(screen.queryByTestId('topic-workspace-section')).not.toBeInTheDocument();
    expect(screen.getByText('workspaceRuntime.sidebar.recentEmpty')).toBeInTheDocument();
  });

  it('does not flash an empty Recent section while workspace evidence is loading', () => {
    mocks.navigation = { placementById: {}, recent: [], workspaceGroups: [] };
    mocks.loading = true;

    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);

    expect(screen.queryByText('workspaceRuntime.sidebar.recentEmpty')).not.toBeInTheDocument();
  });

  it('surfaces workspace load errors with a retry action', () => {
    mocks.loadError = new Error('offline');

    render(<WorkspaceMode TopicItemComponent={TopicItemStub as any} />);
    fireEvent.click(screen.getByRole('button', { name: 'workspaceRuntime.sidebar.retry' }));

    expect(screen.getByTestId('topic-workspace-load-error')).toHaveAttribute('role', 'alert');
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it('workspace group "+" only writes a draft intent and opens a draft', () => {
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

    const key = buildDraftConversationKey({ agentId: 'agent-1' });
    expect(useProjectWorkspaceStore.getState().draftByConversationKey[key]).toMatchObject({
      target: 'local',
      targetDeviceId: 'device-1',
      workspaceId: 'ws-app',
    });
    expect(mocks.switchTopic).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
    expect(mocks.updateAgentConfigById).not.toHaveBeenCalled();
    expect(mocks.updateAgentRuntimeEnvConfigById).not.toHaveBeenCalled();
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
