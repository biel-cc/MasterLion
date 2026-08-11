export interface NormalizedMarketAuthor {
  avatar?: string;
  name: string;
  ownerType?: 'organization' | 'user';
  userName?: string;
}

export const normalizeMarketAuthor = (author: unknown): NormalizedMarketAuthor => {
  if (typeof author === 'string') return { name: author.trim() || 'Masterino' };
  if (!author || typeof author !== 'object') return { name: 'Masterino' };

  const value = author as Record<string, unknown>;
  const name = typeof value.name === 'string' ? value.name.trim() : '';

  return {
    avatar: typeof value.avatar === 'string' ? value.avatar : undefined,
    name: name || 'Masterino',
    ownerType: value.type === 'organization' ? 'organization' : 'user',
    userName: typeof value.userName === 'string' ? value.userName : undefined,
  };
};

type NormalizedMarketListItem<T> = T & {
  author: string;
  authorAvatar?: string;
  userName?: string;
};

type MarketListItem<T> = T extends { items?: (infer TItem)[] } ? TItem : never;

export const normalizeMarketListAuthors = <TResponse extends { items?: object[] }>(
  response: TResponse,
): Omit<TResponse, 'items'> & {
  items: NormalizedMarketListItem<MarketListItem<TResponse>>[];
} => {
  const items = (response.items || []).map((item) => {
    const value = item as MarketListItem<TResponse> & { author?: unknown; userName?: unknown };
    const author = normalizeMarketAuthor(value.author);

    return {
      ...item,
      author: author.name,
      authorAvatar: author.avatar,
      userName: typeof value.userName === 'string' ? value.userName : author.userName,
    };
  }) as NormalizedMarketListItem<MarketListItem<TResponse>>[];

  return { ...response, items };
};
