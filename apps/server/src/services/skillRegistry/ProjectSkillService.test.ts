// @vitest-environment node
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PROJECT_SKILL_FILE_BYTES,
  type ProjectSkillFsAdapter,
  type ProjectSkillFsStat,
  ProjectSkillService,
} from './ProjectSkillService';

const stat = (kind: 'directory' | 'file' | 'symlink', size = 0): ProjectSkillFsStat => ({
  isDirectory: kind === 'directory',
  isFile: kind === 'file',
  isSymbolicLink: kind === 'symlink',
  size,
});

class MemorySkillFs implements ProjectSkillFsAdapter {
  entries = new Map<string, { content?: string | Uint8Array; stat: ProjectSkillFsStat }>();

  constructor() {
    this.entries.set('/repo', { stat: stat('directory') });
  }

  listFiles = async (directory: string) => {
    const prefix = directory + '/';
    return [...this.entries.entries()]
      .filter(([entryPath, entry]) => entryPath.startsWith(prefix) && entry.stat.isFile)
      .map(([entryPath]) => entryPath.slice(prefix.length));
  };

  lstat = async (entryPath: string) => this.entries.get(entryPath)?.stat;

  mkdir = async (directory: string) => {
    const normalized = path.posix.normalize(directory);
    const parts = normalized.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      if (!this.entries.has(current)) this.entries.set(current, { stat: stat('directory') });
    }
  };

  readFile = async (entryPath: string) => {
    const entry = this.entries.get(entryPath);
    if (!entry?.stat.isFile || entry.content === undefined) throw new Error('file not found');
    return entry.content;
  };

  remove = async (entryPath: string) => {
    for (const key of [...this.entries.keys()]) {
      if (key === entryPath || key.startsWith(entryPath + '/')) this.entries.delete(key);
    }
  };

  rename = async (from: string, to: string) => {
    for (const [key, value] of [...this.entries.entries()]) {
      if (key === from || key.startsWith(from + '/')) {
        this.entries.delete(key);
        this.entries.set(to + key.slice(from.length), value);
      }
    }
  };

  writeFile = async (entryPath: string, content: string | Uint8Array) => {
    this.entries.set(entryPath, {
      content,
      stat: stat('file', typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength),
    });
  };
}

const validSkill = (name = 'release-writer') => `---
name: ${name}
description: Write accurate release notes
---

# Release writer

Summarize user-visible changes.`;

describe('ProjectSkillService', () => {
  it('creates, validates, updates, renames, packs, promotes, and deletes a project skill', async () => {
    const fs = new MemorySkillFs();
    const service = new ProjectSkillService('/repo', fs);

    await expect(
      service.create({
        content: validSkill(),
        name: 'release-writer',
        resources: { 'references/style.md': '# Style' },
      }),
    ).resolves.toMatchObject({ valid: true });

    await expect(
      service.update({ content: '# Updated style', name: 'release-writer', path: 'references/style.md' }),
    ).resolves.toMatchObject({ valid: true });

    await expect(service.rename('release-writer', 'changelog-writer')).resolves.toMatchObject({
      manifest: { name: 'changelog-writer' },
      valid: true,
    });

    const archive = await service.pack('changelog-writer');
    expect(Buffer.from(archive).subarray(0, 2).toString()).toBe('PK');

    const importProjectSkill = vi.fn(async () => ({ id: 'user-skill-1' }));
    await expect(
      service.promoteToUser('changelog-writer', { importProjectSkill }),
    ).resolves.toEqual({ id: 'user-skill-1' });
    expect(importProjectSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        archive: expect.any(Uint8Array),
        manifest: expect.objectContaining({ name: 'changelog-writer' }),
      }),
    );

    await service.delete('changelog-writer');
    expect(await fs.lstat('/repo/.agents/skills/changelog-writer')).toBeUndefined();
  });

  it('rejects traversal before any write', async () => {
    const fs = new MemorySkillFs();
    const writeSpy = vi.spyOn(fs, 'writeFile');
    const service = new ProjectSkillService('/repo', fs);
    await service.create({ content: validSkill(), name: 'release-writer' });
    writeSpy.mockClear();

    await expect(
      service.update({ content: 'secret', name: 'release-writer', path: '../secret' }),
    ).rejects.toThrow('Unsafe skill path');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('rejects symlinked skill ancestors', async () => {
    const fs = new MemorySkillFs();
    fs.entries.set('/repo/.agents', { stat: stat('symlink') });
    const service = new ProjectSkillService('/repo', fs);

    await expect(
      service.create({ content: validSkill(), name: 'release-writer' }),
    ).rejects.toThrow('Symbolic links are not allowed');
  });

  it('rejects oversized files before writing them', async () => {
    const fs = new MemorySkillFs();
    const writeSpy = vi.spyOn(fs, 'writeFile');
    const service = new ProjectSkillService('/repo', fs);

    await expect(
      service.create({
        content: validSkill(),
        name: 'release-writer',
        resources: { 'references/huge.txt': new Uint8Array(MAX_PROJECT_SKILL_FILE_BYTES + 1) },
      }),
    ).rejects.toThrow('per-file size limit');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('reports missing and invalid frontmatter without packing', async () => {
    const fs = new MemorySkillFs();
    const service = new ProjectSkillService('/repo', fs);
    await fs.mkdir('/repo/.agents/skills/broken');
    await fs.writeFile('/repo/.agents/skills/broken/SKILL.md', '# Missing frontmatter');

    const validation = await service.validate('broken');

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain('requires non-empty name and description');
    await expect(service.pack('broken')).rejects.toThrow('requires non-empty name and description');
  });
});
