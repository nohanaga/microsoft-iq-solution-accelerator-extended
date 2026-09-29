import { config } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

export function loadSettings(root: string) {
  config({ path: [path.join(root, '.env'), path.join(root, '.env.postgres.local')], quiet: true });
  return z.object({
    PORT: z.coerce.number().int().min(1024).max(65535).default(5180),
    AZURE_OPENAI_ENDPOINT: z.string().trim().default(''),
    AZURE_OPENAI_DEPLOYMENT_NAME: z.string().trim().default(''),
    AZURE_OPENAI_API_KEY: z.string().trim().default(''),
    AZURE_OPENAI_AUTH_MODE: z.enum(['entra_id', 'api_key']).default('entra_id'),
    VOICE_LIVE_JEV_ENABLED: z.string().default('false').transform(value => value === 'true'),
    AZURE_GPT_LIVE_ENDPOINT: z.string().trim().default(''),
    AZURE_GPT_LIVE_DEPLOYMENT_NAME: z.string().trim().default(''),
    AZURE_GPT_LIVE_AUTH_MODE: z.string().trim().default('entra_id'),
    AZURE_GPT_LIVE_API_KEY: z.string().trim().default(''),
    TYPESAFE_API_KEY: z.string().trim().default(''),
    TYPESAFE_MODEL: z.string().trim().default('jev-1.13.0'),
    BARISTA_AGENT_ENDPOINT: z.string().trim().default(''),
    BARISTA_AGENT_DEPLOYMENT: z.string().trim().default(''),
    BARISTA_AGENT_PYTHON: z.string().trim().default(''),
    PGHOST: z.string().trim().default(''),
    PGPORT: z.coerce.number().int().min(1).max(65535).default(5432),
    PGDATABASE: z.string().trim().default(''),
    PGUSER: z.string().trim().default(''),
    PG_AUTH_MODE: z.enum(['azure_cli', 'managed_identity']).default('azure_cli'),
    PG_TENANT_ID: z.string().trim().default(''),
    PG_MANAGED_IDENTITY_CLIENT_ID: z.string().trim().default(''),
    PG_SSL_CA_FILE: z.string().trim().default(''),
  }).parse(process.env);
}

export type Settings = ReturnType<typeof loadSettings>;