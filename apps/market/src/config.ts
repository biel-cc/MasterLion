import { z } from 'zod';

const ConfigSchema = z.object({
  MARKET_ADMIN_USER_IDS: z.string().default(''),
  MARKET_CREDENTIAL_ENCRYPTION_KEY: z.string().min(32),
  MARKET_DATABASE_URL: z.string().min(1),
  MARKET_IMPORT_SIGNING_KEY: z.string().min(32),
  MARKET_OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1),
  MARKET_OBJECT_STORAGE_ENDPOINT: z.string().url(),
  MARKET_OBJECT_STORAGE_BUCKET: z.string().min(1),
  MARKET_OBJECT_STORAGE_FORCE_PATH_STYLE: z.enum(['0', '1']).default('1'),
  MARKET_OBJECT_STORAGE_REGION: z.string().default('us-east-1'),
  MARKET_OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  MARKET_OAUTH_CLIENTS_JSON: z.string().default('{}'),
  MARKET_OAUTH_REDIRECT_ORIGINS: z.string().min(1),
  MARKET_PORT: z.coerce.number().int().positive().default(3220),
  MARKET_PUBLIC_BASE_URL: z.string().url(),
  MARKET_REDIS_URL: z.string().min(1),
  MARKET_RUNNER_INTERNAL_URL: z.string().url().default('http://masterino-market-runner:3221'),
  MARKET_RUNNER_INTERNAL_TOKEN: z.string().min(32),
  MARKET_TRUSTED_CLIENT_IDS: z.string().min(1),
  MARKET_TRUSTED_CLIENT_SECRET: z.string().min(32),
});

export type MarketConfig = z.infer<typeof ConfigSchema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): MarketConfig => {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Internal Market configuration is incomplete: ${missing}`);
  }
  return parsed.data;
};

export const splitCsv = (value: string): Set<string> =>
  new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
