import i18n from 'i18next';
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import NotebookBody from '@/features/Portal/Notebook/Body';
import { useNotebookStore } from '@/store/notebook';

import { useChatStore } from './chatStore';
import {
  configureNotebookScenario,
  getNotebookRequestSnapshot,
  subscribeNotebookRequests,
} from './trpcClient';

void i18n.use(initReactI18next).init({
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
  lng: 'en-US',
  resources: {
    'en-US': {
      common: { retry: 'Retry' },
      portal: {
        notebook: {
          confirmDelete: 'Delete this document?',
          delete: 'Delete',
          empty: 'No notebook documents',
          loadError: 'Notebook list is temporarily unavailable.',
        },
      },
    },
  },
});

let topicSequence = 0;

const startScenario = (scenario: 'manual-recovery' | 'third-attempt-recovery') => {
  configureNotebookScenario(scenario);
  useNotebookStore.getState().reset();
  topicSequence += 1;
  useChatStore.getState().setActiveTopicId(`electron-notebook-${topicSequence}`);
};

const RequestStats = () => {
  const snapshot = useSyncExternalStore(
    subscribeNotebookRequests,
    getNotebookRequestSnapshot,
    getNotebookRequestSnapshot,
  );
  const delays = snapshot.requestTimes
    .slice(1)
    .map((time, index) => time - snapshot.requestTimes[index]);

  return (
    <dl>
      <dt>Notebook attempts</dt>
      <dd data-testid="notebook-attempts">{snapshot.attempts}</dd>
      <dt>Notebook retry delays</dt>
      <dd data-testid="notebook-delays">{delays.join(',')}</dd>
    </dl>
  );
};

const NotebookProductionHarness = () => (
  <I18nextProvider i18n={i18n}>
    <button
      data-testid="run-notebook-recovery"
      type="button"
      onClick={() => startScenario('third-attempt-recovery')}
    >
      Run notebook recovery scenario
    </button>
    <button
      data-testid="run-notebook-exhausted"
      type="button"
      onClick={() => startScenario('manual-recovery')}
    >
      Run exhausted notebook scenario
    </button>
    <RequestStats />
    <div style={{ height: 360, width: 620 }}>
      <NotebookBody />
    </div>
  </I18nextProvider>
);

const root = document.querySelector('#notebook-production-root');
if (!root) throw new Error('Notebook production E2E root is missing');

createRoot(root).render(<NotebookProductionHarness />);
