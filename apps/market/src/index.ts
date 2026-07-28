import { createMarketApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { MarketRepository } from './repository.js';
import { serveHono } from './server.js';

const config = loadConfig();
const pool = createPool(config.MARKET_DATABASE_URL);
const app = createMarketApp({ config, repository: new MarketRepository(pool) });

serveHono(app.fetch, config.MARKET_PORT);
console.log(`Masterino Market listening on ${config.MARKET_PORT}`);
