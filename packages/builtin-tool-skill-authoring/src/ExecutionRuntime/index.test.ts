import { describe, expect, it, vi } from 'vitest';

import {
  SkillAuthoringExecutionRuntime,
  type SkillAuthoringRuntimeService,
} from './index';

const valid = {
  errors: [],
  files: ['SKILL.md'],
  manifest: { description: 'Writes releases', name: 'release-writer' },
  totalBytes: 100,
  valid: true,
};

const service = (): SkillAuthoringRuntimeService => ({
  create: vi.fn(async () => valid),
  delete: vi.fn(async () => {}),
  pack: vi.fn(async () => new Uint8Array([80, 75])),
  promoteToUser: vi.fn(async () => ({ id: 'user-1' })),
  rename: vi.fn(async () => valid),
  update: vi.fn(async () => valid),
  validate: vi.fn(async () => valid),
});

describe('SkillAuthoringExecutionRuntime', () => {
  it('validates after create, update, and rename writes', async () => {
    const adapter = service();
    const runtime = new SkillAuthoringExecutionRuntime(adapter);

    await expect(
      runtime.createProjectSkill({ content: '# skill', name: 'release-writer' }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      runtime.updateProjectSkill({
        content: '# reference',
        name: 'release-writer',
        path: 'references/style.md',
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      runtime.renameProjectSkill({ name: 'old-name', newName: 'release-writer' }),
    ).resolves.toMatchObject({ success: true });

    expect(adapter.validate).toHaveBeenCalledTimes(3);
    expect(adapter.validate).toHaveBeenLastCalledWith('release-writer');
  });

  it('does not pack or promote an invalid skill', async () => {
    const adapter = service();
    vi.mocked(adapter.validate).mockResolvedValue({
      ...valid,
      errors: ['description is required'],
      valid: false,
    });
    const runtime = new SkillAuthoringExecutionRuntime(adapter);

    await expect(runtime.packProjectSkill({ name: 'release-writer' })).resolves.toMatchObject({
      success: false,
    });
    await expect(runtime.promoteProjectSkill({ name: 'release-writer' })).resolves.toMatchObject({
      success: false,
    });
    expect(adapter.pack).not.toHaveBeenCalled();
    expect(adapter.promoteToUser).not.toHaveBeenCalled();
  });

  it('validates then promotes a project skill to personal scope', async () => {
    const adapter = service();
    const runtime = new SkillAuthoringExecutionRuntime(adapter);

    const result = await runtime.promoteProjectSkill({ name: 'release-writer' });

    expect(adapter.validate).toHaveBeenCalledWith('release-writer');
    expect(adapter.promoteToUser).toHaveBeenCalledWith('release-writer');
    expect(result).toMatchObject({
      state: { promoted: { id: 'user-1' } },
      success: true,
    });
  });
});
