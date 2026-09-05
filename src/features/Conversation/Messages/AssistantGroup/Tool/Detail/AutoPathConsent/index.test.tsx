/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AutoPathConsentNotice from './index';

const { fetchResult, grantTopicAccess, mutate, revokeTopicGrant, state } = vi.hoisted(() => ({
  fetchResult: { error: undefined as unknown, isLoading: false },
  grantTopicAccess: vi.fn(),
  mutate: vi.fn(),
  revokeTopicGrant: vi.fn(),
  state: { grants: [] as Array<Record<string, unknown>> },
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    danger: _danger,
    loading,
    type: _type,
    ...props
  }: ComponentProps<'button'> & { danger?: boolean; loading?: boolean; type?: string }) => (
    <button {...props} disabled={loading || props.disabled} type="button">
      {children}
    </button>
  ),
}));
vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_, property) => String(property) }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/store/projectWorkspace', () => ({
  projectWorkspaceSelectors: { getTopicGrants: () => () => state.grants },
  useProjectWorkspaceStore: (selector: (store: Record<string, unknown>) => unknown) =>
    selector({
      grantTopicAccess,
      revokeTopicGrant,
      useFetchTopicGrants: () => ({ ...fetchResult, mutate }),
    }),
}));

const evidence = {
  deviceId: 'device-1',
  operationId: 'op-1',
  roots: ['/home/me/docs', '/home/me/notes'],
  topicId: 'topic-1',
};

const grant = (overrides: Record<string, unknown> = {}) => ({
  createdAt: '2026-09-04T00:00:00.000Z',
  deviceId: 'device-1',
  id: 'grant-1',
  modes: ['read'],
  requestedVia: {},
  rootPath: '/home/me/docs',
  scope: 'topic',
  topicId: 'topic-1',
  userId: 'user-1',
  ...overrides,
});

const renderNotice = () =>
  render(<AutoPathConsentNotice evidence={evidence} messageId="msg-1" toolCallId="call-1" />);

const upgradeButton = () =>
  screen.getByRole('button', { name: 'workspaceAutoPathConsent.upgrade' });
const revokeButton = () => screen.getByRole('button', { name: 'workspaceAutoPathConsent.revoke' });

describe('<AutoPathConsentNotice />', () => {
  beforeEach(() => {
    grantTopicAccess.mockReset().mockImplementation(async ({ rootPath }: { rootPath: string }) => ({
      ok: true,
      value: grant({ id: `grant-${rootPath}`, rootPath }),
    }));
    revokeTopicGrant.mockReset().mockResolvedValue({ ok: true, value: grant() });
    mutate.mockReset();
    fetchResult.error = undefined;
    fetchResult.isLoading = false;
    state.grants = [];
  });
  afterEach(() => cleanup());

  it('states what the user message released and lists the authorization roots', () => {
    renderNotice();

    expect(screen.getByText('workspaceAutoPathConsent.title')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'workspaceAutoPathConsent.pathsLabel' });
    expect(list).toHaveTextContent('/home/me/docs');
    expect(list).toHaveTextContent('/home/me/notes');
    expect(screen.getByText('workspaceAutoPathConsent.note')).toBeInTheDocument();
  });

  it('grants the authorization root even when the tool read a file below it', async () => {
    render(
      <AutoPathConsentNotice
        evidence={{ ...evidence, roots: ['/home/me/docs'] }}
        messageId="msg-1"
        toolCallId="call-1"
      />,
    );

    fireEvent.click(upgradeButton());

    await waitFor(() => expect(grantTopicAccess).toHaveBeenCalledTimes(1));
    // Never `/home/me/docs/a.txt`: a grant for the read file would authorize far
    // less than the user's message already released.
    expect(grantTopicAccess.mock.calls[0][0].rootPath).toBe('/home/me/docs');
  });

  it('upgrades every uncovered root to a topic grant and reports the result', async () => {
    renderNotice();

    fireEvent.click(upgradeButton());

    await waitFor(() => expect(grantTopicAccess).toHaveBeenCalledTimes(2));
    expect(grantTopicAccess).toHaveBeenNthCalledWith(1, {
      deviceId: 'device-1',
      modes: ['read'],
      requestedVia: {
        messageId: 'msg-1',
        reason: 'direct-user-message-consent',
        toolCallId: 'call-1',
      },
      rootPath: '/home/me/docs',
      topicId: 'topic-1',
    });
    expect(grantTopicAccess.mock.calls[1][0].rootPath).toBe('/home/me/notes');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'workspaceAutoPathConsent.upgradeDone',
    );
  });

  it('reports a rejected upgrade outcome as a failure instead of a success', async () => {
    grantTopicAccess.mockResolvedValue({ code: 'UNKNOWN', message: 'nope', ok: false });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderNotice();

    fireEvent.click(upgradeButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'workspaceAutoPathConsent.upgradeFailed',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The button returns to a usable state so the user can retry.
    expect(upgradeButton()).toBeEnabled();
    consoleError.mockRestore();
  });

  it('ignores repeat clicks while a request is still in flight', async () => {
    const pendingResolvers: Array<(value: unknown) => void> = [];
    grantTopicAccess.mockImplementation(
      () => new Promise((resolve) => pendingResolvers.push(resolve)),
    );
    renderNotice();

    fireEvent.click(upgradeButton());
    fireEvent.click(upgradeButton());
    fireEvent.click(revokeButton());

    expect(grantTopicAccess).toHaveBeenCalledTimes(1);
    expect(revokeTopicGrant).not.toHaveBeenCalled();
    expect(upgradeButton()).toBeDisabled();

    const releaseAll = async () => {
      while (pendingResolvers.length > 0) {
        pendingResolvers.shift()!({ ok: true, value: grant() });
        await Promise.resolve();
      }
    };
    await releaseAll();
    await waitFor(() => expect(grantTopicAccess).toHaveBeenCalledTimes(2));
    await releaseAll();

    await waitFor(() => expect(upgradeButton()).toBeEnabled());
  });

  it('revokes only the grants held for exactly these roots', async () => {
    state.grants = [
      grant({ id: 'grant-docs', rootPath: '/home/me/docs' }),
      // An ancestor grant covers the path but was authorized elsewhere.
      grant({ id: 'grant-home', rootPath: '/home/me' }),
      grant({ id: 'grant-revoked', revokedAt: '2026-09-04T01:00:00.000Z' }),
    ];
    renderNotice();

    // Every audited root is covered, so there is nothing left to upgrade.
    expect(upgradeButton()).toBeDisabled();
    expect(screen.getByText('workspaceAutoPathConsent.upgradeUnavailable')).toBeInTheDocument();

    fireEvent.click(revokeButton());

    await waitFor(() => expect(revokeTopicGrant).toHaveBeenCalledTimes(1));
    expect(revokeTopicGrant).toHaveBeenCalledWith({
      deviceId: 'device-1',
      id: 'grant-docs',
      topicId: 'topic-1',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'workspaceAutoPathConsent.revokeDone',
    );
  });

  it('disables revoke and says why while no topic grant exists for these roots', () => {
    renderNotice();

    expect(revokeButton()).toBeDisabled();
    expect(screen.getByText('workspaceAutoPathConsent.revokeUnavailable')).toBeInTheDocument();
    fireEvent.click(revokeButton());
    expect(revokeTopicGrant).not.toHaveBeenCalled();
  });

  it('holds both actions while the topic grants are still loading', () => {
    fetchResult.isLoading = true;
    renderNotice();

    expect(screen.getByTestId('auto-path-consent')).toHaveAttribute('aria-busy', 'true');
    expect(upgradeButton()).toBeDisabled();
    expect(revokeButton()).toBeDisabled();
  });

  it('replaces the actions with a retry when the grants cannot be loaded', () => {
    fetchResult.error = new Error('offline');
    renderNotice();

    expect(screen.getByRole('alert')).toHaveTextContent('workspaceAutoPathConsent.grantsError');
    expect(
      screen.queryByRole('button', { name: 'workspaceAutoPathConsent.upgrade' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'workspaceAutoPathConsent.grantsRetry' }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('exposes both actions as real keyboard-reachable buttons in one labelled group', () => {
    renderNotice();

    const group = screen.getByRole('group', { name: 'workspaceAutoPathConsent.actions' });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(group).toContainElement(button);
      expect(button.tagName).toBe('BUTTON');
      expect(button).not.toHaveAttribute('tabindex', '-1');
    }
  });
});
