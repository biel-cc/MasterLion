import semver from 'semver';

interface ManualUpdateDownloadUrlOptions {
  arch: NodeJS.Architecture;
  channel: string;
  platform: NodeJS.Platform;
  updateServerUrl?: string;
  version: string;
}

const STATIC_ASSET_PATH_PREFIXES = ['/assets/', '/_next/', '/static/'];

const isRootStaticFile = (pathname: string) => {
  const basename = pathname.slice(1);
  return pathname.startsWith('/') && !basename.includes('/') && basename.includes('.');
};

const isStaticAssetPath = (pathname: string) =>
  isRootStaticFile(pathname) ||
  STATIC_ASSET_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/**
 * Determine if application update is needed rather than just renderer update
 * @param currentVersion Current version
 * @param nextVersion New version
 * @returns Whether application update is needed
 */
export const shouldUpdateApp = (currentVersion: string, nextVersion: string): boolean => {
  // If version contains .app suffix, force application update
  if (nextVersion.includes('.app')) {
    return true;
  }

  try {
    // Parse version number
    const current = semver.parse(currentVersion);
    const next = semver.parse(nextVersion);

    if (!current || !next) return true;

    // Application update needed when major or minor version changes
    if (current.major !== next.major || current.minor !== next.minor) {
      return true;
    }

    // For patch version changes only, prioritize renderer hot update
    return false;
  } catch {
    // Default to application update when parsing fails
    return true;
  }
};

/**
 * Resolve the public installer URL used by unsigned builds.
 * The file names must stay aligned with electron-builder.mjs.
 */
export const getManualUpdateDownloadUrl = ({
  arch,
  channel,
  platform,
  updateServerUrl,
  version,
}: ManualUpdateDownloadUrlOptions): string | undefined => {
  if (!updateServerUrl) return undefined;

  const baseUrl = updateServerUrl.replace(/\/(stable|nightly|canary|beta)\/?$/, '');
  const artifactName =
    platform === 'win32'
      ? `Masterino-${version}-setup.exe`
      : platform === 'darwin' && (arch === 'arm64' || arch === 'x64')
        ? `Masterino-${version}-${arch}.dmg`
        : undefined;

  if (!artifactName) return undefined;

  return `${baseUrl}/${channel}/${version}/${artifactName}`;
};

/**
 * Extract a restorable SPA route (`pathname + search`) from a renderer window URL.
 * Returns `null` when the URL is not a restorable route — splash/error pages
 * (`file:` protocol), known static asset paths, or the root route (identical
 * to the default, nothing worth restoring).
 */
export const extractRestoreRoute = (rawUrl: string): string | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol === 'file:') return null;
  if (isStaticAssetPath(url.pathname)) return null;

  // `lng` is re-appended by Browser.buildUrlWithLocale on the next load
  url.searchParams.delete('lng');

  const route = `${url.pathname}${url.search}`;
  if (route === '/' || route === '') return null;

  return route;
};
