const spinner = document.querySelector('[data-testid="tool-spinner"]');
const status = document.querySelector('[data-testid="tool-status"]');
const prepareAttempts = document.querySelector('[data-testid="prepare-attempts"]');
const localExecutionCount = document.querySelector('[data-testid="local-execution-count"]');
const runningOperationCount = document.querySelector('[data-testid="running-operation-count"]');
const resultSyncAttempts = document.querySelector('[data-testid="result-sync-attempts"]');

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
