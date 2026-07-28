import path from 'node:path';

import { app } from 'electron';
import * as electronIs from 'electron-is';

// Keep the runtime application name aligned with the packaged product name.
// Electron otherwise falls back to package.json's internal package name in
// development and in a few Windows shell surfaces.
app.setName('Masterino');

// Must run BEFORE any module captures `app.getPath('userData')` (e.g. `@/const/dir`
// reads it at top level). Once a path is read, `setName` / `setPath` no-op for it.
//
// Dev now uses the same `app://renderer/` origin as prod, so localStorage / cookies /
// IndexedDB would collide if both shared the packaged-app's userData dir. Pin dev to
// a sibling directory so prod sessions stay clean.
if (electronIs.dev()) {
  app.setPath('userData', path.join(app.getPath('appData'), 'masterino-desktop-dev'));
}
