import { describe, expect, it } from 'vitest';

import { normalizeMarketAuthor, normalizeMarketListAuthors } from './normalizeAuthor';

describe('normalizeMarketAuthor', () => {
  it('keeps string authors', () => {
    expect(normalizeMarketAuthor('Alice')).toEqual({ name: 'Alice' });
  });

  it('flattens Market author objects and preserves the avatar separately', () => {
    expect(
      normalizeMarketListAuthors({
        items: [{ author: { avatar: 'https://img.example/a.png', name: 'Alice' }, id: 1 }],
      }),
    ).toEqual({
      items: [
        {
          author: 'Alice',
          authorAvatar: 'https://img.example/a.png',
          id: 1,
          userName: undefined,
        },
      ],
    });
  });

  it.each([undefined, null, 42, [], {}, { avatar: 7 }, { name: { nested: true } }])(
    'falls back for malformed author value %#',
    (author) => {
      expect(normalizeMarketAuthor(author).name).toBe('Masterino');
    },
  );
});
