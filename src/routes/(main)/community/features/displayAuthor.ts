export const displayAuthor = (author: unknown): string => {
  if (typeof author === 'string') return author.trim() || 'Masterino';
  if (!author || typeof author !== 'object') return 'Masterino';

  const name = (author as Record<string, unknown>).name;
  return typeof name === 'string' && name.trim() ? name : 'Masterino';
};
