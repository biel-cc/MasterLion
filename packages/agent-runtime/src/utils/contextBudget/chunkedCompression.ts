import type {
  ContextBudgetTrigger,
  ContextCompressionOutcome,
} from '@lobechat/types/src/contextBudget';

interface SummaryItem {
  candidateIds: string[];
  text: string;
}

export interface CompressionPayloadMeasurement {
  /** Fingerprint of the exact provider-visible payload represented by `messages`. */
  payloadFingerprint: string;
  tokens: number;
}

export interface CompressionGroupTrace {
  candidateIds: string[];
  failureCode?: 'SUMMARY_FAILED';
  groupId: string;
  levels: number;
  requestCount: number;
  requestTokens: number[];
  status: 'completed' | 'failed' | 'skipped';
}

export interface HierarchicalCompressionResult<TMessage> {
  group: CompressionGroupTrace;
  messages: TMessage[];
  outcome: ContextCompressionOutcome;
}

export interface HierarchicalCompressionInput<TMessage, TRequest> {
  buildRequest: (items: readonly SummaryItem[], level: number) => TRequest;
  candidateIds: readonly string[];
  createSummaryMessage: (
    summary: string,
    candidateIds: readonly string[],
    groupId: string,
  ) => TMessage;
  getMessageId: (message: TMessage, index: number) => string;
  groupId: string;
  maxLevels?: number;
  measurePayload: (messages: readonly TMessage[]) => CompressionPayloadMeasurement;
  measureRequest: (request: TRequest) => number;
  messages: readonly TMessage[];
  renderMessage: (message: TMessage) => string;
  summarize: (request: TRequest) => Promise<string>;
  summaryModelBudgetTokens: number;
  trigger: ContextBudgetTrigger;
}

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

const splitToFit = <TRequest>(
  item: SummaryItem,
  budget: number,
  buildRequest: HierarchicalCompressionInput<unknown, TRequest>['buildRequest'],
  measureRequest: HierarchicalCompressionInput<unknown, TRequest>['measureRequest'],
  level: number,
): SummaryItem[] => {
  if (measureRequest(buildRequest([item], level)) <= budget) return [item];
  if (measureRequest(buildRequest([{ ...item, text: '' }], level)) > budget) {
    throw new Error('summary request overhead exceeds model budget');
  }

  const parts: SummaryItem[] = [];
  let offset = 0;

  while (offset < item.text.length) {
    let low = offset + 1;
    let high = item.text.length;
    let best = offset;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = { ...item, text: item.text.slice(offset, middle) };
      if (measureRequest(buildRequest([candidate], level)) <= budget) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (best === offset) throw new Error('summary request cannot fit one input character');
    parts.push({ ...item, text: item.text.slice(offset, best) });
    offset = best;
  }

  return parts;
};

const packRequests = <TRequest>(
  items: readonly SummaryItem[],
  budget: number,
  buildRequest: HierarchicalCompressionInput<unknown, TRequest>['buildRequest'],
  measureRequest: HierarchicalCompressionInput<unknown, TRequest>['measureRequest'],
  level: number,
): SummaryItem[][] => {
  const fitted = items.flatMap((item) =>
    splitToFit(item, budget, buildRequest, measureRequest, level),
  );
  const chunks: SummaryItem[][] = [];
  let current: SummaryItem[] = [];

  for (const item of fitted) {
    const next = [...current, item];
    if (current.length > 0 && measureRequest(buildRequest(next, level)) > budget) {
      chunks.push(current);
      current = [item];
    } else {
      current = next;
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
};

/**
 * Summarize candidates with the compression model's own request budget.
 * Original messages are returned untouched unless every hierarchy level succeeds.
 */
export const compressContextHierarchically = async <TMessage, TRequest>(
  input: HierarchicalCompressionInput<TMessage, TRequest>,
): Promise<HierarchicalCompressionResult<TMessage>> => {
  const before = input.measurePayload(input.messages);
  const candidates = new Set(input.candidateIds);
  const group: CompressionGroupTrace = {
    candidateIds: [...input.candidateIds],
    groupId: input.groupId,
    levels: 0,
    requestCount: 0,
    requestTokens: [],
    status: input.candidateIds.length === 0 ? 'skipped' : 'failed',
  };

  if (input.candidateIds.length === 0) {
    return {
      group,
      messages: [...input.messages],
      outcome: {
        afterTokens: before.tokens,
        attempt: 1,
        beforeTokens: before.tokens,
        code: 'NO_CANDIDATES',
        outcome: 'skipped',
        // The outcome identifies the attempted input; callers remeasure output before sending.
        payloadFingerprint: before.payloadFingerprint,
        trigger: input.trigger,
      },
    };
  }

  try {
    if (!Number.isFinite(input.summaryModelBudgetTokens) || input.summaryModelBudgetTokens <= 0) {
      throw new Error('invalid summary model budget');
    }

    let items = input.messages
      .map((message, index) => ({ id: input.getMessageId(message, index), message }))
      .filter(({ id }) => candidates.has(id))
      .map(({ id, message }) => ({ candidateIds: [id], text: input.renderMessage(message) }));

    if (items.length === 0) {
      return {
        group: { ...group, status: 'skipped' },
        messages: [...input.messages],
        outcome: {
          afterTokens: before.tokens,
          attempt: 1,
          beforeTokens: before.tokens,
          code: 'NO_CANDIDATES',
          outcome: 'skipped',
          payloadFingerprint: before.payloadFingerprint,
          trigger: input.trigger,
        },
      };
    }

    const maxLevels = input.maxLevels ?? 12;
    for (let level = 0; items.length > 1 || level === 0; level += 1) {
      if (level >= maxLevels) throw new Error('summary hierarchy did not converge');
      const chunks = packRequests(
        items,
        input.summaryModelBudgetTokens,
        input.buildRequest as HierarchicalCompressionInput<unknown, TRequest>['buildRequest'],
        input.measureRequest as HierarchicalCompressionInput<unknown, TRequest>['measureRequest'],
        level,
      );
      const summaries: SummaryItem[] = [];

      for (const chunk of chunks) {
        const request = input.buildRequest(chunk, level);
        const requestTokens = input.measureRequest(request);
        if (requestTokens > input.summaryModelBudgetTokens) {
          throw new Error('summary request exceeds model budget');
        }
        group.requestCount += 1;
        group.requestTokens.push(requestTokens);

        const text = await input.summarize(request);
        if (!text) throw new Error('summary model returned empty output');
        summaries.push({ candidateIds: unique(chunk.flatMap((item) => item.candidateIds)), text });
      }

      group.levels = level + 1;
      items = summaries;
    }

    const finalSummary = items[0];
    if (!finalSummary) throw new Error('summary hierarchy returned no output');
    const summaryMessage = input.createSummaryMessage(
      finalSummary.text,
      input.candidateIds,
      input.groupId,
    );
    const messages: TMessage[] = [];
    let inserted = false;

    input.messages.forEach((message, index) => {
      if (candidates.has(input.getMessageId(message, index))) {
        if (!inserted) {
          messages.push(summaryMessage);
          inserted = true;
        }
        return;
      }
      messages.push(message);
    });

    const after = input.measurePayload(messages);
    group.status = 'completed';
    return {
      group,
      messages,
      outcome: {
        afterTokens: after.tokens,
        attempt: 1,
        beforeTokens: before.tokens,
        outcome: 'compressed',
        payloadFingerprint: before.payloadFingerprint,
        trigger: input.trigger,
      },
    };
  } catch {
    group.failureCode = 'SUMMARY_FAILED';
    group.status = 'failed';
    return {
      group,
      messages: [...input.messages],
      outcome: {
        afterTokens: before.tokens,
        attempt: 1,
        beforeTokens: before.tokens,
        code: 'SUMMARY_FAILED',
        outcome: 'failed',
        payloadFingerprint: before.payloadFingerprint,
        trigger: input.trigger,
      },
    };
  }
};
