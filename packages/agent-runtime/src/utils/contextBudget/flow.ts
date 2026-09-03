import type {
  ContextBudgetAttemptState,
  ContextBudgetDecision,
  ContextCompressionOutcome,
} from '@lobechat/types/src/contextBudget';
import { canContinueAfterCompression } from '@lobechat/types/src/contextBudget';

import { evaluateContextBudget, failureAfterCompression } from './preflight';
import { parseExceededContextWindowError } from './providerError';
import type {
  ContextBudgetEvaluation,
  EvaluateContextBudgetInput,
  FinalContextPayload,
} from './types';

export interface ContextBudgetCompressionResult<TPayload> {
  outcome: ContextCompressionOutcome;
  payload: TPayload;
}

export interface RunContextBudgetedCallInput<
  TPayload extends FinalContextPayload,
  TResult,
> extends Omit<EvaluateContextBudgetInput, keyof FinalContextPayload | 'trigger'> {
  callProvider: (payload: TPayload) => Promise<TResult>;
  compress: (
    payload: TPayload,
    evaluation: ContextBudgetEvaluation,
  ) => Promise<ContextBudgetCompressionResult<TPayload>>;
  payload: TPayload;
}

export type ContextBudgetedCallResult<TResult> =
  | {
      attemptState: ContextBudgetAttemptState;
      evaluations: ContextBudgetEvaluation[];
      kind: 'success';
      value: TResult;
    }
  | {
      attemptState: ContextBudgetAttemptState;
      decision: Extract<ContextBudgetDecision, { kind: 'fail' }>;
      evaluations: ContextBudgetEvaluation[];
      kind: 'fail';
    };

const isFailure = (
  decision: ContextBudgetDecision,
): decision is Extract<ContextBudgetDecision, { kind: 'fail' }> => decision.kind === 'fail';

/**
 * Reference orchestration for final preflight plus one provider-error recovery.
 * Runtime integration may call the same helpers at its existing executor boundaries.
 */
export const runContextBudgetedCall = async <TPayload extends FinalContextPayload, TResult>(
  input: RunContextBudgetedCallInput<TPayload, TResult>,
): Promise<ContextBudgetedCallResult<TResult>> => {
  let payload = input.payload;
  let compressionAttempt: ContextBudgetAttemptState['compressionAttempt'] =
    input.attemptState?.compressionAttempt === 1 ? 1 : 0;
  const sentPayloadFingerprints = [...(input.attemptState?.sentPayloadFingerprints ?? [])];
  const evaluations: ContextBudgetEvaluation[] = [];

  const evaluate = (
    trigger: EvaluateContextBudgetInput['trigger'],
    observedWindowTokens?: number,
  ) => {
    const evaluation = evaluateContextBudget({
      ...input,
      ...payload,
      attemptState: {
        compressionAttempt,
        payloadFingerprint: '',
        sentPayloadFingerprints,
      },
      observedWindowTokens,
      trigger,
    });
    evaluations.push(evaluation);
    return evaluation;
  };

  const state = (fingerprint: string): ContextBudgetAttemptState => ({
    compressionAttempt,
    payloadFingerprint: fingerprint,
    sentPayloadFingerprints,
  });

  const fail = (
    decision: Extract<ContextBudgetDecision, { kind: 'fail' }>,
    fingerprint: string,
  ): ContextBudgetedCallResult<TResult> => ({
    attemptState: state(fingerprint),
    decision,
    evaluations,
    kind: 'fail',
  });

  const compressAndPreflight = async (
    evaluation: ContextBudgetEvaluation,
    observedWindowTokens?: number,
  ): Promise<ContextBudgetEvaluation | ContextBudgetedCallResult<TResult>> => {
    let compressed: ContextBudgetCompressionResult<TPayload>;
    try {
      compressed = await input.compress(payload, evaluation);
    } catch {
      const outcome: ContextCompressionOutcome = {
        afterTokens: evaluation.estimatedPromptTokens,
        attempt: 1,
        beforeTokens: evaluation.estimatedPromptTokens,
        code: 'SUMMARY_FAILED',
        outcome: 'failed',
        payloadFingerprint: evaluation.payloadFingerprint,
        trigger:
          evaluation.decision.kind === 'compress' ? evaluation.decision.trigger : 'final-preflight',
      };
      const decision = failureAfterCompression(outcome, evaluation.trace.offending);
      return fail(
        decision as Extract<ContextBudgetDecision, { kind: 'fail' }>,
        evaluation.payloadFingerprint,
      );
    }

    const outcomeFailure = failureAfterCompression(compressed.outcome, evaluation.trace.offending);
    if (!canContinueAfterCompression(compressed.outcome) && outcomeFailure?.kind === 'fail') {
      return fail(outcomeFailure, evaluation.payloadFingerprint);
    }

    payload = compressed.payload;
    compressionAttempt = 1;
    const postCompression = evaluate('final-preflight', observedWindowTokens);
    const measuredOutcome = {
      ...compressed.outcome,
      afterTokens: postCompression.estimatedPromptTokens,
    };
    const measuredFailure = failureAfterCompression(
      measuredOutcome,
      postCompression.trace.offending,
    );
    if (postCompression.payloadFingerprint === evaluation.payloadFingerprint || measuredFailure) {
      const duplicateFailure =
        measuredFailure ??
        failureAfterCompression(
          { ...measuredOutcome, afterTokens: measuredOutcome.beforeTokens },
          postCompression.trace.offending,
        );
      return fail(
        duplicateFailure as Extract<ContextBudgetDecision, { kind: 'fail' }>,
        postCompression.payloadFingerprint,
      );
    }
    if (isFailure(postCompression.decision)) {
      return fail(postCompression.decision, postCompression.payloadFingerprint);
    }
    if (postCompression.decision.kind !== 'send') {
      const decision = failureAfterCompression(
        {
          ...compressed.outcome,
          afterTokens: compressed.outcome.beforeTokens,
        },
        postCompression.trace.offending,
      );
      return fail(
        decision as Extract<ContextBudgetDecision, { kind: 'fail' }>,
        postCompression.payloadFingerprint,
      );
    }
    return postCompression;
  };

  let ready = evaluate('final-preflight');
  if (isFailure(ready.decision)) return fail(ready.decision, ready.payloadFingerprint);
  if (ready.decision.kind === 'compress') {
    const result = await compressAndPreflight(ready);
    if ('kind' in result) return result;
    ready = result;
  }

  sentPayloadFingerprints.push(ready.payloadFingerprint);
  try {
    const value = await input.callProvider(payload);
    return { attemptState: state(ready.payloadFingerprint), evaluations, kind: 'success', value };
  } catch (error) {
    const providerError = parseExceededContextWindowError(error);
    if (!providerError) throw error;

    const recovery = evaluate('provider-error', providerError.observedLimitTokens);
    if (isFailure(recovery.decision)) {
      return fail(recovery.decision, recovery.payloadFingerprint);
    }
    if (recovery.decision.kind !== 'compress') {
      throw new Error('provider-error decision must compress or fail', { cause: error });
    }

    const compressed = await compressAndPreflight(recovery, providerError.observedLimitTokens);
    if ('kind' in compressed) return compressed;
    ready = compressed;
    sentPayloadFingerprints.push(ready.payloadFingerprint);

    try {
      const value = await input.callProvider(payload);
      return { attemptState: state(ready.payloadFingerprint), evaluations, kind: 'success', value };
    } catch (retryError) {
      const retryProviderError = parseExceededContextWindowError(retryError);
      if (!retryProviderError) throw retryError;
      const exhausted = evaluate(
        'provider-error',
        retryProviderError.observedLimitTokens ?? providerError.observedLimitTokens,
      );
      if (!isFailure(exhausted.decision)) {
        throw new Error('second provider-error decision must fail', { cause: retryError });
      }
      return fail(exhausted.decision, exhausted.payloadFingerprint);
    }
  }
};
