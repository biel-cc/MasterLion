const spinner = document.querySelector('[data-testid="tool-spinner"]');
const status = document.querySelector('[data-testid="tool-status"]');
const prepareAttempts = document.querySelector('[data-testid="prepare-attempts"]');
const localExecutionCount = document.querySelector('[data-testid="local-execution-count"]');
const runningOperationCount = document.querySelector('[data-testid="running-operation-count"]');
const resultSyncAttempts = document.querySelector('[data-testid="result-sync-attempts"]');
const aihubSpinner = document.querySelector('[data-testid="aihub-spinner"]');
const aihubStatus = document.querySelector('[data-testid="aihub-status"]');
const aihubProvisionCount = document.querySelector('[data-testid="aihub-provision-count"]');
const aihubActiveCount = document.querySelector('[data-testid="aihub-active-count"]');
const executionContextSpinner = document.querySelector('[data-testid="execution-context-spinner"]');
const executionContextStatus = document.querySelector('[data-testid="execution-context-status"]');
const selectedWorkspace = document.querySelector('[data-testid="selected-workspace"]');
const selectedExecutionCwd = document.querySelector('[data-testid="selected-execution-cwd"]');
const selectedRuntime = document.querySelector('[data-testid="selected-runtime"]');
const selectedEnvironment = document.querySelector('[data-testid="selected-environment"]');
const managedWorkspace = document.querySelector('[data-testid="managed-workspace"]');
const managedWorkspaceStable = document.querySelector('[data-testid="managed-workspace-stable"]');
const missingRuntime = document.querySelector('[data-testid="missing-runtime"]');
const securityChecks = document.querySelector('[data-testid="security-checks"]');

const renderSnapshot = (snapshot) => {
  prepareAttempts.textContent = String(snapshot.prepareAttempts);
  localExecutionCount.textContent = String(snapshot.localExecutionCount);
  runningOperationCount.textContent = String(snapshot.runningOperationCount);
  resultSyncAttempts.textContent = String(snapshot.resultSyncAttempts);
  spinner.hidden = snapshot.runningOperationCount === 0;
};

const run = async (scenario) => {
  spinner.hidden = false;
  status.textContent = 'running';

  const result = await window.masterinoElectronE2E.runToolCall(scenario);
  renderSnapshot(result.snapshot);
  status.textContent = result.ok ? 'completed' : 'failed';
};

document
  .querySelector('[data-testid="run-transient"]')
  .addEventListener('click', () => run('transient'));
document
  .querySelector('[data-testid="run-exhausted"]')
  .addEventListener('click', () => run('exhausted'));
document
  .querySelector('[data-testid="run-sync-exhausted"]')
  .addEventListener('click', () => run('sync-exhausted'));
document
  .querySelector('[data-testid="run-cancelled"]')
  .addEventListener('click', () => run('cancelled'));

const runAihub = async (scenario) => {
  aihubSpinner.hidden = false;
  aihubStatus.textContent = 'running';
  const result = await window.masterinoElectronE2E.runAihubReadiness(scenario);
  aihubProvisionCount.textContent = String(result.provisionCount);
  aihubActiveCount.textContent = String(result.activeCount);
  aihubStatus.textContent = result.status;
  aihubSpinner.hidden = true;
};

document
  .querySelector('[data-testid="run-aihub-concurrent"]')
  .addEventListener('click', () => runAihub('concurrent'));
document
  .querySelector('[data-testid="run-aihub-relaunch"]')
  .addEventListener('click', () => runAihub('relaunch'));

document
  .querySelector('[data-testid="run-execution-context"]')
  .addEventListener('click', async () => {
    executionContextSpinner.hidden = false;
    executionContextStatus.textContent = 'running';
    const result = await window.masterinoElectronE2E.runExecutionContext();
    selectedWorkspace.textContent = `${result.selected.source}: ${result.selected.realPath}`;
    selectedExecutionCwd.textContent = result.selected.executedCwd;
    selectedRuntime.textContent = result.selected.runtime;
    selectedEnvironment.textContent = `${result.selected.marker}; secret=${result.selected.secret}`;
    managedWorkspace.textContent = `${result.managed.source}: ${result.managed.realPath}`;
    managedWorkspaceStable.textContent = String(result.managed.isStable);
    missingRuntime.textContent = `${result.runtime.runtime}/${result.runtime.packageManager}: ${result.runtime.status}; no-bun-substitution=${result.runtime.noBunSubstitution}`;
    securityChecks.textContent = [
      result.security.missingWorkspaceCode,
      result.security.escapeCode,
      result.security.staleContextCode,
    ].join(', ');
    executionContextStatus.textContent = result.status;
    executionContextSpinner.hidden = true;
  });
