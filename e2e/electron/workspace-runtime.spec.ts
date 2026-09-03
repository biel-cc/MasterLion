import { expect, test } from '@playwright/test';

import {
  launchElectronWorkspaceRuntimeSession,
  type ElectronAcceptanceId,
} from '../workspace-runtime/electronHarness';
import type { AcceptanceResultMap } from '../../test/workspace-runtime/contracts';

const withObservation = async <Id extends ElectronAcceptanceId>(
  id: Id,
  verify: (observed: AcceptanceResultMap[Id]) => Promise<void> | void,
) => {
  const session = await launchElectronWorkspaceRuntimeSession();
  try {
    await verify(await session.observe(id));
  } finally {
    await session.close();
  }
};

test('AC-W04 keeps five unbound pure-chat turns out of workspace DB and scratch disk', async () => {
  await withObservation('AC-W04', (observed) => {
    expect(observed.projectWorkspaceRowsAfter).toBe(observed.projectWorkspaceRowsBefore);
    expect(observed.scratchDirectoriesAfter).toEqual(observed.scratchDirectoriesBefore);
  });
});

test('AC-W05 keeps Topic/Recent independent from Task storage and T-n UI', async () => {
  await withObservation('AC-W05', (observed) => {
    expect(observed.topLevelTopicVisible).toBe(true);
    expect(observed.recentTopicIds).toContain('topic-unbound');
    expect(observed.taskListCountAfter).toBe(observed.taskListCountBefore);
    expect(observed.taskTopicRowsAfter).toBe(observed.taskTopicRowsBefore);
    expect(observed.taskUiLabelsAfter).toEqual(observed.taskUiLabelsBefore);
  });
});

test('AC-W06 places multiple bound topics only in their Workspace group', async () => {
  await withObservation('AC-W06', (observed) => {
    expect(observed.workspaceGroups['workspace-a']).toEqual(['topic-a', 'topic-b']);
    expect(observed.recentTopicIds).not.toEqual(expect.arrayContaining(['topic-a', 'topic-b']));
  });
});

test('AC-W07 lazily creates one scratch while direct structured read stays scratch-free', async () => {
  await withObservation('AC-W07', (observed) => {
    expect(observed.directReadScratchCount).toBe(0);
    expect(observed.scratchCreateCalls).toBe(1);
    expect(new Set(observed.scratchIds)).toHaveLength(1);
    expect(new Set(observed.snapshotWorkspaceIds)).toEqual(new Set(observed.scratchIds));
    expect(observed.temporaryMarkerVisible).toBe(true);
  });
});

test('AC-W08 rejects scratch rebind and offers a new project topic', async () => {
  await withObservation('AC-W08', (observed) => {
    expect(observed.allowed).toBe(false);
    expect(observed.cwdAfter).toBe(observed.cwdBefore);
    expect(observed.actionLabel).toMatch(/new project topic|新建项目话题/i);
  });
});

test('AC-W09 binds only explicit workspace sources without changing the agent default', async () => {
  await withObservation('AC-W09', (observed) => {
    expect(observed.agentDefaultAfter).toBe(observed.agentDefaultBefore);
    expect(observed.bindingBySource).toMatchObject({
      attachment: false,
      codeBlock: false,
      confirmedDirectory: true,
      quote: false,
      workspacePlus: true,
    });
  });
});

test('AC-W10 blocks unbound heterogeneous send and resumes with canonical identity', async () => {
  await withObservation('AC-W10', (observed) => {
    expect(observed.preBindCode).toBe('WORKSPACE_REQUIRED');
    expect(observed.normalizedResumeIdentity).toBe(observed.persistedIdentity);
  });
});

test('AC-P08 describes consent as audit, not isolation, and shows shell path risk', async () => {
  await withObservation('AC-P08', (observed) => {
    expect(observed.consentNotice).toMatch(/not.*isolation|不是.*隔离/i);
    expect(observed.displayedCwd).toBe('/code/masterino');
    expect(observed.displayedCommand).toContain('/outside/payroll.csv');
    expect(observed.riskNotice).toContain('/outside/payroll.csv');
  });
});

test('AC-M03 shows the same three model-access labels outside dev mode', async () => {
  await withObservation('AC-M03', (observed) => {
    expect(observed.productionLabels).toEqual(['supported', 'text-only', 'unknown']);
    expect(observed.developmentLabels).toEqual(observed.productionLabels);
  });
});

test('AC-C04 provides visible manual feedback when compression has no candidates', async () => {
  await withObservation('AC-C04', (observed) => {
    expect(observed.code).toBe('NO_CANDIDATES');
    expect(observed.manualFeedback.trim().length).toBeGreaterThan(0);
  });
});

test('AC-C08 aligns error-card actions and redacts message and attachment content', async () => {
  await withObservation('AC-C08', (observed) => {
    expect(observed.cards.map(({ code }) => code)).toEqual([
      'TAIL_TOO_LARGE',
      'NO_CANDIDATES',
      'SUMMARY_FAILED',
      'RETRY_EXHAUSTED',
    ]);
    for (const secret of observed.secrets) expect(observed.diagnostics).not.toContain(secret);
  });
});

test('AC-X02 passes the complete compatibility grid without hard-validating old devices', async () => {
  await withObservation('AC-X02', (observed) => {
    expect(observed.matrix).toHaveLength(8);
    expect(observed.matrix.every(({ passed }) => passed)).toBe(true);
    expect(
      observed.matrix
        .filter(({ device }) => device === 'old')
        .every(({ hardValidated }) => !hardValidated),
    ).toBe(true);
  });
});
