import { MotionProvider } from '@lobehub/ui';
import { App as AntdApp } from 'antd';
import * as m from 'motion/react-m';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { createWorkspaceRuntimeI18n } from './workspaceRuntimeI18n';
import { ModelCapabilityRows } from './workspaceRuntimeModels';

/**
 * AC-M03's development-mode half.
 *
 * This bundle is compiled from the *same* production components and the same
 * shared model fixtures as `workspaceRuntimeRenderer`, differing only in the
 * `sharedRendererDefine` switches (`__DEV__`, `process.env.NODE_ENV`). The
 * spec compares the rendered accessibility labels across the two roots, so a
 * capability label that changes with dev mode fails the acceptance instead of
 * being asserted twice against the same constant.
 */
const i18n = createWorkspaceRuntimeI18n();

const DevelopmentModelHarness = () => (
  <I18nextProvider i18n={i18n}>
    <MotionProvider motion={m}>
      <AntdApp>
        <main data-testid="workspace-runtime-development-ui">
          <ModelCapabilityRows
            sectionTestId="model-capabilities-development"
            testIdPrefix="dev-model-row-"
          />
        </main>
      </AntdApp>
    </MotionProvider>
  </I18nextProvider>
);

const root = document.querySelector('#workspace-runtime-development-root');
if (!root) throw new Error('Workspace Runtime development E2E root is missing');

createRoot(root).render(<DevelopmentModelHarness />);
