const PRODUCTION_GATEWAY_URL = 'https://masterino.bielcrystal.com/device-gateway';

const LEGACY_DEFAULT_GATEWAY_URLS = new Set([
  'https://aihub.bielcrystal.com',
  'https://masterino.bielcrystal.com',
]);

export const DEFAULT_GATEWAY_URL = PRODUCTION_GATEWAY_URL;

export const resolveGatewayUrl = ({
  envUrl,
  storedUrl,
}: {
  envUrl?: string;
  storedUrl?: string;
}) => {
  if (envUrl) return envUrl;
  if (storedUrl && !LEGACY_DEFAULT_GATEWAY_URLS.has(storedUrl)) return storedUrl;

  return DEFAULT_GATEWAY_URL;
};
