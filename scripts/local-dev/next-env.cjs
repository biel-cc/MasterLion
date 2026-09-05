// Next's dev watcher force-reloads .env files, bypassing __NEXT_PROCESSED_ENV.
// Only the isolated launcher preloads this adapter (including Next worker forks).
// Keep Next's normal loader and state machinery, but point it at our empty env dir.
const path = require('node:path');
if (process.env.NODE_ENV !== 'development' || process.env.MASTERINO_DEV_ENV !== 'local') {
  throw new Error('The isolated Next environment adapter is development-only.');
}
// Docker Desktop resolves this name inside containers. Resolve it to the same
// loopback backend in the host process without changing system DNS or hosts.
const dns = require('node:dns');
const lookup = dns.lookup;
dns.lookup = function (hostname, ...args) {
  return lookup.call(this, hostname === 'host.docker.internal' ? '127.0.0.1' : hostname, ...args);
};
const root = path.resolve(__dirname, '../..');
const id = require.resolve('@next/env', { paths: [require.resolve('next', { paths: [root] })] });
const original = require(id);
const descriptors = Object.getOwnPropertyDescriptors(original);
delete descriptors.loadEnvConfig;
const replacement = Object.defineProperties({}, descriptors);
replacement.loadEnvConfig = (_directory, ...args) =>
  original.loadEnvConfig(path.join(root, '.local-dev/empty-env'), ...args);
require.cache[id].exports = replacement;
