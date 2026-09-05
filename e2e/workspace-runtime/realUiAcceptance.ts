/**
 * UI-only acceptance helpers for a connected full-product Browser tab.
 *
 * Call after inspecting the current DOM snapshot. Supply locators grounded in
 * that snapshot; this module deliberately does not guess product selectors.
 * It neither launches a substitute app nor accesses stores, APIs, IPC,
 * authentication state, transport mocks, or filesystem fixtures.
 *
 * The structural interfaces match the documented Browser tab locator surface.
 * Electron journeys use the Computer Use skill and the companion checklist.
 */

export interface VisibleControl {
  click: () => Promise<void>;
  count: () => Promise<number>;
  fill: (text: string) => Promise<void>;
  innerText: () => Promise<string>;
  isEnabled: () => Promise<boolean>;
  isVisible: () => Promise<boolean>;
  press: (key: string) => Promise<void>;
}

export interface UiEvidence {
  /** Save/inspect a fresh DOM snapshot or screenshot after each action. */
  observe: (step: string) => Promise<void>;
}

async function requireVisible(control: VisibleControl, label: string) {
  if ((await control.count()) !== 1 || !(await control.isVisible())) {
    throw new Error(`Expected one visible ${label}; inspect the current UI before continuing.`);
  }
}

export async function clickVisible(control: VisibleControl, label: string, evidence: UiEvidence) {
  await requireVisible(control, label);
  if (!(await control.isEnabled())) throw new Error(`${label} is disabled.`);
  await control.click();
  await evidence.observe(`After clicking ${label}`);
}

export async function assertHidden(control: VisibleControl, label: string) {
  if ((await control.count()) > 0 && (await control.isVisible())) {
    throw new Error(`${label} must not be visible in this UI context.`);
  }
}

/** W01: call with the new-topic execution menu already open through UI. */
export async function verifyWebNewTopicOptions(controls: {
  cloudSandbox: VisibleControl;
  directoryPicker: VisibleControl;
  gateway: VisibleControl;
  localMachine: VisibleControl;
  projectGroups: VisibleControl;
}) {
  await requireVisible(controls.cloudSandbox, 'cloud sandbox option');
  await requireVisible(controls.gateway, 'gateway option');
  await assertHidden(controls.localMachine, 'local-machine option');
  await assertHidden(controls.directoryPicker, 'directory picker');
  await assertHidden(controls.projectGroups, 'project groups');
}

/** W02: call once for each known historical topic; verify real transcript. */
export async function openHistoricalTopic(
  row: VisibleControl,
  transcript: VisibleControl,
  knownSyntheticMarker: string,
  evidence: UiEvidence,
) {
  await clickVisible(row, 'historical topic', evidence);
  await requireVisible(transcript, 'historical transcript');
  if (!(await transcript.innerText()).includes(knownSyntheticMarker)) {
    throw new Error('Historical topic did not restore the expected transcript.');
  }
}

/** Use only a freshly observed, unique composer and send button. */
export async function sendThroughComposer(
  composer: VisibleControl,
  sendButton: VisibleControl,
  syntheticPrompt: string,
  evidence: UiEvidence,
  typeThroughUi: (text: string) => Promise<void>,
) {
  await clickVisible(composer, 'chat composer', evidence);
  // The Lexical composer requires real keyboard input; DOM fill may not update its state.
  await typeThroughUi(syntheticPrompt);
  await evidence.observe('Prompt entered; verify correct target/project before send');
  await clickVisible(sendButton, 'send message', evidence);
}

/** S01: use a synthetic non-secret text field in each collapsible section. */
export async function verifyCollapsedDraft(controls: {
  evidence: UiEvidence;
  expandToggle: VisibleControl;
  field: VisibleControl;
  readVisibleDraft: () => Promise<string>;
  syntheticDraft: string;
}) {
  const { evidence, expandToggle, field, readVisibleDraft, syntheticDraft } = controls;
  await assertHidden(field, 'initially collapsed setting field');
  await clickVisible(expandToggle, 'settings section', evidence);
  await requireVisible(field, 'expanded setting field');
  await field.fill(syntheticDraft);
  await evidence.observe('Unsaved synthetic settings draft entered');
  await clickVisible(expandToggle, 'collapse settings section', evidence);
  await assertHidden(field, 'collapsed setting field');
  await clickVisible(expandToggle, 'reopen settings section', evidence);
  if ((await readVisibleDraft()) !== syntheticDraft) {
    throw new Error('Collapsing and reopening the section lost the unsaved draft.');
  }
}

/** S05: recovery is verified by the visible recovered result, never a store. */
export async function retryVisibleScanError(controls: {
  errorMessage: VisibleControl;
  evidence: UiEvidence;
  recoveredSkill: VisibleControl;
  retryButton: VisibleControl;
}) {
  await requireVisible(controls.errorMessage, 'skill scan error');
  await clickVisible(controls.retryButton, 'retry skill scan', controls.evidence);
  await requireVisible(controls.recoveredSkill, 'recovered synthetic skill');
  await assertHidden(controls.errorMessage, 'resolved skill scan error');
}
