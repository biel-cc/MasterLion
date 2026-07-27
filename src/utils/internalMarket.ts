const EXTERNAL_MARKET_HOSTS = new Set(['market.lobehub.com', 'registry.npmmirror.com']);

const validateInternalMarketUrl = (value: string, source: string): string => {
  const url = new URL(value);
  if (
    EXTERNAL_MARKET_HOSTS.has(url.hostname) &&
    process.env.MARKET_ALLOW_EXTERNAL_FALLBACK !== '1'
  ) {
    throw new Error(`External Market host is forbidden in internal mode: ${url.hostname}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${source} must use HTTP(S)`);
  return url.toString().replace(/\/$/, '');
};

export const getInternalMarketBaseUrl = (): string => {
  const value = process.env.MARKET_BASE_URL;
  if (!value) throw new Error('MARKET_BASE_URL is required; external Market fallback is disabled');
  return validateInternalMarketUrl(value, 'MARKET_BASE_URL');
};

export const getPublicInternalMarketBaseUrl = (): string => {
  const value =
    (typeof window === 'undefined' ? undefined : window.lobeEnv?.marketBaseUrl) ||
    process.env.NEXT_PUBLIC_MARKET_BASE_URL;
  if (!value)
    throw new Error(
      'NEXT_PUBLIC_MARKET_BASE_URL is required; external Market fallback is disabled',
    );
  return validateInternalMarketUrl(value, 'NEXT_PUBLIC_MARKET_BASE_URL');
};
