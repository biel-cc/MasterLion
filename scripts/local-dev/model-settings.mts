const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function refreshedDefaultAgent(value: unknown, chat: { model: string; provider: string }) {
  const current = record(value);
  return { ...current, config: { ...record(current.config), ...chat } };
}
