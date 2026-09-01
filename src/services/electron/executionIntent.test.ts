import { describe, expect, it } from 'vitest';

import { resolveExecutionWorkload, resolveShellEnvironmentPolicy } from './executionIntent';

describe('local execution intent', () => {
  it('maps server-safe profile intent without carrying environment values', () => {
    expect(resolveShellEnvironmentPolicy('inherit')).toEqual({ inherit: 'all' });
    expect(resolveShellEnvironmentPolicy('core')).toEqual({ inherit: 'core' });
    expect(resolveShellEnvironmentPolicy('isolated')).toEqual({ inherit: 'none' });
  });

  it('uses selected skill declarations as the highest-priority workload intent', () => {
    expect(
      resolveExecutionWorkload([
        {
          execution: { bunCompatible: true, packageManager: 'bun', runtime: 'bun' },
          identifier: 'masterino-charting',
          masterinoOwned: true,
          name: 'Charting',
        },
      ]),
    ).toEqual({
      bunCompatible: true,
      kind: 'skill',
      masterinoOwned: true,
      packageManager: 'bun',
      runtime: 'bun',
    });
  });

  it('does not infer a runtime when selected skills have conflicting declarations', () => {
    expect(
      resolveExecutionWorkload([
        {
          execution: { runtime: 'node' },
          identifier: 'node-skill',
          name: 'Node skill',
        },
        {
          execution: { runtime: 'python' },
          identifier: 'python-skill',
          name: 'Python skill',
        },
      ]),
    ).toEqual({
      bunCompatible: false,
      kind: 'skill',
      masterinoOwned: false,
    });
  });
});
