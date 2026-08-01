import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const extractBlockScalar = (document, key) => {
  const lines = document.split(/\r?\n/);
  const escapedKey = key.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markerPattern = new RegExp(`^(\\s*)${escapedKey}: \\|[-+]?\\s*$`);
  const markerIndex = lines.findIndex((line) => markerPattern.test(line));
  assert.notEqual(markerIndex, -1, `${key} block scalar is missing`);

  const markerIndent = lines[markerIndex].match(/^\s*/)[0].length;
  const blockLines = [];
  for (const line of lines.slice(markerIndex + 1)) {
    const indentation = line.match(/^\s*/)[0].length;
    if (line.trim() && indentation <= markerIndent) break;
    blockLines.push(line);
  }

  const nonEmptyIndentations = blockLines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)[0].length);
  assert(nonEmptyIndentations.length, `${key} block scalar is empty`);
  const contentIndent = Math.min(...nonEmptyIndentations);

  return `${blockLines.map((line) => (line.trim() ? line.slice(contentIndent) : '')).join('\n')}\n`;
};

const manifestPath = path.resolve('k8s/overlays/production-maintenance/maintenance.yaml');
const source = await readFile(manifestPath, 'utf8');
const documents = source.split(/^---\s*$/m);
const kinds = documents
  .map((document) => document.match(/^kind:\s*(\S+)\s*$/m)?.[1])
  .filter(Boolean)
  .sort();
const configMap = documents.find((document) => /^kind:\s*ConfigMap\s*$/m.test(document));

assert(configMap, 'maintenance ConfigMap is missing');
const serverSource = extractBlockScalar(configMap, 'server.js');
const maintenancePage = extractBlockScalar(configMap, 'index.html');
assert.match(maintenancePage, /Masterino/);
assert.match(maintenancePage, /系统维护中/);
assert.match(source, /runAsGroup:\s*1001/);
assert.match(source, /runAsNonRoot:\s*true/);
assert.match(source, /runAsUser:\s*1001/);
assert.match(
  source,
  /name:\s*PORT[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*value:\s*['"]8080['"]/,
);
assert.deepEqual(kinds, ['ConfigMap', 'Deployment', 'Ingress', 'PodDisruptionBudget', 'Service']);

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'masterino-maintenance-'));
const serverPath = path.join(temporaryDirectory, 'server.cjs');
const pagePath = path.join(temporaryDirectory, 'index.html');
await writeFile(serverPath, serverSource);
await writeFile(pagePath, maintenancePage);

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    probe.close(() => resolve(address.port));
  });
});

const child = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    MAINTENANCE_PAGE_PATH: pagePath,
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('maintenance server did not start')), 5000);
    child.once('exit', (code) => reject(new Error(`maintenance server exited with ${code}`)));
    child.stdout.once('data', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');

  const verification = await fetch(`${baseUrl}/WW_verify_uSB5OnVf9BeWJX0U.txt`);
  assert.equal(verification.status, 200);
  assert.equal(await verification.text(), 'uSB5OnVf9BeWJX0U');

  const maintenance = await fetch(`${baseUrl}/`);
  assert.equal(maintenance.status, 503);
  assert.equal(maintenance.headers.get('retry-after'), '300');
  assert.match(maintenance.headers.get('cache-control') || '', /no-store/);
  assert.match(maintenance.headers.get('content-security-policy') || '', /default-src 'none'/);
  assert.match(await maintenance.text(), /系统维护中/);

  const head = await fetch(`${baseUrl}/anything`, { method: 'HEAD' });
  assert.equal(head.status, 503);
  assert.equal(await head.text(), '');
  console.log('Production maintenance runtime verification passed.');
} finally {
  child.kill('SIGTERM');
  await rm(temporaryDirectory, { force: true, recursive: true });
}
