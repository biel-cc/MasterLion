import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { resolveDesktopCloudServer, resolveDesktopMarketBaseUrl } from './cloudServer';

export const DESKTOP_RUNTIME_CONFIG_FILENAME = 'desktop-config.json';

export interface DesktopRuntimeConfig {
  cloudServer: string;
  cloudServerAliases: string[];
  marketBaseUrl: string;
  sourcePath: string;
}

export interface DesktopRuntimeConfigLoadOptions {
  configPath?: string;
  cwd?: string;
  execPath?: string;
  resourcesPath?: string;
}

interface DesktopRuntimeConfigFile {
  cloudServer?: unknown;
  cloudServerAliases?: unknown;
  marketBaseUrl?: unknown;
}

const unique = (values: Array<string | undefined>) => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
];

export const getDesktopRuntimeConfigCandidates = ({
  configPath = process.env.MASTERION_DESKTOP_CONFIG,
  cwd = process.cwd(),
  execPath = process.execPath,
  resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
}: DesktopRuntimeConfigLoadOptions = {}) =>
  unique([
    configPath ? resolve(configPath) : undefined,
    execPath ? join(dirname(execPath), DESKTOP_RUNTIME_CONFIG_FILENAME) : undefined,
    resourcesPath ? join(resourcesPath, DESKTOP_RUNTIME_CONFIG_FILENAME) : undefined,
    cwd ? join(cwd, 'resources', DESKTOP_RUNTIME_CONFIG_FILENAME) : undefined,
    cwd ? join(cwd, 'apps', 'desktop', 'resources', DESKTOP_RUNTIME_CONFIG_FILENAME) : undefined,
  ]);

export const parseDesktopRuntimeConfig = (
  content: string,
  sourcePath = DESKTOP_RUNTIME_CONFIG_FILENAME,
): DesktopRuntimeConfig => {
  let config: DesktopRuntimeConfigFile;

  try {
    config = JSON.parse(content) as DesktopRuntimeConfigFile;
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const cloudServer = resolveDesktopCloudServer(config.cloudServer);
  if (config.cloudServerAliases !== undefined && !Array.isArray(config.cloudServerAliases)) {
    throw new Error(`cloudServerAliases in ${sourcePath} must be an array`);
  }

  const cloudServerAliases = [
    ...new Set(
      (config.cloudServerAliases ?? [])
        .map((value) => resolveDesktopCloudServer(value))
        .filter((value) => value !== cloudServer),
    ),
  ];
  const marketBaseUrl = resolveDesktopMarketBaseUrl(config.marketBaseUrl, cloudServer);

  return { cloudServer, cloudServerAliases, marketBaseUrl, sourcePath };
};

export const loadDesktopRuntimeConfig = (
  options: DesktopRuntimeConfigLoadOptions = {},
): DesktopRuntimeConfig => {
  const candidates = getDesktopRuntimeConfigCandidates(options);
  const sourcePath = candidates.find((candidate) => existsSync(candidate));

  if (!sourcePath) {
    throw new Error(
      `${DESKTOP_RUNTIME_CONFIG_FILENAME} was not found. Checked: ${candidates.join(', ')}`,
    );
  }

  return parseDesktopRuntimeConfig(readFileSync(sourcePath, 'utf8'), sourcePath);
};
