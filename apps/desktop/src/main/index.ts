import './pre-app-init';

import fixPath from 'fix-path';

import { App } from './core/App';

// Finder/Explorer-launched desktop processes do not reliably inherit the user's login-shell PATH.
// Resolve it before App adds Masterino's bundled binaries and creates the execution-context manager,
// so preflight and every context-bound child process see the same final environment.
fixPath();
const app = new App();
app.bootstrap();
