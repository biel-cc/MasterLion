export const MANAGED_AGENT_ENV_KEYS = new Set([
  'CLAUDE_CODE_CRED_KEY',
  'GITHUB_CRED_KEY',
  'GITHUB_REPOS',
]);

const AGENT_ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_RUNTIME_ENV_KEYS = new Set(['HOME', 'LOBEHUB_JWT', 'LOBEHUB_SERVER', 'PATH']);
const SECURITY_SENSITIVE_ENV_PATTERN =
  /(?:^|_)(?:ACCESS_KEY|API_KEY|CLIENT_SECRET|CREDENTIALS?|KEY|PASSWORD|PASSWD|PRIVATE_KEY|SECRET|TOKEN)(?:_|$)/;
const SECURITY_SENSITIVE_ENV_KEYS = new Set([
  'CONNECTION_STRING',
  'DATABASE_URL',
  'DSN',
  'MONGODB_URI',
  'MONGO_URI',
  'REDIS_URL',
]);

export type AgentEnvKeyError = 'invalid' | 'managed' | 'reserved' | 'sensitive';

export const getAgentEnvKeyError = (key: string): AgentEnvKeyError | undefined => {
  if (!AGENT_ENV_KEY_PATTERN.test(key)) return 'invalid';
  if (MANAGED_AGENT_ENV_KEYS.has(key)) return 'managed';
  if (RESERVED_RUNTIME_ENV_KEYS.has(key)) return 'reserved';
  if (SECURITY_SENSITIVE_ENV_KEYS.has(key) || SECURITY_SENSITIVE_ENV_PATTERN.test(key)) {
    return 'sensitive';
  }
};

export const isEditableAgentEnvKey = (key: string): boolean => !getAgentEnvKeyError(key);

/** Product-managed references remain intact; unsafe generic agent keys never reach persistence. */
export const sanitizeAgentEnv = (env: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => MANAGED_AGENT_ENV_KEYS.has(key) || isEditableAgentEnvKey(key),
    ),
  );
