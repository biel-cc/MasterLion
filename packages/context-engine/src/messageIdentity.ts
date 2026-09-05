/** Remove internal compression identity at the model-provider boundary. */
export const stripContextMessageIdentity = <T extends object>(messages: readonly T[]) =>
  messages.map((message) => {
    const {
      id: _id,
      metadata: _metadata,
      pinned: _pinned,
      ...providerMessage
    } = message as T & { id?: unknown; metadata?: unknown; pinned?: unknown };
    return providerMessage;
  });
