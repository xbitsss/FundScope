// Node-only module. Never import this file from browser code or the Vite client graph.
import 'dotenv/config';
import { z } from 'zod';

const boolValue = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  if (/^(true|1|yes)$/i.test(value.trim())) return true;
  if (/^(false|0|no)$/i.test(value.trim())) return false;
  return value;
}, z.boolean());

const numberValue = (fallback: number, min: number, max: number) => z.preprocess(
  (value) => value === undefined || value === '' ? fallback : value,
  z.coerce.number().finite().min(min).max(max),
);

const envSchema = z.object({
  DATA_PASSPHRASE: z.string().optional(),
  ENCRYPT_DATA: boolValue.default(true),
  HOSTING_TARGET: z.enum(['github-pages', 'cloudflare']).default('github-pages'),
  PUBLIC_BASE_PATH: z.string().default('/FundScope/'),
  GITHUB_REPOSITORY: z.string().default(''),
  GITHUB_REPOSITORY_VISIBILITY: z.enum(['public', 'private']).optional(),
  GITHUB_TOKEN: z.string().optional(),
  GH_TOKEN: z.string().optional(),
  DATA_RELEASE_TAG: z.string().default('data-latest'),
  DATA_DIR: z.string().default('.data'),
  RISK_FREE_RATE: numberValue(6.5, 0, 100),
  MAX_SITE_SIZE_MB: numberValue(950, 1, 1024),
  MAX_DB_SIZE_MB: numberValue(1800, 1, 2048),
  ETL_TIME_BUDGET_MINUTES: numberValue(45, 1, 330),
  ETL_BATCH_SIZE: numberValue(3000, 1, 20000),
  HTTP_CONCURRENCY: numberValue(3, 1, 12),
  HTTP_INTERVAL_MS: numberValue(150, 0, 60000),
  HTTP_TIMEOUT_MS: numberValue(20000, 1000, 120000),
  HTTP_MAX_RETRIES: numberValue(4, 0, 10),
  NTFY_TOPIC_URL: z.string().url().optional().or(z.literal('')),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
}).superRefine((env, context) => {
  if (!env.PUBLIC_BASE_PATH.startsWith('/') || !env.PUBLIC_BASE_PATH.endsWith('/')) {
    context.addIssue({ code: 'custom', path: ['PUBLIC_BASE_PATH'], message: 'must start and end with /' });
  }
  if (env.GITHUB_REPOSITORY && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY)) {
    context.addIssue({ code: 'custom', path: ['GITHUB_REPOSITORY'], message: 'must have the form owner/repo' });
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(env.DATA_RELEASE_TAG)) {
    context.addIssue({ code: 'custom', path: ['DATA_RELEASE_TAG'], message: 'must be a valid short release tag' });
  }
  if (env.ENCRYPT_DATA && (!env.DATA_PASSPHRASE || env.DATA_PASSPHRASE.length < 16)) {
    context.addIssue({ code: 'custom', path: ['DATA_PASSPHRASE'], message: 'must be set and at least 16 characters when ENCRYPT_DATA=true' });
  }
  if (env.HOSTING_TARGET === 'cloudflare') {
    if (!env.CLOUDFLARE_API_TOKEN) context.addIssue({ code: 'custom', path: ['CLOUDFLARE_API_TOKEN'], message: 'is required for HOSTING_TARGET=cloudflare' });
    if (!env.CLOUDFLARE_ACCOUNT_ID) context.addIssue({ code: 'custom', path: ['CLOUDFLARE_ACCOUNT_ID'], message: 'is required for HOSTING_TARGET=cloudflare' });
  }
});

const publicBuildSchema = z.object({
  PUBLIC_BASE_PATH: z.string().refine((value) => value.startsWith('/') && value.endsWith('/'), 'must start and end with /'),
});

export type Env = z.infer<typeof envSchema>;

export function parsePublicBasePath(source: Record<string, string | undefined> = process.env): string {
  const result = publicBuildSchema.safeParse({ PUBLIC_BASE_PATH: source.PUBLIC_BASE_PATH || '/FundScope/' });
  if (!result.success) throw new Error(`Invalid public build configuration: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
  return result.data.PUBLIC_BASE_PATH;
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`);
    throw new Error(`Invalid FundScope environment:\n- ${problems.join('\n- ')}`);
  }
  return result.data;
}

export function redactedEnvSummary(env: Env): string[] {
  return [
    `HOSTING_TARGET: ${env.HOSTING_TARGET}`,
    `ENCRYPT_DATA: ${env.ENCRYPT_DATA}`,
    `DATA_PASSPHRASE: ${env.DATA_PASSPHRASE ? 'set (redacted)' : 'not set'}`,
    `GITHUB_REPOSITORY: ${env.GITHUB_REPOSITORY || 'not set'}`,
    `PUBLIC_BASE_PATH: ${env.PUBLIC_BASE_PATH}`,
    `MAX_SITE_SIZE_MB: ${env.MAX_SITE_SIZE_MB}`,
    `MAX_DB_SIZE_MB: ${env.MAX_DB_SIZE_MB}`,
    `ETL_BATCH_SIZE: ${env.ETL_BATCH_SIZE}`,
    `ETL_TIME_BUDGET_MINUTES: ${env.ETL_TIME_BUDGET_MINUTES}`,
  ];
}
