import { loadConfig } from './config.js';
import { runCuratedSeed } from './seed.js';

await runCuratedSeed(loadConfig());
