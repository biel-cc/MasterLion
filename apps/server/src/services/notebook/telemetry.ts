import { metrics } from '@lobechat/observability-otel/api';

const meter = metrics.getMeter('server-services-notebook');

const summaryDuration = meter.createHistogram('notebook.document_summary.duration', {
  description: 'Duration of a topic document summary read.',
  unit: 'ms',
});
const summaryPayloadBytes = meter.createHistogram('notebook.document_summary.payload_bytes', {
  description: 'Serialized size of a topic document summary result.',
  unit: 'By',
});
const summaryRowCount = meter.createHistogram('notebook.document_summary.row_count', {
  description: 'Number of rows returned by a topic document summary read.',
  unit: '{row}',
});
const summaryErrorCount = meter.createCounter('notebook.document_summary.error_total', {
  description: 'Failed topic document summary reads by stable error category.',
  unit: '{error}',
});

type NotebookSummaryInterface = 'canonical' | 'legacy';

/** Record only bounded summary values; never pass document content here. */
export const recordNotebookSummaryRead = (
  interfaceName: NotebookSummaryInterface,
  startedAt: number,
  documents: unknown[],
) => {
  const attributes = { 'notebook.interface': interfaceName };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(documents)).byteLength;

  summaryDuration.record(Date.now() - startedAt, attributes);
  summaryPayloadBytes.record(payloadBytes, attributes);
  summaryRowCount.record(documents.length, attributes);
};

export const recordNotebookSummaryReadError = (
  interfaceName: NotebookSummaryInterface,
  error: unknown,
) => {
  const value = typeof error === 'object' && error !== null ? (error as Record<string, any>) : {};
  const cause =
    typeof value.cause === 'object' && value.cause !== null
      ? (value.cause as Record<string, any>)
      : {};
  const errorCode =
    cause.data?.reason === 'DATABASE_RECOVERING'
      ? 'DATABASE_RECOVERING'
      : value.code === 'SERVICE_UNAVAILABLE'
        ? 'SERVICE_UNAVAILABLE'
        : 'OTHER';

  summaryErrorCount.add(1, {
    'error.code': errorCode,
    'notebook.interface': interfaceName,
  });
};
