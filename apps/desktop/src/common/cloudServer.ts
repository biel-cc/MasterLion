const normalizeHttpUrl = (value: string, field: string) => {
  const normalized = value.trim().replace(/\/$/, '');
  const url = new URL(normalized);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${field} must use HTTP(S)`);
  }

  return normalized;
};

export const resolveDesktopCloudServer = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('desktop-config.json must define a non-empty cloudServer');
  }

  const cloudServer = normalizeHttpUrl(value, 'cloudServer');
  const url = new URL(cloudServer);

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('cloudServer must be an origin without a path, query, or hash');
  }

  return url.origin;
};

export const resolveDesktopMarketBaseUrl = (value: unknown, cloudServer: string) => {
  if (typeof value !== 'string' || !value.trim()) return `${cloudServer}/market`;

  return normalizeHttpUrl(value, 'marketBaseUrl');
};
