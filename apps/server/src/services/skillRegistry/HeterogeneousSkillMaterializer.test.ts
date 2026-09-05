// @vitest-environment node
import type { SkillRegistryResult } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import {
  HeterogeneousSkillMaterializer,
  type SkillMaterializationFsAdapter,
} from './HeterogeneousSkillMaterializer';

class MemoryMaterializationFs implements SkillMaterializationFsAdapter {
  directories = new Set<string>();
  files = new Map<string, string | Uint8Array>();
  mtimes = new Map<string, number>();
  operationCount = 0;
  removeCount = 0;
  symlinks = new Set<string>();
  writeCount = 0;

  lstat = async (path: string) => {
    this.operationCount += 1;
    if (this.symlinks.has(path)) return { isDirectory: false, isSymbolicLink: true };
    if (this.directories.has(path)) return { isDirectory: true, isSymbolicLink: false };
    if (this.files.has(path)) return { isDirectory: false, isSymbolicLink: false };
    return undefined;
  };
  mkdir = async (path: string) => {
    this.operationCount += 1;
    this.directories.add(path);
  };
  readFile = async (path: string) => {
    this.operationCount += 1;
    return this.files.get(path);
  };
  removeDirectory = async (path: string) => {
    this.operationCount += 1;
    this.removeCount += 1;
    this.directories.delete(path);
    for (const file of this.files.keys()) {
      if (file.startsWith(path + '/')) this.files.delete(file);
    }
  };
  writeFile = async (path: string, content: string | Uint8Array) => {
    this.operationCount += 1;
    this.files.set(path, content);
    this.mtimes.set(path, Date.now() + this.writeCount);
    this.writeCount += 1;
  };
}

const registry = (
  mode: 'off' | 'project' | 'user',
  skills: SkillRegistryResult['skills'] = [
    {
      content: '# Deploy\n\nDeploy safely.',
      description: 'Deploy safely',
      identifier: 'deploy',
      key: 'user:deploy',
      name: 'deploy',
      ownerId: 'user-1',
      scope: 'personal',
      source: 'user',
    },
  ],
): SkillRegistryResult => ({
  entries: [],
  errors: [],
  policy: {
    includeAgentSkills: true,
    includeProjectSkills: true,
    includeUserSkills: true,
    materializeForHeteroCli: mode,
    pinned: [],
  },
  precedence: { agent: 200, builtin: 100, project: 400, user: 300, workspace: 350 },
  skills,
});

describe('HeterogeneousSkillMaterializer', () => {
  it('is off by default policy and performs no filesystem operations', async () => {
    const fs = new MemoryMaterializationFs();
    const result = await new HeterogeneousSkillMaterializer(fs).materialize({
      cli: 'claude-code',
      registry: registry('off'),
      workspaceRoot: '/repo',
    });

    expect(result).toMatchObject({ mode: 'off', reason: 'disabled', status: 'skipped' });
    expect(fs.operationCount).toBe(0);
    expect(fs.writeCount).toBe(0);
    expect(fs.removeCount).toBe(0);
  });

  it('materializes only Masterino-prefixed Claude Code skills with a narrow git exclude', async () => {
    const fs = new MemoryMaterializationFs();
    const result = await new HeterogeneousSkillMaterializer(fs).materialize({
      cli: 'claude-code',
      registry: registry('project'),
      workspaceRoot: '/repo',
    });

    expect(result).toMatchObject({
      mode: 'project',
      status: 'materialized',
      targetRoot: '/repo/.claude/skills',
    });
    expect(fs.files.get('/repo/.claude/skills/masterino-deploy/SKILL.md')).toContain(
      'name: "deploy"',
    );
    expect(fs.files.get('/repo/.claude/skills/deploy/SKILL.md')).toBeUndefined();
    expect(fs.files.get('/repo/.claude/skills/.masterino-owned-skills.json')).toContain(
      '"masterino-deploy": "user:deploy"',
    );
    expect(fs.files.get('/repo/.git/info/exclude')).toBe(
      '/.claude/skills/masterino-*/\n',
    );
  });

  it('keeps mtime stable when materialized content and ownership are unchanged', async () => {
    const fs = new MemoryMaterializationFs();
    const materializer = new HeterogeneousSkillMaterializer(fs);
    const options = {
      cli: 'claude-code' as const,
      registry: registry('project'),
      workspaceRoot: '/repo',
    };
    await materializer.materialize(options);
    const originalMtimes = new Map(fs.mtimes);
    const originalWrites = fs.writeCount;

    const result = await materializer.materialize(options);

    expect(result.status).toBe('unchanged');
    expect(fs.writeCount).toBe(originalWrites);
    expect(fs.mtimes).toEqual(originalMtimes);
  });

  it('fails closed instead of replacing a foreign same-name directory', async () => {
    const fs = new MemoryMaterializationFs();
    fs.directories.add('/repo/.claude/skills/masterino-deploy');
    fs.files.set(
      '/repo/.claude/skills/masterino-deploy/SKILL.md',
      '# Foreign\n\nKeep this content.',
    );
    const result = await new HeterogeneousSkillMaterializer(fs).materialize({
      cli: 'claude-code',
      registry: registry('project'),
      workspaceRoot: '/repo',
    });

    expect(result).toMatchObject({ status: 'unchanged', writes: [], removals: [] });
    expect(result.errors).toEqual([
      expect.objectContaining({
        key: 'user:deploy',
        message: expect.stringContaining('foreign skill directory'),
      }),
    ]);
    expect(fs.files.get('/repo/.claude/skills/masterino-deploy/SKILL.md')).toContain('Foreign');
    expect(fs.removeCount).toBe(0);
    expect(fs.writeCount).toBe(0);
  });

  it('removes stale directories only when the ownership manifest recorded them', async () => {
    const fs = new MemoryMaterializationFs();
    const materializer = new HeterogeneousSkillMaterializer(fs);
    await materializer.materialize({
      cli: 'claude-code',
      registry: registry('project'),
      workspaceRoot: '/repo',
    });
    fs.directories.add('/repo/.claude/skills/masterino-foreign');
    fs.files.set('/repo/.claude/skills/masterino-foreign/SKILL.md', '# Foreign');

    const result = await materializer.materialize({
      cli: 'claude-code',
      registry: registry('project', []),
      workspaceRoot: '/repo',
    });

    expect(result.removals).toEqual(['/repo/.claude/skills/masterino-deploy']);
    expect(fs.directories.has('/repo/.claude/skills/masterino-deploy')).toBe(false);
    expect(fs.files.get('/repo/.claude/skills/masterino-deploy/SKILL.md')).toBeUndefined();
    expect(fs.directories.has('/repo/.claude/skills/masterino-foreign')).toBe(true);
    expect(fs.files.get('/repo/.claude/skills/masterino-foreign/SKILL.md')).toBe('# Foreign');
    expect(fs.files.get('/repo/.claude/skills/.masterino-owned-skills.json')).not.toContain(
      'masterino-deploy',
    );
  });

  it('supports an explicit Claude Code user-skill root', async () => {
    const fs = new MemoryMaterializationFs();
    const result = await new HeterogeneousSkillMaterializer(fs).materialize({
      cli: 'claude-code',
      registry: registry('user'),
      userSkillsRoot: '/users/matt/.claude/skills',
    });

    expect(result.targetRoot).toBe('/users/matt/.claude/skills');
    expect(fs.files.has('/users/matt/.claude/skills/masterino-deploy/SKILL.md')).toBe(true);
    expect(fs.files.has('/repo/.git/info/exclude')).toBe(false);
  });

  it('explicitly skips Codex because its current-directory skill root is not reliable', async () => {
    const fs = new MemoryMaterializationFs();
    const result = await new HeterogeneousSkillMaterializer(fs).materialize({
      cli: 'codex',
      registry: registry('project'),
      workspaceRoot: '/repo',
    });

    expect(result).toMatchObject({
      reason: 'unsupported-current-directory',
      status: 'skipped',
    });
    expect(fs.operationCount).toBe(0);
  });
});
