import { describe, expect, it } from 'vitest';

import { acceptanceMatrix, frozenArgv } from './acceptanceMatrix';
import { registeredAcceptanceIds } from './acceptanceAssertions';
import { acceptanceIds } from './contracts';

describe('workspace runtime acceptance inventory', () => {
  it('maps every approved AC exactly once to fixture, observable, failure, and command', () => {
    expect(acceptanceMatrix).toHaveLength(34);
    expect(acceptanceMatrix.map(({ testId }) => testId).sort()).toEqual([...acceptanceIds].sort());
    expect(new Set(acceptanceMatrix.map(({ testId }) => testId))).toHaveLength(34);

    for (const row of acceptanceMatrix) {
      expect(row.fixture.trim().length).toBeGreaterThan(0);
      expect(row.observable.trim().length).toBeGreaterThan(0);
      expect(row.failCondition.trim().length).toBeGreaterThan(0);
      expect(frozenArgv[row.command].length).toBeGreaterThan(0);
    }
  });

  it('registers one executable contract assertion for every approved AC', () => {
    expect(registeredAcceptanceIds.sort()).toEqual([...acceptanceIds].sort());
    expect(new Set(registeredAcceptanceIds)).toHaveLength(34);
  });

  it('freezes the controller verification argv without shell interpolation', () => {
    expect(frozenArgv).toEqual({
      diffCheck: ['git', 'diff', '--check'],
      electron: [
        'pnpm',
        'exec',
        'playwright',
        'test',
        '--config=e2e/electron/playwright.config.mjs',
        '--list',
        'e2e/electron/workspace-runtime.spec.ts',
      ],
      typeCheck: ['bun', 'run', 'type-check'],
      vitest: ['bunx', 'vitest', 'run', '--silent=passed-only', 'test/workspace-runtime'],
    });
  });
});
