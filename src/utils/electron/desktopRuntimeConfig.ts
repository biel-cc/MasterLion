const normalizeRuntimeUrl = (value: string | undefined, field: string) => {
  const normalized = value?.trim().replace(/\/$/, '');
  if (!normalized) {
    throw new Error(
      `${field} is missing from desktop-config.json; restart Masterino after updating the file`,
    );
  }

  const url = new URL(normalized);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${field} in desktop-config.json must use HTTP(S)`);
  }

  return normalized;
};

export const getDesktopCloudServer = () =>
  normalizeRuntimeUrl(
    typeof window === 'undefined' ? undefined : window.lobeEnv?.cloudServer,
    'cloudServer',
  );

export const getDesktopCloudServerAliases = () => {
  const aliases = typeof window === 'undefined' ? undefined : window.lobeEnv?.cloudServerAliases;

  if (!aliases) return [];
  if (!Array.isArray(aliases)) {
    throw new Error('cloudServerAliases in desktop-config.json must be an array');
  }

  return aliases.map((value) => normalizeRuntimeUrl(value, 'cloudServerAliases'));
};

export const getDesktopMarketBaseUrl = () => {
  const runtimeMarketBaseUrl =
    typeof window === 'undefined' ? undefined : window.lobeEnv?.marketBaseUrl;

  return normalizeRuntimeUrl(
    runtimeMarketBaseUrl || `${getDesktopCloudServer()}/market`,
    'marketBaseUrl',
  );
};
