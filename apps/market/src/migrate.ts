import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';

const config = loadConfig();
const pool = createPool(config.MARKET_DATABASE_URL);
await migrate(pool);
await pool.end();
console.log('Masterino Market migrations applied');
