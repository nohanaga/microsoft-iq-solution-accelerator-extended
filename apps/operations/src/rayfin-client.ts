import { RayfinClient } from '@microsoft/rayfin-client';
import { ensureSignedInWithFabric, initEmbeddedAuth } from '@microsoft/rayfin-auth-provider-fabric';
import type { Schema } from '../rayfin/data/schema';
import type { AppFunctionsSchema } from '../rayfin/functions/src/types';
import { allocationDataSchema, savedRecordSchema } from './workspace-schema';
import type { SavedRecord } from './workspace-schema';

type WorkspaceClient = RayfinClient<Schema, AppFunctionsSchema>;
let client: WorkspaceClient | undefined;
export function workspaceClient() {
  if (client) return client;
  const baseUrl = import.meta.env.VITE_RAYFIN_API_URL;
  const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;
  if (!baseUrl || !publishableKey) throw new Error('Rayfin の接続設定がありません。');
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== 'https:' || !['.pbidedicated.windows.net', '.rayfin.windows.net'].some(domain => endpoint.hostname.endsWith(domain))) throw new Error('Rayfin の接続先を確認してください。');
  client = new RayfinClient<Schema, AppFunctionsSchema>({ baseUrl, publishableKey, timeout: 30000 });
  return client;
}
function fabricOptions() {
  const workspaceId = import.meta.env.VITE_FABRIC_WORKSPACE_ID;
  const projectId = import.meta.env.VITE_FABRIC_ITEM_ID;
  if (!workspaceId || !projectId) throw new Error('Fabric のワークスペースとアプリの設定がありません。');
  return { workspaceId, projectId, fabricPortalUrl: 'https://app.fabric.microsoft.com', returnOrigin: window.location.origin };
}
export function signInToFabric() { return ensureSignedInWithFabric(workspaceClient().auth, fabricOptions()); }
let fabricInitialization: ReturnType<typeof initEmbeddedAuth> | undefined;
export function initializeFabricSession() {
  return fabricInitialization ??= initEmbeddedAuth(workspaceClient().auth, fabricOptions())
    .finally(() => { fabricInitialization = undefined; });
}
function authenticatedClient() {
  const current = workspaceClient();
  if (!current.auth.getSession().isAuthenticated) throw new Error('Fabric にサインインしてください。');
  return current;
}
interface PageQuery<Row> {
  after(cursor: string): PageQuery<Row>;
  executePaginated(): Promise<{ items: Row[]; hasNextPage: boolean; endCursor?: string | null }>;
}
export function normalizeTimestamp(value: unknown) {
  return value instanceof Date ? value.toISOString() : value;
}
function normalizeCommerceOrderStatus(status: string) {
  if (status === 'received') return 'completed' as const;
  if (status === 'confirmed' || status === 'cancelled') return status;
  throw new Error(`EC 受注の状態が不正です: ${status}`);
}
async function readPages<Row>(query: PageQuery<Row>, signal: AbortSignal) {
  const rows: Row[] = [];
  let cursor: string | undefined;
  for (;;) {
    signal.throwIfAborted();
    const page = await (cursor ? query.after(cursor) : query).executePaginated();
    signal.throwIfAborted();
    rows.push(...page.items);
    if (!page.hasNextPage) return rows;
    if (!page.endCursor || page.endCursor === cursor || rows.length > 100000) throw new Error('Rayfin のページ情報が不正です。');
    cursor = page.endCursor;
  }
}
export async function readDevelopmentMasters(signal: AbortSignal) {
  const data = authenticatedClient().data;
  const [origins, suppliers, materials, facilities, products, recipes, recipeLines] = await Promise.all([
    readPages(data.Origin.select(['id', 'businessId', 'name', 'region']).orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.Supplier.select(['id', 'businessId', 'name', 'city']).orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.Material.select(['id', 'businessId', 'name', 'originId', 'supplierId', 'specification', 'pricePerKg']).orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.Facility.select(['id', 'businessId', 'name']).orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.Product.select(['id', 'businessId', 'name', 'category', 'unit', 'gramsPerUnit']).orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.Recipe.select(['id', 'businessId', 'productId', 'name', 'status']).orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.RecipeLine.select(['id', 'businessId', 'recipeId', 'materialId', 'percent']).orderBy({ id: 'asc' }).first(100), signal),
  ]);
  const businessRows = <Row extends { businessId: string }>(rows: Row[]) => rows.map(row => ({ ...row, id: row.businessId }));
  return { origins: businessRows(origins), suppliers: businessRows(suppliers), materials: businessRows(materials),
    facilities: businessRows(facilities), products: businessRows(products), recipes: businessRows(recipes), recipeLines: businessRows(recipeLines) };
}
export async function readCommerceOrders(signal: AbortSignal) {
  const data = authenticatedClient().data;
  const [orders, orderLines, products, customers] = await Promise.all([
    readPages(data.EcOrder.select(['id', 'businessId', 'sourceOrderId', 'customerId', 'storeId', 'orderedAt', 'pickupAt', 'fulfilledAt', 'status'])
      .orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.EcOrderLine.select(['id', 'businessId', 'orderId', 'productId', 'quantity', 'priceExTax', 'taxPercent', 'discountExTax'])
      .orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.EcProduct.select(['id', 'businessId', 'name', 'category', 'serving', 'priceExTax', 'taxPercent', 'supplierId'])
      .orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.EcCustomer.select(['id', 'businessId', 'displayName', 'loyaltyTier']).orderBy({ id: 'asc' }).first(100), signal),
  ]);
  return {
    customers: customers.map(row => ({ id: row.businessId, displayName: row.displayName, loyaltyTier: row.loyaltyTier })),
    orders: orders.map(row => ({
      id: row.businessId, customerId: row.customerId, storeId: row.storeId,
      orderedAt: normalizeTimestamp(row.orderedAt), pickupAt: normalizeTimestamp(row.pickupAt),
      fulfilledAt: normalizeTimestamp(row.fulfilledAt) || null,
      status: normalizeCommerceOrderStatus(row.status),
    })),
    orderLines: orderLines.map(row => ({
      id: row.businessId, orderId: row.orderId, productId: row.productId,
      quantity: row.quantity, priceExTax: row.priceExTax,
      taxPercent: row.taxPercent, discountExTax: row.discountExTax,
    })),
    products: products.map(row => ({
      id: row.businessId, name: row.name, category: row.category, serving: row.serving,
      priceExTax: row.priceExTax, taxPercent: row.taxPercent, supplierId: row.supplierId || null,
    })),
  };
}
export async function readAllocationData(signal: AbortSignal) {
  const data = authenticatedClient().data;
  const scenarioId = 'maikuro-jp-v1:allocation-demo';
  const scenario = (await data.AllocationScenario.select(['businessId', 'version', 'asOf', 'dataOrigin'])
    .where({ businessId: { eq: scenarioId } }).first(1).execute())[0];
  signal.throwIfAborted();
  if (!scenario) throw new Error('引当シナリオが Rayfin に登録されていません。');
  const [customers, orders, orderLines, stocks] = await Promise.all([
    readPages(data.AllocationCustomer.select(['id', 'businessId', 'displayName', 'loyaltyTier'])
      .where({ scenarioId: { eq: scenarioId } }).orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.AllocationOrder.select(['id', 'businessId', 'customerId', 'storeId', 'orderedAt', 'pickupAt', 'fulfilledAt', 'status'])
      .where({ scenarioId: { eq: scenarioId } }).orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.AllocationOrderLine.select(['id', 'businessId', 'orderId', 'productId', 'quantity', 'priceExTax', 'taxPercent', 'discountExTax'])
      .where({ scenarioId: { eq: scenarioId } }).orderBy({ id: 'asc' }).first(100), signal),
    readPages(data.AllocationStock.select(['id', 'businessId', 'storeId', 'productId', 'onHand'])
      .where({ scenarioId: { eq: scenarioId } }).orderBy({ id: 'asc' }).first(100), signal),
  ]);
  const businessRows = <Row extends { businessId: string }>(rows: Row[]) => rows.map(row => ({ ...row, id: row.businessId }));
  return allocationDataSchema.parse({ datasetId: scenario.businessId, version: scenario.version,
    asOf: normalizeTimestamp(scenario.asOf), dataOrigin: scenario.dataOrigin,
    customers: businessRows(customers), orderLines: businessRows(orderLines), stocks: businessRows(stocks),
    orders: businessRows(orders).map(row => ({ ...row, orderedAt: normalizeTimestamp(row.orderedAt),
      pickupAt: normalizeTimestamp(row.pickupAt), fulfilledAt: normalizeTimestamp(row.fulfilledAt) || null })),
  });
}

export async function readWorkspaceRecords(kind: SavedRecord['kind'], signal: AbortSignal) {
  const query = authenticatedClient().data.WorkspaceRecord.select(['id', 'kind', 'recordedAt', 'datasetVersion', 'payload'])
    .where({ kind: { eq: kind } }).orderBy({ id: 'asc' }).first(100);
  return (await readPages(query, signal)).map(row => savedRecordSchema.parse({
    ...row, recordedAt: normalizeTimestamp(row.recordedAt), payload: JSON.parse(row.payload),
  }))
    .sort((first, second) => second.recordedAt.localeCompare(first.recordedAt));
}
export async function saveWorkspaceRecord(input: SavedRecord, signal: AbortSignal) {
  const record = savedRecordSchema.parse(input);
  const collection = authenticatedClient().data.WorkspaceRecord;
  const readRecord = async () => {
    signal.throwIfAborted();
    const rows = await collection.select(['id', 'kind', 'recordedAt', 'datasetVersion', 'payload'])
      .where({ id: { eq: record.id } }).first(1).execute();
    signal.throwIfAborted();
    return rows[0] ? savedRecordSchema.parse({
      ...rows[0], recordedAt: normalizeTimestamp(rows[0].recordedAt), payload: JSON.parse(rows[0].payload),
    }) : null;
  };
  signal.throwIfAborted();
  const existing = await readRecord();
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('同じ ID の異なる保存記録が存在します。');
    return existing;
  }
  await collection.create({ ...record, payload: JSON.stringify(record.payload) });
  const saved = await readRecord();
  if (!saved || JSON.stringify(saved) !== JSON.stringify(record)) throw new Error('保存記録の読み戻しが一致しません。再取得して確認してください。');
  return saved;
}