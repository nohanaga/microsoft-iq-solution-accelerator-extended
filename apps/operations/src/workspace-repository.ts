import { z } from 'zod';
import { parseWorkspace, savedRecordSchema } from './workspace-schema';
import type { SavedRecord, WorkspaceData } from './workspace-schema';

export type DataMode = 'live' | 'memory';
export type WorkspaceLoadScope = 'voices' | 'full';
export interface GraphRequest { model: 'development' | 'supply'; tableId: string; recordId: string }
export interface GraphExpandRequest { model: 'development' | 'supply'; tableId: string; recordIds: string[]; limit: number }
export interface GraphResult {
  rows: Record<string, unknown>[]; graphId: string; retrievedAt: string; cacheHit?: boolean; truncated?: boolean;
  stale?: boolean; refreshing?: boolean; refreshError?: string; persistenceError?: string;
  source?: 'graph' | 'sql' | 'memory'; cacheOrigin?: 'graph' | 'sql'; persistence?: 'saving' | 'saved' | 'failed';
}
export interface WorkspaceRepository {
  mode: DataMode;
  load(signal: AbortSignal, scope?: WorkspaceLoadScope): Promise<{ data: WorkspaceData; source: string; receivedAt: string }>;
  listRecords(kind: SavedRecord['kind'], signal: AbortSignal): Promise<SavedRecord[]>;
  saveRecord(record: SavedRecord, signal: AbortSignal): Promise<SavedRecord>;
  graph(request: GraphRequest, signal: AbortSignal): Promise<GraphResult>;
  graphExpand(request: GraphExpandRequest, signal: AbortSignal): Promise<GraphResult>;
}
const records = new Map<string, SavedRecord>();
export function createWorkspaceRepository(mode: DataMode): WorkspaceRepository {
  if (mode === 'memory') return {
    mode,
    async load(signal) {
      const [operations, development, voices, chats, sentiments, predictions, allocation] = await Promise.all([
        import('../v3/data/operations.json'), import('../v3/data/development.json'), import('../v3/data/voice-sources.json'),
        import('../v3/data/ec-chat-history.json'), import('../v3/data/voice-sentiments.json'),
        import('../v3/data/predictions.json'),
        import('../v3/data/allocation.json'),
      ]);
      signal.throwIfAborted();
      return { data: parseWorkspace(structuredClone({ operations: operations.default, development: development.default,
        voices: voices.default, chats: chats.default, sentiments: sentiments.default,
        predictions: predictions.default, allocation: allocation.default })), source: 'memory', receivedAt: new Date().toISOString() };
    },
    async listRecords(kind, signal) { signal.throwIfAborted(); return structuredClone([...records.values()].filter(row => row.kind === kind).sort((first, second) => second.recordedAt.localeCompare(first.recordedAt))); },
    async saveRecord(record, signal) { signal.throwIfAborted(); const value = savedRecordSchema.parse(record); records.set(value.id, structuredClone(value)); return value; },
    async graph() { throw new Error('メモリーモードでは Fabric Graph を照会しません。'); },
    async graphExpand() { throw new Error('メモリーモードでは Fabric Graph を照会しません。'); },
  };
  return {
    mode,
    async load(signal, scope = 'full') {
      const { readAllocationData, readCommerceOrders, readDevelopmentMasters } = await import('./rayfin-client');
      const analytics = import('./analytics-data').then(module => module.readAnalyticsWorkspace(signal, scope));
      if (scope === 'voices') {
        const result = await analytics;
        return { ...result, data: parseWorkspace(result.data) };
      }
      const [response, masters, commerce, allocation] = await Promise.all([analytics, readDevelopmentMasters(signal), readCommerceOrders(signal), readAllocationData(signal)]);
      const result = z.object({ data: z.object({ development: z.record(z.string(), z.unknown()) }).passthrough(), source: z.literal('fabric'), receivedAt: z.iso.datetime({ offset: true }) }).parse(response);
      signal.throwIfAborted();
      const identifiedRow = z.object({ id: z.string() }).passthrough();
      const operations = z.object({ products: z.array(identifiedRow), orders: z.array(identifiedRow), orderLines: z.array(identifiedRow),
        customers: z.array(identifiedRow) }).passthrough().parse(result.data.operations);
      const productIds = new Set(operations.products.map(row => row.id));
      const commerceOrderIds = new Set(commerce.orders.map(row => row.id));
      const commerceLineIds = new Set(commerce.orderLines.map(row => row.id));
      const customerIds = new Set(operations.customers.map(row => row.id));
      const commerceCustomers = commerce.customers.filter(row => !customerIds.has(row.id));
      return { ...result, data: parseWorkspace({
        ...result.data,
        allocation,
        operations: {
          ...operations,
          products: [...operations.products, ...commerce.products.filter(row => !productIds.has(row.id))],
          customers: [...operations.customers, ...commerceCustomers],
          orders: [...operations.orders.filter(row => !commerceOrderIds.has(row.id)), ...commerce.orders],
          orderLines: [...operations.orderLines.filter(row => !commerceLineIds.has(row.id)), ...commerce.orderLines],
        },
        development: { ...result.data.development, ...masters },
      }) };
    },
    async listRecords(kind, signal) { return (await import('./rayfin-client')).readWorkspaceRecords(kind, signal); },
    async saveRecord(record, signal) { return (await import('./rayfin-client')).saveWorkspaceRecord(record, signal); },
    async graph(request, signal) { return (await import('./fabric-graph-client')).queryFabricGraph(request, signal); },
    async graphExpand(request, signal) { return (await import('./fabric-graph-client')).expandFabricGraph(request, signal); },
  };
}
export type GraphCacheState = Pick<GraphResult, 'stale' | 'refreshing' | 'refreshError' | 'persistenceError' | 'source' | 'cacheOrigin' | 'persistence'> & { sources?: NonNullable<GraphResult['source']>[] };