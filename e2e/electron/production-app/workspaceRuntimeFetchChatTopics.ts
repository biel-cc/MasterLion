/**
 * Production Electron E2E data boundary. Topic rows are seeded into the real
 * chat store by the renderer fixture, while the product Topic/TopicList stack
 * remains mounted and owns all navigation rendering.
 */
export const useFetchChatTopics = () => ({ isRevalidating: false });
