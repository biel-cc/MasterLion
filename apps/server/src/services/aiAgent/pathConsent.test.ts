import { describe, expect, it } from 'vitest';

import {
  getRuntimePathConsentRequest,
  parseWorkspacePathConsentRequest,
  validateOperationPathConsent,
} from './pathConsent';

const request = {
  actualCwd: '/workspace',
  deviceId: 'device-a',
  modes: ['read'] as const,
  operationId: 'op-old',
  primaryCwd: '/workspace',
  requestedPath: '/outside/docs',
  topicId: 'topic-a',
  version: 1 as const,
};

const approval = {
  deviceId: 'device-a',
  modes: ['read'] as const,
  requestedPath: '/outside/docs',
  rootPath: '/outside/docs',
  scope: 'operation' as const,
  sourceOperationId: 'op-old',
  topicId: 'topic-a',
  version: 1 as const,
};

describe('operation path consent', () => {
  it('reads only structured runtime-authored plugin metadata', () => {
    expect(getRuntimePathConsentRequest({ state: { workspacePathConsent: request } })).toEqual(
      request,
    );
    expect(
      getRuntimePathConsentRequest({ state: { requestedPath: '/prompt/path' } }),
    ).toBeUndefined();
    expect(
      parseWorkspacePathConsentRequest({ ...request, requestedPath: 'relative' }),
    ).toBeUndefined();
  });

  it('accepts an unbound absolute-read request with empty cwd display fields', () => {
    expect(
      parseWorkspacePathConsentRequest({ ...request, actualCwd: '', primaryCwd: '' }),
    ).toMatchObject({ actualCwd: '', primaryCwd: '', requestedPath: '/outside/docs' });
  });

  it('preserves the lexical request until the selected device supplies realpath', () => {
    expect(
      parseWorkspacePathConsentRequest({ ...request, requestedPath: '/outside/link/../docs' }),
    ).toMatchObject({ requestedPath: '/outside/link/../docs' });
  });

  it('rewrites the root tuple to the new operation', () => {
    expect(
      validateOperationPathConsent({
        approval: { ...approval, modes: [...approval.modes] },
        canonicalRootPath: '/outside/docs',
        currentDeviceId: 'device-a',
        currentOperationId: 'op-new',
        currentTopicId: 'topic-a',
        request: { ...request, modes: [...request.modes] },
      }),
    ).toEqual({
      deviceId: 'device-a',
      modes: ['read'],
      operationId: 'op-new',
      rootPath: '/outside/docs',
      scope: 'operation',
      source: 'user-approval',
      topicId: 'topic-a',
    });
  });

  it.each([
    { sourceOperationId: 'op-other' },
    { topicId: 'topic-other' },
    { deviceId: 'device-other' },
    { requestedPath: '/outside/other' },
  ])('rejects a mismatched old-operation tuple %#', (override) => {
    expect(() =>
      validateOperationPathConsent({
        approval: { ...approval, ...override, modes: [...approval.modes] },
        currentDeviceId: 'device-a',
        currentOperationId: 'op-new',
        currentTopicId: 'topic-a',
        request: { ...request, modes: [...request.modes] },
      }),
    ).toThrow(/does not match/);
  });

  it('allows explicit write operation consent when it exactly matches runtime evidence', () => {
    expect(
      validateOperationPathConsent({
        approval: { ...approval, modes: ['write'] },
        currentDeviceId: 'device-a',
        currentOperationId: 'op-new',
        currentTopicId: 'topic-a',
        request: { ...request, modes: ['write'] },
      }),
    ).toMatchObject({ modes: ['write'], scope: 'operation', source: 'user-approval' });
  });

  it('requires the approval root to equal the device-authored canonical path', () => {
    expect(() =>
      validateOperationPathConsent({
        approval: { ...approval, modes: [...approval.modes], rootPath: '/canonical/elsewhere' },
        canonicalRootPath: '/outside/docs',
        currentDeviceId: 'device-a',
        currentOperationId: 'op-new',
        currentTopicId: 'topic-a',
        request: { ...request, modes: [...request.modes] },
      }),
    ).toThrow(/canonical root/);
  });

  it('rejects modes that do not exactly match runtime evidence', () => {
    expect(() =>
      validateOperationPathConsent({
        approval: { ...approval, modes: ['write'] },
        currentDeviceId: 'device-a',
        currentOperationId: 'op-new',
        currentTopicId: 'topic-a',
        request: { ...request, modes: ['read'] },
      }),
    ).toThrow(/modes do not match/);
  });
});
