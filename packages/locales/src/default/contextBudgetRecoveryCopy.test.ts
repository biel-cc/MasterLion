import { describe, expect, it } from 'vitest';

import enUSError from '../../../../locales/en-US/error.json';
import zhCNError from '../../../../locales/zh-CN/error.json';
import error from './error';

/**
 * `contextBudget.actionFailed` is the feedback shown when a recovery action throws. The
 * `detach_attachments` and `truncate_tool_results` handlers rewrite messages *before*
 * regenerating the parent, so once the regeneration fails those rewrites are already
 * persisted. The copy must stay truthful about that instead of promising an untouched
 * conversation, and it must keep pointing the user at the next step.
 */
describe('contextBudget recovery error copy', () => {
  const bundles = {
    'canonical (en source)': error,
    'en-US': enUSError,
    'zh-CN': zhCNError,
  } as const;

  for (const [source, bundle] of Object.entries(bundles)) {
    it(`${source} actionFailed copy never claims the conversation is untouched`, () => {
      const copy = bundle['contextBudget.actionFailed'];

      expect(copy.length).toBeGreaterThan(0);
      // Over-promising an unchanged conversation was the pre-fix regression.
      expect(copy).not.toMatch(/nothing was changed|未发生变化|未做任何更改|未被改动/i);
    });

    it(`${source} actionFailed copy stays truthful about partial changes and actionable`, () => {
      const copy = bundle['contextBudget.actionFailed'];

      // The rewrite may already be applied; the user is told to review and retry.
      expect(copy).toMatch(/may already be applied|可能已经生效/);
      expect(copy).toMatch(/retry|重试/);
    });

    it(`${source} localizes the tool-result placeholder written into truncated messages`, () => {
      const placeholder = bundle['contextBudget.toolResultPlaceholder'];

      // The placeholder replaces tool output in the transcript, so it must be a non-empty,
      // self-describing bracketed note in the active language.
      expect(typeof placeholder).toBe('string');
      expect(placeholder.length).toBeGreaterThan(0);
      expect(placeholder).toMatch(/^\[.+\]$/);
    });
  }

  it('keeps en-US identical to the canonical English source', () => {
    expect(enUSError['contextBudget.actionFailed']).toBe(error['contextBudget.actionFailed']);
    expect(enUSError['contextBudget.toolResultPlaceholder']).toBe(
      error['contextBudget.toolResultPlaceholder'],
    );
  });

  it('zh-CN is hand-translated rather than mirroring the English copy', () => {
    expect(zhCNError['contextBudget.actionFailed']).not.toBe(error['contextBudget.actionFailed']);
    expect(zhCNError['contextBudget.toolResultPlaceholder']).not.toBe(
      error['contextBudget.toolResultPlaceholder'],
    );
    // Both strings are real Simplified Chinese, not leftover English placeholders.
    expect(zhCNError['contextBudget.actionFailed']).toMatch(/[\u4e00-\u9fff]/);
    expect(zhCNError['contextBudget.toolResultPlaceholder']).toMatch(/[\u4e00-\u9fff]/);
  });
});
