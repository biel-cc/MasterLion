import { describe, expect, it } from 'vitest';

import { createPathScopeAudit, pathScopeAudit } from '../../interventionAudit';

describe('local-system execution boundary intervention', () => {
  const metadata = { workingDirectory: '/Users/me/project' };

  it('requires intervention for credential reads inside the workspace', async () => {
    await expect(pathScopeAudit({ path: '/Users/me/project/.env' }, metadata)).resolves.toBe(true);
    await expect(
      pathScopeAudit({ path: '/Users/me/project/.aws/credentials' }, metadata),
    ).resolves.toBe(true);
    await expect(pathScopeAudit({ paths: ['/Users/me/project/.npmrc'] }, metadata)).resolves.toBe(
      true,
    );
  });

  it('only bypasses intervention for a structured direct read consent', async () => {
    const audit = createPathScopeAudit({ areAllPathsSafe: async () => true });
    const directRead = {
      ...metadata,
      pathAccessMode: 'read',
      pathSource: 'direct-user-message',
    };

    await expect(audit({ path: '/tmp/input.txt' }, directRead)).resolves.toBe(false);
    await expect(
      audit(
        { path: '/tmp/output.txt' },
        { ...metadata, pathAccessMode: 'write', pathSource: 'direct-user-message' },
      ),
    ).resolves.toBe(true);
    await expect(
      audit(
        { path: '/tmp/script.sh' },
        { ...metadata, pathAccessMode: 'exec', pathSource: 'direct-user-message' },
      ),
    ).resolves.toBe(true);
  });
});
