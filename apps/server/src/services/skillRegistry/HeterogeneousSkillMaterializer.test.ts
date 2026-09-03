// @vitest-environment node
import type { SkillRegistryResult } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import {
  HeterogeneousSkillMaterializer,
  type SkillMaterializationFsAdapter,
} from './HeterogeneousSkillMaterializer';

class MemoryMaterializationFs implements SkillMaterializationFsAdapter {
  files = new Map<string, string | Uint8Array>();
  mtimes = new Map<string, number>();
  writeCount = 0;

  lstat = async (_path: string) => undefined;
  mkdir = async (_path: string) => {};
  readFile = async (path: string) => this.files.get(path);
  writeFile = async (path: string, content: string | Uint8Array) => {
    this.files.set(path, content);
    this.mtimes.set(path, Date.now() + this.writeCount);
    this.writeCount += 1;
  };
}

const registry = (mode: 'off' | 'project' | 'user'): SkillRegistryResult => ({
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
  skills: [
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
    expect(fs.writeCount).toBe(0);
  });

  it('materializes Claude Code project skills and excludes generated content from git', async () => {
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
    expect(fs.files.get('/repo/.claude/skills/deploy/SKILL.md')).toContain('name: "deploy"');
    expect(fs.files.get('/repo/.git/info/exclude')).toBe('/.claude/skills/\n');
  });

  it('keeps mtime stable when materialized content is unchanged', async () => {
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

  it('supports an explicit Claude Code user-skill root', async () => {
    const fs = new MemoryMaterializationFs();
    const result = await new HeterogeneousSkillMaterializer(fs).materialize({
      cli: 'claude-code',
      registry: registry('user'),
      userSkillsRoot: '/users/matt/.claude/skills',
    });

    expect(result.targetRoot).toBe('/users/matt/.claude/skills');
    expect(fs.files.has('/users/matt/.claude/skills/deploy/SKILL.md')).toBe(true);
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
    expect(fs.writeCount).toBe(0);
  });
});
