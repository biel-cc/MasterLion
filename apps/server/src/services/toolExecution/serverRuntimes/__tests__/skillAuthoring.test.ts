// @vitest-environment node
import { SkillAuthoringIdentifier } from '@lobechat/builtin-tool-skill-authoring';
import { builtinTools, defaultToolIds } from '@lobechat/builtin-tools';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerRuntimeIdentifiers } from '..';
import { skillAuthoringRuntime } from '../skillAuthoring';

const mocks = vi.hoisted(() => ({
  executeProjectSkillRpc: vi.fn(),
  importFromZipBuffer: vi.fn(),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { executeProjectSkillRpc: mocks.executeProjectSkillRpc },
}));

vi.mock('@/server/services/skill/importer', () => ({
  SkillImporter: vi.fn(() => ({ importFromZipBuffer: mocks.importFromZipBuffer })),
}));

const validation = {
  errors: [],
  files: ['SKILL.md'],
  manifest: { description: 'Release safely', name: 'release-check' },
  totalBytes: 100,
  valid: true,
};

describe('skillAuthoringRuntime production registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeProjectSkillRpc.mockImplementation(async ({ method }) => {
      if (method === 'packProjectSkill') {
        return { archiveBase64: Buffer.from('zip').toString('base64') };
      }
      return validation;
    });
    mocks.importFromZipBuffer.mockResolvedValue({ skill: { id: 'user-skill' }, status: 'created' });
  });

  it('is exposed by both the builtin tool catalog and the server runtime registry', () => {
    expect(defaultToolIds).toContain(SkillAuthoringIdentifier);
    expect(builtinTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: SkillAuthoringIdentifier, type: 'builtin' }),
      ]),
    );
    expect(getServerRuntimeIdentifiers()).toContain(SkillAuthoringIdentifier);
  });

  it('routes project writes through the frozen device workspace and validates them', async () => {
    const runtime = await skillAuthoringRuntime.factory({
      executionContext: {
        cwd: '/repo',
        plan: { deviceId: 'device-1', kind: 'device', target: 'device' },
        version: 1,
        workspace: {
          deviceId: 'device-1',
          id: 'workspace-1',
          kind: 'device',
          rootPath: '/repo',
        },
      },
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    await expect(
      runtime.createProjectSkill({
        content: '---\nname: release-check\ndescription: Release safely\n---\nbody',
        name: 'release-check',
      }),
    ).resolves.toMatchObject({ success: true });
    expect(mocks.executeProjectSkillRpc).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        deviceId: 'device-1',
        input: expect.objectContaining({ name: 'release-check', scope: '/repo' }),
        method: 'createProjectSkill',
        userId: 'user-1',
      }),
    );
    expect(mocks.executeProjectSkillRpc).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ method: 'validateProjectSkill' }),
    );
  });

  it('fails closed outside a routed device workspace', async () => {
    const runtime = await skillAuthoringRuntime.factory({
      executionContext: { plan: { kind: 'sandbox', target: 'sandbox' }, version: 1 },
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    await expect(runtime.validateProjectSkill({ name: 'release-check' })).resolves.toMatchObject({
      content: expect.stringContaining('WORKSPACE_REQUIRED'),
      success: false,
    });
    expect(mocks.executeProjectSkillRpc).not.toHaveBeenCalled();
  });

  it('packs on the device and imports the archive into the personal skill library', async () => {
    const runtime = await skillAuthoringRuntime.factory({
      executionContext: {
        cwd: '/repo',
        plan: { deviceId: 'device-1', kind: 'device', target: 'device' },
        version: 1,
      },
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    await expect(runtime.promoteProjectSkill({ name: 'release-check' })).resolves.toMatchObject({
      success: true,
    });
    expect(mocks.executeProjectSkillRpc).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'packProjectSkill' }),
    );
    expect(mocks.importFromZipBuffer).toHaveBeenCalledWith(Uint8Array.from(Buffer.from('zip')));
  });
});
