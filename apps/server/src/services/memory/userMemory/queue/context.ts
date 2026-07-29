export interface MemoryQueueContext<T> {
  requestPayload: T;
  run: <R>(stepName: string, callback: () => Promise<R> | R) => Promise<R>;
}

export const createMemoryQueueContext = <T>(requestPayload: T): MemoryQueueContext<T> => ({
  requestPayload,
  run: async (_stepName, callback) => callback(),
});
