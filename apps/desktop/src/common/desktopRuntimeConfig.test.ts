import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DESKTOP_RUNTIME_CONFIG_FILENAME,
  loadDesktopRuntimeConfig,
  parseDesktopRuntimeConfig,
} from './desktopRuntimeConfig';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('desktop runtime config', () => {
  it('parses the production and Market URLs', () => {
    expect(
      parseDesktopRuntimeConfig(
        JSON.stringify({
          cloudServer: 'https://masterino.bielcrystal.com',
          cloudServerAliases: ['https://mlai-test.bielcrystal.com/'],
          marketBaseUrl: 'https://masterino.bielcrystal.com/market',
        }),
        'test-config.json',
      ),
    ).toEqual({
      cloudServer: 'https://masterino.bielcrystal.com',
      cloudServerAliases: ['https://mlai-test.bielcrystal.com'],
      marketBaseUrl: 'https://masterino.bielcrystal.com/market',
      sourcePath: 'test-config.json',
    });
  });

  it('loads a sidecar file next to the executable before packaged resources', () => {
    const directory = mkdtempSync(join(tmpdir(), 'masterion-desktop-config-'));
    temporaryDirectories.push(directory);
    const configPath = join(directory, DESKTOP_RUNTIME_CONFIG_FILENAME);
    writeFileSync(
      configPath,
      JSON.stringify({ cloudServer: 'https://desktop-sidecar.example.com' }),
      'utf8',
    );

    expect(
      loadDesktopRuntimeConfig({
        cwd: join(directory, 'cwd'),
        execPath: join(directory, 'Masterino.exe'),
        resourcesPath: join(directory, 'resources'),
      }),
    ).toMatchObject({
      cloudServer: 'https://desktop-sidecar.example.com',
      cloudServerAliases: [],
      marketBaseUrl: 'https://desktop-sidecar.example.com/market',
      sourcePath: configPath,
    });
  });

  it('reports every checked location when the sidecar file is missing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'masterion-desktop-config-missing-'));
    temporaryDirectories.push(directory);

    expect(() =>
      loadDesktopRuntimeConfig({
        cwd: join(directory, 'cwd'),
        execPath: join(directory, 'Masterino.exe'),
        resourcesPath: join(directory, 'resources'),
      }),
    ).toThrow(`${DESKTOP_RUNTIME_CONFIG_FILENAME} was not found`);
  });
});
