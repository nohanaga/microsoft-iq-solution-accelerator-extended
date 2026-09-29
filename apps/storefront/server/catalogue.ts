import type { Express } from 'express';
import { readFile } from 'node:fs/promises';
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity';
import { entraTokenProvider } from '@azure/postgresql-auth';
import pg from 'pg';
import type { Settings } from './config.js';

interface CatalogueRow {
  products: unknown[];
  stores: unknown[];
}

export function registerCatalogue(app: Express, settings: Settings) {
  let poolPromise: Promise<pg.Pool> | undefined;
  async function createPool() {
    const credential = settings.PG_AUTH_MODE === 'managed_identity'
      ? new ManagedIdentityCredential(settings.PG_MANAGED_IDENTITY_CLIENT_ID
        ? { clientId: settings.PG_MANAGED_IDENTITY_CLIENT_ID } : {})
      : new AzureCliCredential({ tenantId: settings.PG_TENANT_ID, processTimeoutInMs: 10000 });
    const ca = settings.PG_SSL_CA_FILE ? await readFile(settings.PG_SSL_CA_FILE, 'utf8') : undefined;
    const pool = new pg.Pool({
      host: settings.PGHOST,
      port: settings.PGPORT,
      database: settings.PGDATABASE,
      user: settings.PGUSER,
      password: entraTokenProvider(credential),
      ssl: { rejectUnauthorized: true, servername: settings.PGHOST, ...(ca ? { ca } : {}) },
      max: 2,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      maxLifetimeSeconds: 1800,
      statement_timeout: 10000,
      query_timeout: 20000,
      application_name: 'maikuro-ec-catalogue',
      options: '-c default_transaction_read_only=on -c search_path=pg_catalog',
    });
    pool.on('error', () => console.warn('PostgreSQL catalogue: idle connection closed.'));
    return pool;
  }

  app.get('/api/catalogue', async (request, response) => {
    if (request.get('sec-fetch-site') === 'cross-site') {
      response.status(403).json({ detail: '同じ画面からの接続のみ許可しています。' });
      return;
    }
    if (!settings.PGHOST || !settings.PGDATABASE || !settings.PGUSER ||
      (settings.PG_AUTH_MODE === 'azure_cli' && !settings.PG_TENANT_ID)) {
      response.status(503).json({ detail: 'PostgreSQL の接続設定が未完了です。' });
      return;
    }
    try {
      poolPromise ??= createPool().catch((error: unknown) => { poolPromise = undefined; throw error; });
      const pool = await poolPromise;
      const result = await pool.query<CatalogueRow>(`
        SELECT
          (SELECT COALESCE(json_agg(product ORDER BY display_order), '[]'::json)
           FROM (SELECT product, display_order FROM maikuro.ec_catalogue
                 ORDER BY display_order LIMIT 1001) AS catalogue) AS products,
          (SELECT COALESCE(json_agg(store ORDER BY store->>'id'), '[]'::json)
           FROM (SELECT json_build_object(
             'id', store_id, 'name', name, 'city', city,
             'coldEquipment', cold_equipment, 'cupsPerDay', cups_per_day
           ) AS store FROM maikuro.stores ORDER BY store_id LIMIT 1001) AS stores) AS stores
      `);
      const catalogue = result.rows[0];
      if (!catalogue || catalogue.products.length > 1000 || catalogue.stores.length > 1000)
        throw new Error('Catalogue exceeds the supported size.');
      response.json({ source: 'postgres', readAt: new Date().toISOString(), ...catalogue });
    } catch {
      console.warn('PostgreSQL catalogue: read failed; check server authentication, TLS and network settings.');
      response.status(503).json({ detail: 'PostgreSQL に接続できませんでした。サーバーの認証・接続設定をご確認ください。' });
    }
  });

  return async () => {
    const pool = await poolPromise;
    await pool?.end();
  };
}