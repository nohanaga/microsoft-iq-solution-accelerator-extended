import { z } from 'zod';
import { analyticsConfig as configuration } from './connection-config';
import { assembleWorkspace } from './workspace-assembly';
import { getFabricClient } from './fabric-client';

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const configSchema = z.object({
  timestampOffset: z.string().regex(/^[+-](?:[01]\d|2[0-3]):[0-5]\d$/),
  tables: z.array(z.object({ name: identifier, source: z.enum(['operations', 'development', 'voices', 'chats', 'sentiments', 'metadata', 'predictions']), table: identifier, fields: z.array(identifier).min(1) })),
});
type TableConfig = z.infer<typeof configSchema>['tables'][number];
export type AnalyticsScope = 'voices' | 'full';

const voiceOperationTables = new Set([
  'products', 'stores', 'suppliers', 'customers', 'orders', 'orderLines', 'reviews', 'reviewTopics', 'serviceFeedback',
]);

function fieldName(columnName: string) {
  return columnName.match(/\[([^\]]+)\]$/)?.[1] ?? columnName;
}

function normalizeValue(field: string, value: unknown, timestampOffset: string) {
  if (field.endsWith('At') && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) {
    return `${value}${timestampOffset}`;
  }
  return value;
}

async function readTable(table: TableConfig, timestampOffset: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = await getFabricClient().semanticModel('maikuroV3Live')
    .query(`EVALUATE '${table.name}'`, { bypassCache: true });
  signal.throwIfAborted();
  if (result.status === 'error') {
    throw new Error(`Fabric Semantic Model の ${table.name} を取得できません: ${result.error.message}`);
  }
  const columnIndexes = new Map(result.table.columns.map((column, index) => [fieldName(column.name), index]));
  for (const field of table.fields) {
    if (!columnIndexes.has(field)) throw new Error(`Semantic Model の列が不足しています: ${table.name}.${field}`);
  }
  return result.table.rows.map(row => Object.fromEntries(table.fields.map(field => [
    field, normalizeValue(field, row[columnIndexes.get(field)!], timestampOffset),
  ])));
}

export async function readAnalyticsWorkspace(signal: AbortSignal, scope: AnalyticsScope = 'full') {
  const config = configSchema.parse(configuration);
  const tables = config.tables.filter(table => scope === 'voices'
    ? table.source === 'metadata' || ['voices', 'chats', 'sentiments'].includes(table.source)
      || table.source === 'operations' && voiceOperationTables.has(table.table)
    : table.source !== 'development' || ['plans', 'reservations', 'stocks'].includes(table.table));
  const staged: Record<string, Record<string, unknown>[]> = {};
  const controller = new AbortController();
  const requestSignal = AbortSignal.any([signal, controller.signal]);
  try {
    for (let offset = 0; offset < tables.length; offset += 4) {
      await Promise.all(tables.slice(offset, offset + 4).map(async table => {
        try {
          staged[table.name] = await readTable(table, config.timestampOffset, requestSignal);
        } catch (reason) {
          requestSignal.throwIfAborted();
          if (table.source !== 'predictions') throw reason;
          staged[table.name] = [];
          console.warn(`任意の予測テーブル ${table.name} を取得できないため、予測なしで画面表示を継続します。`, reason);
        }
      }));
    }
    requestSignal.throwIfAborted();
    const data = assembleWorkspace(tables, staged);
    if (scope === 'voices') {
      Object.assign(data.operations, { shipments: [], supplyImpacts: [] });
      Object.assign(data.predictions, { shipmentRisk: [], demandForecast: [], beanDepletion: [] });
      Object.assign(data.development, {
        products: [], materials: [], origins: [], suppliers: [], facilities: [], recipes: [], recipeLines: [], plans: [], reservations: [], stocks: [],
      });
    }
    return { data, source: 'fabric' as const, receivedAt: new Date().toISOString() };
  } finally { controller.abort(); }
}