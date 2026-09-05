import type { LocalConfig } from './config.mjs';

/** Explicit, quota-consuming checks; never run silently at every startup. */
export async function checkModels({ c }: LocalConfig) {
  if (!c.AIHUB_API_KEY) throw new Error('Configure AIHUB_API_KEY in .local-dev/config.env first.');
  const request = async (endpoint: string, body: unknown) =>
    fetch(`${c.AIHUB_BASE_URL.replace(/\/$/, '')}/${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${c.AIHUB_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  const chat = await request('chat/completions', {
    model: c.CHAT_MODEL,
    messages: [{ role: 'user', content: 'Reply with OK only.' }],
    max_tokens: 32,
  });
  const embedding = await request('embeddings', {
    model: c.EMBEDDING_MODEL,
    input: 'Masterino isolated development verification',
    dimensions: 2048,
  });
  const data = await embedding.json();
  const report = {
    chat: { model: c.CHAT_MODEL, status: chat.status },
    embedding: {
      model: c.EMBEDDING_MODEL,
      status: embedding.status,
      dimensions: data.data?.[0]?.embedding?.length,
    },
  };
  if (!chat.ok || !embedding.ok || report.embedding.dimensions !== 2048)
    throw new Error(
      `Model verification failed: chat=${chat.status}, embedding=${embedding.status}, dimensions=${report.embedding.dimensions ?? 'missing'}. Check local model permissions.`,
    );
  return report;
}
