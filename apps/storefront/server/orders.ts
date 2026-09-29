import type { Express } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity';
import { entraTokenProvider } from '@azure/postgresql-auth';
import pg from 'pg';
import { z } from 'zod';
import type { Settings } from './config.js';

const orderRequestSchema = z.strictObject({
  orderId: z.uuid(),
  storeId: z.string().trim().min(1).max(128),
  pickupAt: z.iso.datetime({ offset: true }),
  items: z.array(z.strictObject({
    productId: z.string().trim().min(1).max(128),
    quantity: z.number().int().min(1).max(9),
  })).min(1).max(50),
}).superRefine((value, context) => {
  if (new Set(value.items.map(item => item.productId)).size !== value.items.length)
    context.addIssue({ code: 'custom', path: ['items'], message: '同じ商品が重複しています。' });
});

interface ProductRow {
  product_id: string;
  name: string;
  category: string;
  volume: string;
  supplier_id: string | null;
  price_ex_tax: number;
  tax_percent: string;
}

interface OrderRow {
  order_id: string;
  order_number: string;
  request_fingerprint: string;
  customer_id: string;
  store_id: string;
  store_name: string;
  ordered_at: Date;
  pickup_at: Date;
  received_at: Date | null;
  status: 'confirmed' | 'received' | 'cancelled';
  subtotal_ex_tax: number;
  tax_amount: number;
  total_amount: number;
}

interface OrderLineRow {
  order_line_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_ex_tax: number;
  tax_percent: string;
  subtotal_ex_tax: number;
  tax_amount: number;
  total_amount: number;
  category: string;
  volume: string;
  supplier_id: string | null;
}

class OrderApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function configured(settings: Settings) {
  return Boolean(settings.PGHOST && settings.PGDATABASE && settings.PGUSER &&
    (settings.PG_AUTH_MODE !== 'azure_cli' || settings.PG_TENANT_ID));
}

function fingerprint(input: z.infer<typeof orderRequestSchema>) {
  const normalized = {
    storeId: input.storeId,
    pickupAt: new Date(input.pickupAt).toISOString(),
    items: [...input.items].sort((first, second) => first.productId.localeCompare(second.productId)),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

async function readOrder(client: pg.PoolClient, orderId: string) {
  const orderResult = await client.query<OrderRow>(`
    SELECT o.order_id, o.order_number, o.request_fingerprint, o.customer_id,
           o.store_id, s.name AS store_name, o.ordered_at, o.pickup_at,
           o.received_at, o.status, o.subtotal_ex_tax, o.tax_amount, o.total_amount
    FROM maikuro.orders AS o
    JOIN maikuro.stores AS s ON s.store_id = o.store_id
    WHERE o.order_id = $1
  `, [orderId]);
  const row = orderResult.rows[0];
  if (!row) return null;
  const lineResult = await client.query<OrderLineRow>(`
        SELECT l.order_line_id, l.product_id, l.product_name, l.quantity, l.unit_price_ex_tax,
          l.tax_percent, l.subtotal_ex_tax, l.tax_amount, l.total_amount,
          p.category, p.volume, p.supplier_id
        FROM maikuro.order_lines AS l
        JOIN maikuro.products AS p ON p.product_id = l.product_id
        WHERE l.order_id = $1
    ORDER BY line_number
  `, [orderId]);
  return {
    fingerprint: row.request_fingerprint,
    order: {
      id: row.order_id,
      number: row.order_number,
      status: row.status === 'confirmed' ? 'ordered' : row.status,
      placedAt: row.ordered_at.toISOString(),
      pickupAt: row.pickup_at.toISOString(),
      receivedAt: row.received_at?.toISOString() ?? null,
      store: row.store_name,
      storeId: row.store_id,
      subtotalExTax: row.subtotal_ex_tax,
      taxAmount: row.tax_amount,
      total: row.total_amount,
      items: lineResult.rows.map(line => ({
        id: line.product_id,
        productName: line.product_name,
        quantity: line.quantity,
        lineId: line.order_line_id,
        unitPriceExTax: line.unit_price_ex_tax,
        taxPercent: Number(line.tax_percent),
        subtotalExTax: line.subtotal_ex_tax,
        taxAmount: line.tax_amount,
        total: line.total_amount,
        category: line.category,
        serving: line.volume,
        supplierId: line.supplier_id,
      })),
    },
  };
}

function rayfinPayload(eventId: string, eventType: string, saved: NonNullable<Awaited<ReturnType<typeof readOrder>>>) {
  const order = saved.order;
  return {
    eventId,
    eventType,
    occurredAt: new Date().toISOString(),
    order: {
      id: order.number,
      sourceOrderId: order.id,
      customerId: 'CUS-EC-GUEST',
      storeId: order.storeId,
      orderedAt: order.placedAt,
      pickupAt: order.pickupAt,
      fulfilledAt: order.receivedAt,
      status: order.status === 'ordered' ? 'confirmed' : order.status,
    },
    orderLines: order.items.map(line => ({
      id: line.lineId,
      orderId: order.number,
      productId: line.id,
      quantity: line.quantity,
      priceExTax: line.unitPriceExTax,
      taxPercent: line.taxPercent,
      discountExTax: 0,
    })),
    products: order.items.map(line => ({
      id: line.id,
      name: line.productName,
      category: line.category,
      serving: line.serving,
      priceExTax: line.unitPriceExTax,
      taxPercent: line.taxPercent,
      supplierId: line.supplierId,
    })),
  };
}

async function addOutboxEvent(client: pg.PoolClient, eventType: string, saved: NonNullable<Awaited<ReturnType<typeof readOrder>>>) {
  const eventId = randomUUID();
  await client.query(`
    INSERT INTO maikuro.rayfin_outbox (event_id, aggregate_id, event_type, payload)
    VALUES ($1, $2, $3, $4::jsonb)
    ON CONFLICT (aggregate_id, event_type) DO NOTHING
  `, [eventId, saved.order.id, eventType, JSON.stringify(rayfinPayload(eventId, eventType, saved))]);
}

export function registerOrders(app: Express, settings: Settings) {
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
      application_name: 'maikuro-ec-orders',
      options: '-c search_path=pg_catalog',
    });
    pool.on('error', () => console.warn('PostgreSQL orders: idle connection closed.'));
    return pool;
  }
  const getPool = async () => {
    if (!configured(settings)) throw new OrderApiError(503, 'PostgreSQL の接続設定が未完了です。');
    poolPromise ??= createPool().catch((error: unknown) => { poolPromise = undefined; throw error; });
    return poolPromise;
  };

  app.post('/api/orders', async (request, response) => {
    const parsed = orderRequestSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ detail: '注文内容を確認してください。' }); return; }
    const pickupAt = new Date(parsed.data.pickupAt);
    const now = new Date();
    if (pickupAt <= now || pickupAt.getTime() > now.getTime() + 14 * 24 * 60 * 60 * 1000) {
      response.status(400).json({ detail: '受取日時は現在から 14 日以内の将来日時を指定してください。' });
      return;
    }
    const requestFingerprint = fingerprint(parsed.data);
    let client: pg.PoolClient | undefined;
    try {
      client = await (await getPool()).connect();
      await client.query('BEGIN');
      const existing = await readOrder(client, parsed.data.orderId);
      if (existing) {
        if (existing.fingerprint !== requestFingerprint) throw new OrderApiError(409, '同じ注文 ID が異なる内容で使用されています。');
        await client.query('COMMIT');
        response.json({ order: existing.order, sync: { state: 'pending' } });
        return;
      }
      const store = await client.query<{ store_id: string }>(`
        SELECT store_id FROM maikuro.stores WHERE store_id = $1 FOR SHARE
      `, [parsed.data.storeId]);
      if (!store.rows[0]) throw new OrderApiError(400, '受取店舗を確認してください。');
      const productIds = parsed.data.items.map(item => item.productId);
      const products = await client.query<ProductRow>(`
        SELECT product_id, name, category, volume, supplier_id, price_ex_tax, tax_percent
        FROM maikuro.products
        WHERE product_id = ANY($1::text[])
        FOR SHARE
      `, [productIds]);
      if (products.rows.length !== productIds.length) throw new OrderApiError(400, '販売中の商品を確認してください。');
      const productMap = new Map(products.rows.map(product => [product.product_id, product]));
      const lines = parsed.data.items.map((item, index) => {
        const product = productMap.get(item.productId)!;
        const subtotalExTax = product.price_ex_tax * item.quantity;
        const taxPercent = Number(product.tax_percent);
        const taxAmount = Math.floor(subtotalExTax * Math.round(taxPercent * 100) / 10000);
        return { ...item, lineNumber: index + 1, lineId: randomUUID(), product,
          subtotalExTax, taxPercent, taxAmount, total: subtotalExTax + taxAmount };
      });
      const subtotalExTax = lines.reduce((total, line) => total + line.subtotalExTax, 0);
      const taxAmount = lines.reduce((total, line) => total + line.taxAmount, 0);
      const orderNumber = `MK-${parsed.data.orderId.replaceAll('-', '').toUpperCase()}`;
      await client.query(`
        INSERT INTO maikuro.orders (
          order_id, order_number, request_fingerprint, store_id, ordered_at, pickup_at,
          subtotal_ex_tax, tax_amount, total_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [parsed.data.orderId, orderNumber, requestFingerprint, parsed.data.storeId, now, pickupAt,
        subtotalExTax, taxAmount, subtotalExTax + taxAmount]);
      for (const line of lines) {
        await client.query(`
          INSERT INTO maikuro.order_lines (
            order_line_id, order_id, line_number, product_id, product_name, quantity,
            unit_price_ex_tax, tax_percent, subtotal_ex_tax, tax_amount, total_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [line.lineId, parsed.data.orderId, line.lineNumber, line.product.product_id,
          line.product.name, line.quantity, line.product.price_ex_tax, line.taxPercent,
          line.subtotalExTax, line.taxAmount, line.total]);
      }
      const saved = await readOrder(client, parsed.data.orderId);
      if (!saved) throw new Error('Order read-back failed.');
      await addOutboxEvent(client, 'order.confirmed', saved);
      await client.query('COMMIT');
      response.status(201).json({ order: saved.order, sync: { state: 'pending' } });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof OrderApiError) response.status(error.status).json({ detail: error.message });
      else {
        console.warn('PostgreSQL orders: write failed; check authentication, schema and network settings.');
        response.status(503).json({ detail: '注文を保存できませんでした。時間をおいてもう一度お試しください。' });
      }
    } finally { client?.release(); }
  });

  app.get('/api/orders/:orderId', async (request, response) => {
    const orderId = z.uuid().safeParse(request.params.orderId);
    if (!orderId.success) { response.status(400).json({ detail: '注文 ID を確認してください。' }); return; }
    let client: pg.PoolClient | undefined;
    try {
      client = await (await getPool()).connect();
      const saved = await readOrder(client, orderId.data);
      if (!saved) { response.status(404).json({ detail: '注文が見つかりません。' }); return; }
      response.json({ order: saved.order, sync: { state: 'pending' } });
    } catch (error) {
      const status = error instanceof OrderApiError ? error.status : 503;
      response.status(status).json({ detail: error instanceof OrderApiError ? error.message : '注文を取得できませんでした。' });
    } finally { client?.release(); }
  });

  app.post('/api/orders/:orderId/receive', async (request, response) => {
    const orderId = z.uuid().safeParse(request.params.orderId);
    if (!orderId.success) { response.status(400).json({ detail: '注文 ID を確認してください。' }); return; }
    let client: pg.PoolClient | undefined;
    try {
      client = await (await getPool()).connect();
      await client.query('BEGIN');
      const status = await client.query<{ status: string }>(`
        SELECT status FROM maikuro.orders WHERE order_id = $1 FOR UPDATE
      `, [orderId.data]);
      if (!status.rows[0]) throw new OrderApiError(404, '注文が見つかりません。');
      if (status.rows[0].status === 'cancelled') throw new OrderApiError(409, '取り消された注文は受取済みにできません。');
      if (status.rows[0].status === 'confirmed') await client.query(`
        UPDATE maikuro.orders
        SET status = 'received', received_at = CURRENT_TIMESTAMP
        WHERE order_id = $1
      `, [orderId.data]);
      const saved = await readOrder(client, orderId.data);
      if (!saved) throw new Error('Order read-back failed.');
      await addOutboxEvent(client, 'order.received', saved);
      await client.query('COMMIT');
      response.json({ order: saved.order, sync: { state: 'pending' } });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      const status = error instanceof OrderApiError ? error.status : 503;
      response.status(status).json({ detail: error instanceof OrderApiError ? error.message : '注文を更新できませんでした。' });
    } finally { client?.release(); }
  });

  return async () => {
    const pool = await poolPromise;
    await pool?.end();
  };
}