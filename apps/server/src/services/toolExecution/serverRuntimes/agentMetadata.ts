import { assertConfigurableAgentExecutionEnv } from '@/server/services/executionEnv/validation';

const AGENT_METADATA_FIELDS = new Set([
  'avatar',
  'backgroundColor',
  'description',
  'tags',
  'title',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate and copy the only columns an agent-facing metadata tool may write. */
export const parseAgentMetadataUpdate = (value: unknown): Record<string, unknown> => {
  // Inspect the raw payload first so reserved env keys cannot hide behind a
  // config-shaped property that would otherwise be discarded by the picker.
  assertConfigurableAgentExecutionEnv(value);

  if (!isRecord(value)) throw new Error('Agent metadata must be an object');

  const unknownFields = Object.keys(value).filter((field) => !AGENT_METADATA_FIELDS.has(field));
  if (unknownFields.length > 0) {
    throw new Error(`Unsupported agent metadata fields: ${unknownFields.sort().join(', ')}`);
  }

  const result: Record<string, unknown> = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    if (field === 'tags') {
      if (!Array.isArray(fieldValue) || fieldValue.some((tag) => typeof tag !== 'string')) {
        throw new Error('Agent metadata field tags must be an array of strings');
      }
    } else if (typeof fieldValue !== 'string') {
      throw new Error(`Agent metadata field ${field} must be a string`);
    }
    result[field] = fieldValue;
  }

  return result;
};
