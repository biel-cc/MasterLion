import type { ChatFileItem } from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';

export const DEFAULT_MAX_DIRECT_SPREADSHEET_TOKENS = 20_000;

const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const SPREADSHEET_EXTENSIONS = ['.xls', '.xlsx'];

export interface SpreadsheetContextOptions {
  analysisToolEnabled?: boolean;
  maxDirectTokens?: number;
}

export const resolveDirectSpreadsheetTokenBudget = (contextWindowTokens?: number) => {
  if (!contextWindowTokens || contextWindowTokens <= 0) {
    return DEFAULT_MAX_DIRECT_SPREADSHEET_TOKENS;
  }

  return Math.max(
    1,
    Math.min(DEFAULT_MAX_DIRECT_SPREADSHEET_TOKENS, Math.floor(contextWindowTokens * 0.25)),
  );
};

const isSpreadsheet = (file: ChatFileItem) => {
  const mimeType = file.fileType?.toLowerCase() || '';
  const filename = file.name?.toLowerCase() || '';

  return (
    SPREADSHEET_MIME_TYPES.has(mimeType) ||
    SPREADSHEET_EXTENSIONS.some((extension) => filename.endsWith(extension))
  );
};

const extractSheetNames = (content: string): string[] => {
  const names = new Set<string>();
  const pattern = /<sheet\s+name="([^"]*)"/g;

  for (const match of content.matchAll(pattern)) {
    if (match[1]) names.add(match[1]);
  }

  return [...names];
};

const escapeXmlAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const buildDeferredSpreadsheetContent = (
  file: ChatFileItem,
  estimatedTokens: number,
  analysisToolEnabled: boolean,
) => {
  const sheetNames = extractSheetNames(file.content || '');
  const sheets = escapeXmlAttribute(sheetNames.length > 0 ? sheetNames.join(', ') : 'unknown');

  if (analysisToolEnabled) {
    return `<spreadsheet_context mode="sandbox-analysis" estimatedTokens="${estimatedTokens}" sheets="${sheets}">
The complete spreadsheet is intentionally omitted from the model context because it is too large for reliable direct analysis.
The original workbook is available in the enabled Cloud Sandbox under /mnt/data using its uploaded filename.
Use the Cloud Sandbox with Python pandas or openpyxl to inspect and analyze the complete workbook. Base totals, statistics, and conclusions on the full workbook, not on a truncated preview.
</spreadsheet_context>`;
  }

  return `<spreadsheet_context mode="analysis-required" estimatedTokens="${estimatedTokens}" sheets="${sheets}">
The complete spreadsheet is intentionally omitted from the model context because it is too large for reliable direct analysis.
No spreadsheet analysis tool is enabled for this conversation. Tell the user to enable Cloud Sandbox/data analysis, select a smaller worksheet or range, or attach a reduced workbook. Do not claim to have analyzed the complete workbook.
</spreadsheet_context>`;
};

/**
 * Prevent a parsed workbook from being embedded wholesale in the provider
 * request. Small spreadsheets preserve the existing direct-context behavior;
 * large spreadsheets become a tool-backed reference (or an actionable notice
 * when no analysis tool is available).
 */
export const prepareSpreadsheetFileContext = (
  fileList: ChatFileItem[],
  options: SpreadsheetContextOptions = {},
): ChatFileItem[] => {
  const maxDirectTokens = options.maxDirectTokens ?? DEFAULT_MAX_DIRECT_SPREADSHEET_TOKENS;

  return fileList.map((file) => {
    if (!isSpreadsheet(file) || !file.content) return file;

    const estimatedTokens = estimateTokenCount(file.content);
    if (estimatedTokens <= maxDirectTokens) return file;

    return {
      ...file,
      content: buildDeferredSpreadsheetContent(
        file,
        estimatedTokens,
        options.analysisToolEnabled === true,
      ),
    };
  });
};
