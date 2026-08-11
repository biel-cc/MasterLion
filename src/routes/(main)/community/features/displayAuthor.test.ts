import { describe, expect, it } from 'vitest';

import { displayAuthor } from './displayAuthor';

describe('displayAuthor', () => {
  it.each([
    ['Alice', 'Alice'],
    [{ avatar: '/a.png', name: 'Alice' }, 'Alice'],
    [null, 'Masterino'],
    [{ name: { nested: true } }, 'Masterino'],
    [{ avatar: '/a.png' }, 'Masterino'],
  ])('turns %o into render-safe text', (author, expected) => {
    expect(displayAuthor(author)).toBe(expected);
  });
});
