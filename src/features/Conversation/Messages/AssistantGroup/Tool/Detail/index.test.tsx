/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Detail from './index';

const { noticeRender } = vi.hoisted(() => ({
  noticeRender: vi.fn(() => <div data-testid="auto-path-consent" />),
}));

vi.mock('@lobehub/builtin-tools/streamings', () => ({ getBuiltinStreaming: () => undefined }));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('./AutoPathConsent', () => ({ default: noticeRender }));
vi.mock('./Render', () => ({ default: () => <div data-testid="tool-render" /> }));
vi.mock('./LoadingPlaceholder', () => ({ default: () => <div data-testid="placeholder" /> }));
vi.mock('./AbortResponse', () => ({ default: () => null }));
vi.mock('./RejectedResponse', () => ({ default: () => null }));

const auditEntry = (target: string) => ({
  deviceId: 'device-1',
  mode: 'read',
  operationId: 'op-1',
  path: target,
  rootPath: '/home/me/docs',
  scopeVerdict: 'consent:op-1',
  source: 'direct-user-message',
  topicId: 'topic-1',
});

// Two files read below one authorized root, which is how a real multi-path call audits.
const auditedState = {
  scopeAudit: [auditEntry('/home/me/docs/a.txt'), auditEntry('/home/me/docs/deep/b.txt')],
};

const renderDetail = (result: Record<string, unknown>) =>
  render(
    <Detail
      apiName="readFile"
      identifier="lobe-local-system"
      messageId="block-1"
      result={result as never}
      toolCallId="call-1"
      toolMessageId="msg-1"
    />,
  );

describe('<Detail /> auto path consent', () => {
  afterEach(() => {
    noticeRender.mockClear();
    cleanup();
  });

  it('surfaces one deduplicated authorization root from the runtime success audit', () => {
    renderDetail({ content: 'ok', state: auditedState });

    expect(screen.getByTestId('auto-path-consent')).toBeInTheDocument();
    expect(noticeRender).toHaveBeenCalledWith(
      {
        evidence: {
          deviceId: 'device-1',
          operationId: 'op-1',
          roots: ['/home/me/docs'],
          topicId: 'topic-1',
        },
        messageId: 'msg-1',
        toolCallId: 'call-1',
      },
      undefined,
    );
  });

  it('never claims an auto release on a failed call', () => {
    renderDetail({
      content: 'SCOPE_DENIED',
      error: { body: {}, type: 'PluginServerError' },
      state: auditedState,
    });

    expect(screen.queryByTestId('auto-path-consent')).not.toBeInTheDocument();
  });

  it('leaves an ordinary result untouched', () => {
    renderDetail({ content: 'ok', state: { result: 'ok' } });

    expect(screen.queryByTestId('auto-path-consent')).not.toBeInTheDocument();
    expect(screen.getByTestId('tool-render')).toBeInTheDocument();
  });
});
