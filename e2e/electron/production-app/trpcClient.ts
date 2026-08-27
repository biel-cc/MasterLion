type Scenario = 'manual-recovery' | 'third-attempt-recovery';

interface RequestState {
  attempts: number;
  requestTimes: number[];
  scenario: Scenario;
}

let state: RequestState = {
  attempts: 0,
  requestTimes: [],
  scenario: 'third-attempt-recovery',
};
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

export const configureNotebookScenario = (scenario: Scenario) => {
  state = { attempts: 0, requestTimes: [], scenario };
  notify();
};

export const getNotebookRequestSnapshot = () => state;

export const subscribeNotebookRequests = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const listDocumentSummaries = async () => {
  state = {
    ...state,
    attempts: state.attempts + 1,
    requestTimes: [...state.requestTimes, Date.now()],
  };
  notify();

  const failureBudget = state.scenario === 'manual-recovery' ? 3 : 2;
  if (state.attempts <= failureBudget) {
    throw Object.assign(new Error('notebook database recovering'), {
      data: {
        errorData: { reason: 'DATABASE_RECOVERING' },
        httpStatus: 503,
      },
    });
  }

  return {
    data: [
      {
        associatedAt: new Date('2026-08-27T00:00:00.000Z'),
        createdAt: new Date('2026-08-27T00:00:00.000Z'),
        description: 'Bounded summary from the production Notebook data chain',
        fileType: 'report',
        filename: 'existing-report.md',
        id: 'existing-report',
        title: 'Existing report',
        totalCharCount: 1_000_000,
        totalLineCount: 10_000,
        updatedAt: new Date('2026-08-27T00:00:00.000Z'),
      },
    ],
    total: 1,
  };
};

const unsupported = async () => {
  throw new Error('This TRPC operation is outside the Notebook list Electron E2E boundary');
};

export const lambdaClient = {
  notebook: {
    createDocument: { mutate: unsupported },
    deleteDocument: { mutate: unsupported },
    getDocument: { query: unsupported },
    getLatestPlan: { query: unsupported },
    listDocumentSummaries: { query: listDocumentSummaries },
    listDocuments: { query: unsupported },
    updateDocument: { mutate: unsupported },
  },
};
