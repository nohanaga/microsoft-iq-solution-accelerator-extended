import { z } from 'zod';
import { developmentDefinition, supplyDefinition, validateOntologyData } from '../v3/ontology/model';
import type { Dataset } from './domain';
import type { BlendDataset } from './blend-workbench-model';
import { productionDecisionSchema } from './production-analysis';
import { materialResponseContextSchema } from './material-outlook';

const id = z.string().min(1);
const number = z.number().finite();
const integer = z.number().int().safe();
const timestamp = z.iso.datetime({ offset: true });
const sentiment = z.enum(['positive', 'neutral', 'negative']);
const metadata = { datasetId: id, version: id, asOf: timestamp, dataOrigin: z.literal('synthetic') };
export const operationSchemas = {
  products: z.object({ id, name: id, category: id, serving: id, priceExTax: number, taxPercent: number, supplierId: id.nullable() }),
  stores: z.object({ id, name: id, city: id, coldEquipment: z.boolean().nullable(), cupsPerDay: number.nullable() }),
  suppliers: z.object({ id, name: id, city: id }),
  customers: z.object({ id, displayName: id, loyaltyTier: id }),
  orders: z.object({ id, customerId: id, storeId: id, orderedAt: timestamp, pickupAt: timestamp.optional(), fulfilledAt: timestamp.nullable(), status: z.enum(['confirmed', 'completed', 'cancelled', 'delayed']) }),
  orderLines: z.object({ id, orderId: id, productId: id, quantity: integer, priceExTax: number, taxPercent: number, discountExTax: number }),
  reviews: z.object({ id, lineId: id, customerId: id, revision: integer.positive(), rating: integer.min(1).max(5), text: id, publishedAt: timestamp, analyzedAt: timestamp.nullable(), status: z.enum(['published', 'pending', 'withdrawn']) }),
  reviewTopics: z.object({ id, reviewId: id, revision: integer.positive(), topic: id, classifierVersion: id }),
  serviceFeedback: z.object({ id, orderId: id, rating: integer.min(1).max(5), text: id, dissatisfied: z.boolean(), publishedAt: timestamp }),
  shipments: z.object({ id, supplierId: id, storeId: id, expectedAt: timestamp, arrivedAt: timestamp.nullable(), status: z.enum(['arrived', 'delayed']), reason: z.string() }),
  supplyImpacts: z.object({ id, shipmentId: id, lineId: id, productId: id, shortageAt: timestamp, evidence: id }),
};
export const allocationDataSchema = z.object({ ...metadata,
  customers: z.array(operationSchemas.customers).min(1), orders: z.array(operationSchemas.orders).min(1),
  orderLines: z.array(operationSchemas.orderLines).min(1),
  stocks: z.array(z.object({ id, storeId: id, productId: id, onHand: integer.nonnegative() })).min(1),
});
export const developmentSchemas = {
  products: z.object({ id, name: id, category: z.enum(['beverage', 'blend']), unit: id, gramsPerUnit: number.positive() }),
  materials: z.object({ id, name: id, originId: id, supplierId: id, specification: id, pricePerKg: number.nonnegative() }),
  origins: z.object({ id, name: id, region: id }),
  suppliers: z.object({ id, name: id, city: id }),
  facilities: z.object({ id, name: id }),
  recipes: z.object({ id, productId: id, name: id, status: id }),
  recipeLines: z.object({ id, recipeId: id, materialId: id, percent: number.positive().max(100) }),
  plans: z.object({ id, productId: id, recipeId: id, facilityId: id, units: integer.positive(), status: id }),
  reservations: z.object({ id, planId: id, materialId: id, grams: number.nonnegative() }),
  stocks: z.object({ id, materialId: id, facilityId: id, grams: number.nonnegative().nullable() }),
};
export const voiceEntrySchema = z.object({ id, source: z.enum(['survey', 'social']), revision: integer.positive(), productId: id,
  storeId: id.nullable(), rating: number.nullable(), text: id, topics: z.array(id), publishedAt: timestamp,
  analyzedAt: timestamp.nullable(), status: z.enum(['published', 'pending', 'withdrawn']) });
export const chatMessageSchema = z.object({ id, role: z.enum(['customer', 'assistant']), text: id, sentAt: timestamp, productId: id.nullable(), topics: z.array(id) });
export const chatConversationSchema = z.object({ id, storeId: id.nullable(), channel: z.enum(['text', 'voice']),
  status: z.enum(['included', 'withdrawn']), analyzedAt: timestamp.nullable(), messages: z.array(chatMessageSchema) });
export const sentimentSchema = z.object({ voiceId: id, text: id, overall: sentiment, topics: z.record(z.string(), sentiment) });
// 予測は Fabric の gold テーブル由来です。日時は Semantic Model が返す素の文字列を保持します。
export const predictionSchemas = {
  shipmentRisk: z.object({ shipmentId: id, supplierId: id, storeId: id, isValidation: z.boolean(),
    delayProbability: number, predictedDelayHours: number, shortageProbability: number, jointShortageProbability: number,
    expectedLossExTax: number, expectedImpactedLines: number, actualDelayed: z.boolean(), actualShortage: z.boolean(),
    actualAmountExTax: number, modelVersion: id }),
  demandForecast: z.object({ date: id, storeId: id, productId: id, category: id, yhat: number,
    yhatLower: number, yhatUpper: number, horizonDay: integer, modelVersion: id }),
  beanDepletion: z.object({ materialId: id, closingGrams: number, reservedGrams: number, availableGrams: number,
    meanDailyGrams: number, coverDays: number.nullable(), depletionDate: id.nullable(), depletionDayIndex: integer.nullable(),
    withinHorizon: z.boolean(), horizonDays: integer, modelVersion: id }),
};
const predictionsSchema = z.object({
  shipmentRisk: z.array(predictionSchemas.shipmentRisk).default([]),
  demandForecast: z.array(predictionSchemas.demandForecast).default([]),
  beanDepletion: z.array(predictionSchemas.beanDepletion).default([]),
}).default({ shipmentRisk: [], demandForecast: [], beanDepletion: [] });
const operationsSchema = z.object({ ...metadata, timezone: id,
  products: z.array(operationSchemas.products), stores: z.array(operationSchemas.stores), suppliers: z.array(operationSchemas.suppliers),
  customers: z.array(operationSchemas.customers), orders: z.array(operationSchemas.orders), orderLines: z.array(operationSchemas.orderLines),
  reviews: z.array(operationSchemas.reviews), reviewTopics: z.array(operationSchemas.reviewTopics), serviceFeedback: z.array(operationSchemas.serviceFeedback),
  shipments: z.array(operationSchemas.shipments), supplyImpacts: z.array(operationSchemas.supplyImpacts) });
const developmentSchema = z.object({ ...metadata,
  products: z.array(developmentSchemas.products), materials: z.array(developmentSchemas.materials), origins: z.array(developmentSchemas.origins),
  suppliers: z.array(developmentSchemas.suppliers), facilities: z.array(developmentSchemas.facilities), recipes: z.array(developmentSchemas.recipes),
  recipeLines: z.array(developmentSchemas.recipeLines), plans: z.array(developmentSchemas.plans), reservations: z.array(developmentSchemas.reservations), stocks: z.array(developmentSchemas.stocks) });
export const workspaceSchema = z.object({
  operations: operationsSchema,
  allocation: allocationDataSchema.optional(),
  development: developmentSchema,
  voices: z.object({ ...metadata, entries: z.array(voiceEntrySchema) }),
  chats: z.object({ ...metadata, conversations: z.array(chatConversationSchema) }),
  sentiments: z.object({ datasetId: id, version: id, entries: z.array(sentimentSchema) }),
  predictions: predictionsSchema,
});
export type WorkspaceInput = z.infer<typeof workspaceSchema>;
export interface WorkspaceData extends Omit<WorkspaceInput, 'operations' | 'development'> { operations: Dataset; development: BlendDataset }

export function parseWorkspace(input: unknown): WorkspaceData {
  const data = workspaceSchema.parse(input);
  const problems = [...validateOntologyData(developmentDefinition, data.development), ...validateOntologyData(supplyDefinition, data.operations)];
  if (data.allocation) {
    const registered = { ...data.operations, ...data.allocation, shipments: [], supplyImpacts: [] };
    problems.push(...validateOntologyData({ ...supplyDefinition, datasetId: registered.datasetId }, registered));
    const pools = new Set<string>();
    const stockIds = new Set<string>();
    for (const stock of data.allocation.stocks) {
      const pool = JSON.stringify([stock.storeId, stock.productId]);
      if (pools.has(pool) || stockIds.has(stock.id)
        || !data.operations.stores.some(row => row.id === stock.storeId)
        || !data.operations.products.some(row => row.id === stock.productId)) throw new Error('登録在庫のキー・参照が不正です。');
      pools.add(pool); stockIds.add(stock.id);
    }
  }
  if (problems.length) throw new Error(`Ontology data validation failed: ${JSON.stringify(problems.slice(0, 3))}`);
  if ([data.voices, data.chats, data.sentiments].some(source => source.datasetId !== data.operations.datasetId)) throw new Error('Workspace dataset mismatch');
  for (const [table, rows] of Object.entries(data.operations)) {
    if (!Array.isArray(rows)) continue;
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error(`Duplicate key: ${table}`);
  }
  const references = [
    [data.operations.reviews, 'lineId', data.operations.orderLines],
    [data.operations.reviews, 'customerId', data.operations.customers],
    [data.operations.reviewTopics, 'reviewId', data.operations.reviews],
    [data.operations.serviceFeedback, 'orderId', data.operations.orders],
    [data.voices.entries, 'productId', data.operations.products],
  ] as const;
  for (const [rows, column, targets] of references) {
    const keys = new Set(targets.map(row => row.id));
    if (rows.some(row => !keys.has(String((row as Record<string, unknown>)[column])))) throw new Error(`Orphan reference: ${column}`);
  }
  for (const recipe of data.development.recipes) {
    const lines = data.development.recipeLines.filter(row => row.recipeId === recipe.id);
    if (!lines.length || Math.abs(lines.reduce((sum, row) => sum + row.percent, 0) - 100) > .001) throw new Error(`Invalid recipe total: ${recipe.id}`);
  }
  return { ...data, operations: { ...data.operations, allocation: data.allocation, materials: [], offers: [], concepts: [], recipeLines: [], currentRecipes: [], inventory: [], inbound: [], evidence: [], rules: [], decisionReasons: [] } };
}

export const scenarioSchema = z.object({ productId: id, recipeId: id, facilityId: id, units: integer.positive().max(10000),
  custom: z.array(z.object({ materialId: id, percent: number.positive().max(100) })).nullable() });
export const supplyCaseSchema = z.object({
  id: z.uuid(), datasetVersion: id, baseline: scenarioSchema, proposal: scenarioSchema,
  assumption: z.object({ enabled: z.boolean(), supplierId: id, from: z.iso.date(), to: z.iso.date(), reason: z.string().max(1000) }),
  rationale: z.string().max(2000),
  outlook: materialResponseContextSchema.optional(),
});
const supplyAssessmentSchema = z.object({
  status: z.enum(['shortage', 'unknown', 'within-stock']), shortageGrams: number.nonnegative(), unknownCount: integer.nonnegative(),
  totalCost: number.nonnegative(), costPerUnit: number.nonnegative(), remainingGrams: number.nonnegative().nullable(),
  exposedMaterialIds: z.array(id), exposedShortageGrams: number.nonnegative(), unknowns: z.array(id),
  requirements: z.array(z.object({ materialId: id, percent: number, requiredGrams: number, stockGrams: number.nullable(), reservedGrams: number, availableGrams: number.nullable(), shortageGrams: number.nullable() })),
});
export const supplyDecisionSchema = z.object({
  schemaVersion: z.literal(1), status: z.literal('draft'), case: supplyCaseSchema,
  datasetId: id, asOf: timestamp, receivedAt: timestamp, recordedAt: timestamp,
  executionMode: z.enum(['live', 'memory']), recordedBy: z.string().trim().min(1).max(128),
  comparison: z.object({ baseline: supplyAssessmentSchema, suspended: supplyAssessmentSchema, proposal: supplyAssessmentSchema }),
  graph: z.object({ graphIds: z.record(z.string(), id), retrievedAt: timestamp, truncated: z.boolean(),
    missingScopeIds: z.array(id), nodeIds: z.array(id), derivedEdgeIds: z.array(id) }).nullable(),
}).superRefine((value, context) => {
  if (!value.case.rationale.trim()) context.addIssue({ code: 'custom', message: '選択理由が必要です。', path: ['case', 'rationale'] });
  if (value.case.baseline.productId !== value.case.proposal.productId) context.addIssue({ code: 'custom', message: '比較する商品を揃えてください。', path: ['case', 'proposal'] });
  if (value.case.assumption.enabled && (!value.case.assumption.reason.trim() || value.case.assumption.from > value.case.assumption.to)) context.addIssue({ code: 'custom', message: '停止仮定の理由・期間を確認してください。', path: ['case', 'assumption'] });
});
export const allocationSnapshotSchema = z.object({
  schemaVersion: z.literal(1), execution: z.literal('demo'), recordedAt: timestamp,
  state: z.object({ source: z.enum(['workspace', 'demo']), datasetId: id, datasetVersion: id, supplierId: id, stopped: z.boolean(), stoppedSupplierIds: z.array(id).optional(), vipTiers: z.array(id),
    stocks: z.array(z.object({ storeId: id, productId: id, onHand: integer.nonnegative().nullable() })),
    allocations: z.array(z.object({ lineId: id, quantity: integer.positive() })),
    events: z.array(z.object({ id: z.uuid(), recordedAt: timestamp, type: z.enum(['reserve', 'release']), lineId: id, quantity: integer.positive() })),
  }),
  data: z.object({ datasetId: id, version: id, asOf: timestamp, products: z.array(operationSchemas.products), stores: z.array(operationSchemas.stores),
    customers: z.array(operationSchemas.customers), orders: z.array(operationSchemas.orders), orderLines: z.array(operationSchemas.orderLines) }),
}).superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  if (value.state.datasetId !== value.data.datasetId || value.state.datasetVersion !== value.data.version) fail('引当記録の基準データが一致しません。');
  if (new Set(value.state.allocations.map(row => row.lineId)).size !== value.state.allocations.length) fail('同じ明細の引当が重複しています。');
  if (new Set(value.state.stocks.map(row => JSON.stringify([row.storeId, row.productId]))).size !== value.state.stocks.length) fail('商品在庫が重複しています。');
  for (const allocation of value.state.allocations) {
    const line = value.data.orderLines.find(row => row.id === allocation.lineId);
    const order = value.data.orders.find(row => row.id === line?.orderId);
    if (!line || !order || !['confirmed', 'delayed'].includes(order.status) || order.fulfilledAt || allocation.quantity > line.quantity) { fail('引当対象の受注明細が不正です。'); continue; }
    const stock = value.state.stocks.find(row => row.storeId === order.storeId && row.productId === line.productId);
    if (stock?.onHand == null) fail('引当済み商品の在庫が未確認です。');
  }
  for (const stock of value.state.stocks) {
    const lines = value.data.orderLines.filter(line => line.productId === stock.productId && value.data.orders.some(order => order.id === line.orderId && order.storeId === stock.storeId));
    const reserved = value.state.allocations.filter(row => lines.some(line => line.id === row.lineId)).reduce((total, row) => total + row.quantity, 0);
    if (stock.onHand !== null && reserved > stock.onHand) fail('商品在庫を超える引当です。');
  }
});

export const savedRecordSchema = z.object({ id: z.uuid(), kind: z.enum(['beverage', 'blend', 'alerts', 'supply', 'allocation', 'production']), recordedAt: timestamp,
  datasetVersion: id, payload: z.record(z.string(), z.unknown()) }).superRefine((value, context) => {
    if (value.kind === 'production') {
      const parsed = productionDecisionSchema.safeParse(value.payload);
      if (!parsed.success) context.addIssue({ code: 'custom', message: '生産計画分析の記録が不正です。', path: ['payload'] });
      else if (parsed.data.source.version !== value.datasetVersion || parsed.data.recordedAt !== value.recordedAt) context.addIssue({ code: 'custom', message: '分析記録の版・日時が一致しません。', path: ['payload'] });
      return;
    }
    if (value.kind === 'allocation') {
      const parsed = allocationSnapshotSchema.safeParse(value.payload);
      if (!parsed.success) context.addIssue({ code: 'custom', message: '引当記録の形式・数量が不正です。', path: ['payload'] });
      else if (parsed.data.state.datasetVersion !== value.datasetVersion || parsed.data.recordedAt !== value.recordedAt) context.addIssue({ code: 'custom', message: '引当記録の版・日時が一致しません。', path: ['payload'] });
      return;
    }
    if (value.kind !== 'supply') return;
    const parsed = supplyDecisionSchema.safeParse(value.payload);
    if (!parsed.success) context.addIssue({ code: 'custom', message: '供給判断記録の形式・版が不正です。', path: ['payload'] });
    else if (parsed.data.case.datasetVersion !== value.datasetVersion || parsed.data.recordedAt !== value.recordedAt) context.addIssue({ code: 'custom', message: '保存記録の版・日時が一致しません。', path: ['payload'] });
  });
export type SavedRecord = z.infer<typeof savedRecordSchema>;