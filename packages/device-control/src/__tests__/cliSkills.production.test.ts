import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { materializeSkillsForCli } from '../cliSkills';

const skills = [
  {
    content: '# Deploy\n\nDeploy safely.',
    description: 'Deploy safely',
    identifier: 'deploy',
    key: 'user:deploy',
    name: 'deploy',
    source: 'user',
  },
];

describe('materializeSkillsForCli production adapter', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cli-skills-'));
    await mkdir(path.join(root, '.git', 'info'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('materializes Claude Code skills before spawn and remains idempotent', async () => {
    const first = await materializeSkillsForCli({
      agentType: 'claude-code',
      cwd: root,
      policy: 'project',
      skills,
    });
    expect(first).toMatchObject({ errors: [], status: 'materialized' });
    expect(
      await readFile(path.join(root, '.claude', 'skills', 'masterino-deploy', 'SKILL.md'), 'utf8'),
    ).toContain('Deploy safely');
    expect(await readFile(path.join(root, '.git', 'info', 'exclude'), 'utf8')).toBe(
      '/.claude/skills/masterino-*/\n',
    );

    await expect(
      materializeSkillsForCli({
        agentType: 'claude-code',
        cwd: root,
        policy: 'project',
        skills,
      }),
    ).resolves.toMatchObject({ errors: [], status: 'unchanged' });
  });

  it('defaults to off and leaves the workspace untouched', async () => {
    await expect(
      materializeSkillsForCli({ agentType: 'claude-code', cwd: root, skills }),
    ).resolves.toMatchObject({ reason: 'disabled', status: 'skipped' });
    await expect(access(path.join(root, '.claude'))).rejects.toBeDefined();
  });

  it('does not write Claude Code directories for a different heterogeneous agent', async () => {
    await expect(
      materializeSkillsForCli({
        agentType: 'openclaw',
        cwd: root,
        policy: 'project',
        skills,
      }),
    ).resolves.toMatchObject({ reason: 'unsupported-agent', status: 'skipped' });
    await expect(access(path.join(root, '.claude'))).rejects.toBeDefined();
  });

  it('fails closed instead of replacing a foreign Masterino-prefixed directory', async () => {
    const foreign = path.join(root, '.claude', 'skills', 'masterino-deploy');
    await mkdir(foreign, { recursive: true });
    await writeFile(path.join(foreign, 'SKILL.md'), '# Foreign');

    const result = await materializeSkillsForCli({
      agentType: 'claude-code',
      cwd: root,
      policy: 'project',
      skills,
    });
    expect(result).toMatchObject({ status: 'unchanged', writes: [] });
    expect(result.errors[0]?.message).toContain('foreign skill directory');
    expect(await readFile(path.join(foreign, 'SKILL.md'), 'utf8')).toBe('# Foreign');
  });
});
