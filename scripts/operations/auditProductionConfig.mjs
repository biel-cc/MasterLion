import { readFile } from 'node:fs/promises';
import path from 'node:path';

const envPath = path.resolve(process.env.MASTERINO_ENV_FILE || 'deploy/.env.prod');
const secretPath = path.resolve(process.env.MASTERINO_SECRET_FILE || 'k8s/01-secret.yaml');

const parseValue = (value) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
};

const parseEnv = (source) => {
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([a-z_]\w*)\s*=(.*)$/i);
    if (match) values.set(match[1], parseValue(match[2]));
  }
  return values;
};

const parseSecretYaml = (source) => {
  const values = new Map();
  let inSecretData = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^(?:data|stringData):\s*$/.test(line)) {
      inSecretData = true;
      continue;
    }
    if (inSecretData && /^\S/.test(line)) inSecretData = false;
    if (!inSecretData) continue;
    const match = line.match(/^ {2}([a-z_][\w-]*): ?(.*)$/i);
    if (match) values.set(match[1], parseValue(match[2]));
  }
  return values;
};

const [envSource, secretSource] = await Promise.all([
  readFile(envPath, 'utf8'),
  readFile(secretPath, 'utf8'),
]);
const env = parseEnv(envSource);
const secret = parseSecretYaml(secretSource);
const combined = new Map([...secret, ...env]);

const duplicatedSecretKeys = [
  'AIHUB_BRIDGE_TOKEN',
  'AIHUB_READONLY_DATABASE_URL',
  'AUTH_SECRET',
  'JWKS_KEY',
  'KEY_VAULTS_SECRET',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];
const mismatchedKeys = duplicatedSecretKeys.filter(
  (key) => env.has(key) && secret.has(key) && env.get(key) !== secret.get(key),
);

const requiredKeys = [
  'AIHUB_BRIDGE_TOKEN',
  'AIHUB_READONLY_DATABASE_URL',
  'AUTH_SECRET',
  'DATABASE_URL',
  'JWKS_KEY',
  'KEY_VAULTS_SECRET',
  'ONLYBOXES_JIT_SIGNING_KEY',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'REDIS_URL',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];
const missingRequiredKeys = requiredKeys.filter((key) => !combined.get(key));
const missingCompatibilityKeys = combined.get('S3_ACCESS_KEY') ? [] : ['S3_ACCESS_KEY'];

const newDomain = 'masterino.bielcrystal.com';
const domainValues = [env.get('APP_URL'), env.get('APP_URL_ALLOWED_HOSTS')].filter(Boolean);
const domainPhase = domainValues.every((value) => value.includes(newDomain))
  ? 'masterino-ready'
  : domainValues.length === 2 &&
      domainValues.every((value) => /master(?:ion|lion)\.bielcrystal\.com/.test(value))
    ? 'legacy-preserved'
    : 'mixed-or-missing';

const preservedExternalNames = {
  aihubManagedToken: env.get('AIHUB_MANAGED_TOKEN_NAME') === 'masterlion-managed',
  databaseName: env.get('LOBE_DB_NAME') === 'lobechat',
  objectStorageBucket: env.get('S3_BUCKET') === 'masterlion-prd',
};

console.log(`Environment keys: ${env.size}`);
console.log(`Secret keys: ${secret.size}`);
console.log(`Domain phase: ${domainPhase}`);
console.log(
  `Stateful external names preserved: ${Object.values(preservedExternalNames).filter(Boolean).length}/${Object.keys(preservedExternalNames).length}`,
);
console.log(
  `Missing required keys: ${missingRequiredKeys.length ? missingRequiredKeys.join(', ') : 'none'}`,
);
console.log(
  `Missing optional compatibility aliases: ${missingCompatibilityKeys.length ? missingCompatibilityKeys.join(', ') : 'none'}`,
);
console.log(
  `Mismatched duplicated secrets: ${mismatchedKeys.length ? mismatchedKeys.join(', ') : 'none'}`,
);
console.log('Secret values were not printed.');

if (mismatchedKeys.length || missingRequiredKeys.length || domainPhase === 'mixed-or-missing') {
  process.exitCode = 2;
}
