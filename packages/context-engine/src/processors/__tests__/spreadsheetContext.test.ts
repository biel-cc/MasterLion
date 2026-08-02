import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_DIRECT_SPREADSHEET_TOKENS,
  resolveDirectSpreadsheetTokenBudget,
} from '../spreadsheetContext';

describe('resolveDirectSpreadsheetTokenBudget', () => {
  it('uses the direct spreadsheet cap when the model window is unknown or large', () => {
    expect(resolveDirectSpreadsheetTokenBudget()).toBe(DEFAULT_MAX_DIRECT_SPREADSHEET_TOKENS);
    expect(resolveDirectSpreadsheetTokenBudget(128_000)).toBe(
      DEFAULT_MAX_DIRECT_SPREADSHEET_TOKENS,
    );
  });

  it('limits direct spreadsheet content to one quarter of smaller model windows', () => {
    expect(resolveDirectSpreadsheetTokenBudget(16_384)).toBe(4096);
    expect(resolveDirectSpreadsheetTokenBudget(8192)).toBe(2048);
  });
});
