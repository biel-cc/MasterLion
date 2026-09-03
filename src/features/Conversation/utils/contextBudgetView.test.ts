import type { ContextBudgetFailCode } from '@lobechat/types/src/contextBudget';
import { describe, expect, it } from 'vitest';

import {
  buildContextBudgetErrorViewModel,
  type ContextBudgetFailurePayload,
  getContextBudgetFailureFromErrorBody,
  resolveContextRecoveryPresentation,
} from './contextBudgetView';

/** Fixture secrets that must never reach the view model, DOM, or snapshots. */
const SECRET = {
  attachmentName: 'payroll-2026-Q3-CONFIDENTIAL.xlsx',
  fileUrl: 'https://files.internal.example/secret/payroll.xlsx?token=sk-live-9f8e7d',
  rawMessage: 'My password is hunter2-super-secret',
  toolResult: '{"apiKey":"AKIA-SECRET-TOOL-RESULT"}',
};

const ALL_ACTIONS = ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'];

const buildErrorBody = (code: ContextBudgetFailCode, overrides: Record<string, unknown> = {}) => ({
  attachments: [{ name: SECRET.attachmentName, url: SECRET.fileUrl }],
  contextBudget: {
    decision: {
      actions: ALL_ACTIONS,
      code,
      kind: 'fail',
      offending: [
        {
          content: SECRET.rawMessage,
          estimatedTokens: 120_000,
          fileName: SECRET.attachmentName,
          messageId: 'msg-user-9',
          source: 'attachment',
        },
        { estimatedTokens: 30_000, messageId: 'msg-tool-3', source: 'tool-result' },
        { estimatedTokens: 9000, messageId: 'msg-user-9', source: 'text' },
        { estimatedTokens: 1000, source: 'system' },
        { estimatedTokens: 500, source: 'tools' },
      ],
    },
    trace: {
      attempt: 1,
      decision: { kind: 'fail' },
      effectiveWindowSource: 'observed',
      effectiveWindowTokens: 32_000,
      estimatedPromptTokens: 160_500,
      modelId: 'gpt-4o-mini',
      offending: [{ content: SECRET.toolResult, estimatedTokens: 1, source: 'tool-result' }],
      operationId: 'op-42',
      payloadFingerprint: 'fp-abc',
      providerId: 'aihub',
      rawPrompt: SECRET.rawMessage,
      warnings: [],
    },
  },
  message: SECRET.rawMessage,
  messages: [
    {
      content: SECRET.rawMessage,
      files: [{ name: SECRET.attachmentName, url: SECRET.fileUrl }],
      role: 'user',
    },
  ],
  toolResult: SECRET.toolResult,
  ...overrides,
});

const failure = (code: ContextBudgetFailCode): ContextBudgetFailurePayload =>
  getContextBudgetFailureFromErrorBody(buildErrorBody(code))!;

const expectNoSecrets = (value: unknown) => {
  const serialized = JSON.stringify(value);
  for (const secret of Object.values(SECRET)) {
    expect(serialized).not.toContain(secret);
  }
  expect(serialized).not.toContain('hunter2');
  expect(serialized).not.toContain('sk-live');
  expect(serialized).not.toContain('AKIA');
};

describe('getContextBudgetFailureFromErrorBody', () => {
  it('returns undefined for legacy bodies without a typed decision', () => {
    expect(getContextBudgetFailureFromErrorBody(undefined)).toBeUndefined();
    expect(getContextBudgetFailureFromErrorBody(null)).toBeUndefined();
    expect(getContextBudgetFailureFromErrorBody('ExceededContextWindow')).toBeUndefined();
    expect(getContextBudgetFailureFromErrorBody({ provider: 'openai' })).toBeUndefined();
    expect(getContextBudgetFailureFromErrorBody({ contextBudget: {} })).toBeUndefined();
  });

  it('ignores non-fail decisions and unknown fail codes', () => {
    expect(
      getContextBudgetFailureFromErrorBody({
        contextBudget: {
          decision: { attempt: 1, candidateIds: [], kind: 'compress', preservedIds: [] },
        },
      }),
    ).toBeUndefined();
    expect(
      getContextBudgetFailureFromErrorBody({
        contextBudget: { decision: { actions: [], code: 'SOMETHING_ELSE', kind: 'fail' } },
      }),
    ).toBeUndefined();
  });

  it('accepts both the nested contextBudget shape and fields spread on the body', () => {
    const nested = getContextBudgetFailureFromErrorBody(buildErrorBody('TAIL_TOO_LARGE'));
    const spread = getContextBudgetFailureFromErrorBody(
      buildErrorBody('TAIL_TOO_LARGE').contextBudget,
    );

    expect(nested?.decision.code).toBe('TAIL_TOO_LARGE');
    expect(spread).toEqual(nested);
  });

  it('whitelists the decision: known actions and sources only, ids and counts only', () => {
    const result = getContextBudgetFailureFromErrorBody({
      contextBudget: {
        decision: {
          actions: ['switch_model', 'delete_everything', 'switch_model', 42],
          code: 'NO_CANDIDATES',
          kind: 'fail',
          offending: [
            { estimatedTokens: 12.7, source: 'text' },
            { estimatedTokens: -1, source: 'text' },
            { estimatedTokens: Number.NaN, source: 'text' },
            { estimatedTokens: 5, source: 'database' },
            { estimatedTokens: 5, source: 'tools', url: SECRET.fileUrl },
            'not-a-record',
          ],
        },
      },
    });

    expect(result?.decision).toEqual({
      actions: ['switch_model'],
      code: 'NO_CANDIDATES',
      kind: 'fail',
      offending: [
        { estimatedTokens: 12, source: 'text' },
        { estimatedTokens: 5, source: 'tools' },
      ],
    });
  });

  it('whitelists the trace: known diagnostics fields only, identifiers capped', () => {
    const longModelId = `model-${'x'.repeat(300)}`;
    const result = getContextBudgetFailureFromErrorBody({
      contextBudget: {
        decision: { actions: [], code: 'RETRY_EXHAUSTED', kind: 'fail', offending: [] },
        trace: {
          attempt: 2,
          effectiveWindowSource: '  assumed ',
          effectiveWindowTokens: 32_000.9,
          estimatedPromptTokens: '5000',
          modelId: longModelId,
          providerId: '',
          rawMessages: [SECRET.rawMessage],
          warnings: ['WINDOW_UNKNOWN', 'SOMETHING_ELSE', SECRET.toolResult, 'WINDOW_UNKNOWN'],
        },
      },
    });

    expect(result?.trace).toEqual({
      effectiveWindowSource: 'assumed',
      effectiveWindowTokens: 32_000,
      modelId: `model-${'x'.repeat(114)}`,
      warnings: ['WINDOW_UNKNOWN'],
    });
    expect(result?.trace?.modelId).toHaveLength(120);
  });

  it('omits the trace entirely when it carries nothing usable', () => {
    const result = getContextBudgetFailureFromErrorBody({
      contextBudget: {
        decision: { actions: [], code: 'RETRY_EXHAUSTED', kind: 'fail', offending: [] },
        trace: { rawPrompt: SECRET.rawMessage },
      },
    });

    expect(result).toEqual({
      decision: { actions: [], code: 'RETRY_EXHAUSTED', kind: 'fail', offending: [] },
    });
  });

  it.each(['TAIL_TOO_LARGE', 'NO_CANDIDATES', 'SUMMARY_FAILED', 'RETRY_EXHAUSTED'] as const)(
    'never carries raw messages, attachments, urls, file names or tool results for %s',
    (code) => {
      const result = getContextBudgetFailureFromErrorBody(buildErrorBody(code));

      expect(result).toBeDefined();
      expectNoSecrets(result);
      expect(JSON.stringify(result)).not.toContain('messageId');
      expect(JSON.stringify(result)).not.toContain('payloadFingerprint');
    },
  );
});

describe('buildContextBudgetErrorViewModel', () => {
  describe('per-code title / body / action / disabled matrix', () => {
    it('TAIL_TOO_LARGE: largest source leads, no re-compress, attachments / model / branch', () => {
      const vm = buildContextBudgetErrorViewModel(failure('TAIL_TOO_LARGE'));

      expect(vm.titleKey).toBe('contextBudget.title.TAIL_TOO_LARGE');
      expect(vm.descKey).toBe('contextBudget.desc.TAIL_TOO_LARGE');
      expect(vm.largestSource).toEqual({
        estimatedTokens: 120_000,
        labelKey: 'contextBudget.source.attachment',
        source: 'attachment',
      });
      expect(vm.actions.map((a) => [a.id, a.disabled, a.primary])).toEqual([
        ['detach_attachments', false, true],
        ['switch_model', false, false],
        ['fork_topic', false, false],
      ]);
      expect(vm.hintKeys).toEqual([
        'contextBudget.hint.detachAttachments',
        'contextBudget.hint.shortenMessage',
        'contextBudget.hint.switchModel',
        'contextBudget.hint.forkTopic',
      ]);
      expect(vm.originalMessagesPreserved).toBe(true);
      expect(vm.noteKey).toBeUndefined();
      expect(vm.allowsAutoRetry).toBe(false);
    });

    it('TAIL_TOO_LARGE: a dominant tool result unlocks truncation as the leading action', () => {
      const payload: ContextBudgetFailurePayload = {
        decision: {
          actions: ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'],
          code: 'TAIL_TOO_LARGE',
          kind: 'fail',
          offending: [
            { estimatedTokens: 90_000, source: 'tool-result' },
            { estimatedTokens: 1000, source: 'text' },
          ],
        },
      };
      const vm = buildContextBudgetErrorViewModel(payload);

      expect(vm.actions.map((a) => a.id)).toEqual([
        'truncate_tool_results',
        'detach_attachments',
        'switch_model',
        'fork_topic',
      ]);
      expect(vm.actions[0].primary).toBe(true);
      expect(vm.hintKeys[0]).toBe('contextBudget.hint.truncateToolResults');
    });

    it('TAIL_TOO_LARGE: a dominant text message suggests shortening first and leads with a larger model', () => {
      const payload: ContextBudgetFailurePayload = {
        decision: {
          actions: ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'],
          code: 'TAIL_TOO_LARGE',
          kind: 'fail',
          offending: [{ estimatedTokens: 200_000, source: 'text' }],
        },
      };
      const vm = buildContextBudgetErrorViewModel(payload);

      expect(vm.actions.map((a) => [a.id, a.primary])).toEqual([
        ['switch_model', true],
        ['detach_attachments', false],
        ['fork_topic', false],
      ]);
      expect(vm.actions.some((a) => a.id === 'truncate_tool_results')).toBe(false);
      expect(vm.hintKeys[0]).toBe('contextBudget.hint.shortenMessage');
    });

    it('NO_CANDIDATES: re-compress is visible but disabled with a reason; no enabled retry', () => {
      const vm = buildContextBudgetErrorViewModel(failure('NO_CANDIDATES'));

      expect(vm.titleKey).toBe('contextBudget.title.NO_CANDIDATES');
      expect(vm.descKey).toBe('contextBudget.desc.NO_CANDIDATES');
      expect(vm.actions.map((a) => [a.id, a.disabled, a.primary])).toEqual([
        ['retry_compression', true, false],
        ['truncate_tool_results', false, true],
        ['detach_attachments', false, false],
        ['switch_model', false, false],
        ['fork_topic', false, false],
      ]);
      expect(vm.actions[0].disabledReasonKey).toBe(
        'contextBudget.action.retryCompressionUnavailable',
      );
      expect(
        vm.actions.some((a) => a.id === 'retry_compression' && !a.disabled),
      ).toBe(false);
      expect(vm.hintKeys).toEqual([
        'contextBudget.hint.truncateToolResults',
        'contextBudget.hint.detachAttachments',
        'contextBudget.hint.switchModel',
        'contextBudget.hint.forkTopic',
      ]);
      expect(vm.originalMessagesPreserved).toBe(true);
    });

    it('SUMMARY_FAILED: retry summary or change compression model, originals preserved', () => {
      const vm = buildContextBudgetErrorViewModel(failure('SUMMARY_FAILED'));

      expect(vm.titleKey).toBe('contextBudget.title.SUMMARY_FAILED');
      expect(vm.descKey).toBe('contextBudget.desc.SUMMARY_FAILED');
      expect(vm.actions.map((a) => [a.id, a.disabled, a.primary])).toEqual([
        ['retry_compression', false, true],
        ['switch_compression_model', false, false],
        ['switch_model', false, false],
        ['fork_topic', false, false],
      ]);
      expect(vm.originalMessagesPreserved).toBe(true);
      expect(vm.noteKey).toBe('contextBudget.note.originalsPreserved');
      expect(vm.hintKeys).toEqual([
        'contextBudget.hint.switchCompressionModel',
        'contextBudget.hint.switchModel',
        'contextBudget.hint.forkTopic',
      ]);
    });

    it('RETRY_EXHAUSTED: switch model or new topic only, never another compression or auto retry', () => {
      const vm = buildContextBudgetErrorViewModel(failure('RETRY_EXHAUSTED'));

      expect(vm.titleKey).toBe('contextBudget.title.RETRY_EXHAUSTED');
      expect(vm.descKey).toBe('contextBudget.desc.RETRY_EXHAUSTED');
      expect(vm.actions.map((a) => [a.id, a.disabled, a.primary])).toEqual([
        ['switch_model', false, true],
        ['fork_topic', false, false],
      ]);
      expect(vm.actions.some((a) => a.id === 'retry_compression')).toBe(false);
      expect(vm.allowsAutoRetry).toBe(false);
      expect(vm.originalMessagesPreserved).toBe(false);
      expect(vm.noteKey).toBe('contextBudget.note.autoRetryStopped');
      expect(vm.hintKeys).toEqual(['contextBudget.hint.switchModel', 'contextBudget.hint.forkTopic']);
    });

    it('only offers contract actions the decision actually listed', () => {
      const vm = buildContextBudgetErrorViewModel({
        decision: {
          actions: ['switch_model'],
          code: 'RETRY_EXHAUSTED',
          kind: 'fail',
          offending: [],
        },
      });

      expect(vm.actions.map((a) => a.id)).toEqual(['switch_model']);
    });
  });

  describe('availability and disabled state', () => {
    it('hides actions without a handler but keeps the purposely disabled re-compress', () => {
      const vm = buildContextBudgetErrorViewModel(failure('NO_CANDIDATES'), {
        availableActions: ['fork_topic'],
      });

      expect(vm.actions.map((a) => [a.id, a.disabled, a.primary])).toEqual([
        ['retry_compression', true, false],
        ['fork_topic', false, true],
      ]);
    });

    it('renders no buttons when nothing is wired, but still lists the hints', () => {
      const vm = buildContextBudgetErrorViewModel(failure('RETRY_EXHAUSTED'), {
        availableActions: [],
      });

      expect(vm.actions).toEqual([]);
      expect(vm.hintKeys.length).toBeGreaterThan(0);
    });

    it('marks disabled actions and moves the primary to the next enabled one', () => {
      const vm = buildContextBudgetErrorViewModel(failure('SUMMARY_FAILED'), {
        disabledActions: ['retry_compression'],
      });

      expect(vm.actions.map((a) => [a.id, a.disabled, a.primary])).toEqual([
        ['retry_compression', true, false],
        ['switch_compression_model', false, true],
        ['switch_model', false, false],
        ['fork_topic', false, false],
      ]);
      expect(vm.actions[0].disabledReasonKey).toBeUndefined();
    });
  });

  describe('diagnostics', () => {
    it('exposes model/provider, effective window + source, estimated prompt, attempt and dominant sources', () => {
      const { diagnostics } = buildContextBudgetErrorViewModel(failure('NO_CANDIDATES'));

      expect(diagnostics).toEqual({
        attempt: 1,
        attemptLimit: 1,
        dominantSources: [
          {
            estimatedTokens: 120_000,
            labelKey: 'contextBudget.source.attachment',
            share: 120_000 / 160_500,
            source: 'attachment',
          },
          {
            estimatedTokens: 30_000,
            labelKey: 'contextBudget.source.toolResult',
            share: 30_000 / 160_500,
            source: 'tool-result',
          },
          {
            estimatedTokens: 9000,
            labelKey: 'contextBudget.source.text',
            share: 9000 / 160_500,
            source: 'text',
          },
        ],
        estimatedPromptTokens: 160_500,
        hasDiagnostics: true,
        modelId: 'gpt-4o-mini',
        operationId: 'op-42',
        providerId: 'aihub',
        windowSource: 'observed',
        windowSourceLabelKey: 'contextBudget.diagnostics.windowSource.observed',
        windowTokens: 32_000,
        windowUnknown: false,
      });
    });

    it('aggregates offending items per source before ranking', () => {
      const { diagnostics } = buildContextBudgetErrorViewModel({
        decision: {
          actions: [],
          code: 'RETRY_EXHAUSTED',
          kind: 'fail',
          offending: [
            { estimatedTokens: 10, source: 'text' },
            { estimatedTokens: 25, source: 'tool-result' },
            { estimatedTokens: 20, source: 'text' },
          ],
        },
      });

      expect(diagnostics.dominantSources.map((s) => [s.source, s.estimatedTokens])).toEqual([
        ['text', 30],
        ['tool-result', 25],
      ]);
      expect(diagnostics.dominantSources.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
    });

    it('flags an unknown window from either the assumed source or the warning', () => {
      const base = failure('RETRY_EXHAUSTED');

      expect(
        buildContextBudgetErrorViewModel({
          ...base,
          trace: { ...base.trace, effectiveWindowSource: 'assumed' },
        }).diagnostics,
      ).toMatchObject({
        windowSource: 'assumed',
        windowSourceLabelKey: 'contextBudget.diagnostics.windowSource.assumed',
        windowUnknown: true,
      });
      expect(
        buildContextBudgetErrorViewModel({
          ...base,
          trace: { ...base.trace, effectiveWindowSource: 'aihub', warnings: ['WINDOW_UNKNOWN'] },
        }).diagnostics,
      ).toMatchObject({
        windowSource: 'aihub',
        windowSourceLabelKey: undefined,
        windowUnknown: true,
      });
    });

    it('reports no diagnostics when neither trace nor offending items exist', () => {
      const { diagnostics } = buildContextBudgetErrorViewModel({
        decision: { actions: [], code: 'RETRY_EXHAUSTED', kind: 'fail', offending: [] },
      });

      expect(diagnostics.hasDiagnostics).toBe(false);
      expect(diagnostics.dominantSources).toEqual([]);
    });
  });

  it.each(['TAIL_TOO_LARGE', 'NO_CANDIDATES', 'SUMMARY_FAILED', 'RETRY_EXHAUSTED'] as const)(
    'view model for %s contains no fixture secret or raw content',
    (code) => {
      expectNoSecrets(buildContextBudgetErrorViewModel(failure(code)));
    },
  );
});

describe('resolveContextRecoveryPresentation', () => {
  it('shows only the non-blocking progress while automatic compression is pending', () => {
    expect(
      resolveContextRecoveryPresentation({
        failure: failure('SUMMARY_FAILED'),
        isCompressing: true,
      }),
    ).toEqual({ kind: 'progress' });
  });

  it('leaves no error behind after pending → success', () => {
    const pending = resolveContextRecoveryPresentation({ failure: null, isCompressing: true });
    const success = resolveContextRecoveryPresentation({ failure: null, isCompressing: false });

    expect(pending).toEqual({ kind: 'progress' });
    expect(success).toEqual({ kind: 'none' });
  });

  it('renders the terminal card only after pending → failure', () => {
    const terminal = failure('TAIL_TOO_LARGE');

    expect(
      resolveContextRecoveryPresentation({ failure: terminal, isCompressing: false }),
    ).toEqual({ failure: terminal, kind: 'error' });
  });
});
