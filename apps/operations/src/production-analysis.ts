import { z } from 'zod';

const id = z.string().min(1);
const timestamp = z.iso.datetime({ offset: true });
const units = z.number().int().safe().nonnegative();
const planSchema = z.object({ id, supplierId: id, productId: id, storeId: id, units: units.positive(), availableAt: timestamp });
const legacyProductionInputSchema = z.object({
  supplierId: id, delayHours: z.number().int().min(0).max(168),
  priority: z.enum(['vip', 'orders', 'amount']),
  recoveryHours: z.number().int().min(0).max(168),
}).refine(value => value.recoveryHours <= value.delayHours, '前倒し案の遅延時間は現在の遅延時間以内にしてください。');
const assessmentSchema = z.object({
  id: z.enum(['maintain', 'vip', 'recovery']), conditional: z.boolean(), affectedOrders: units,
  affectedVipOrders: units, unknownOrders: units, atRiskUnits: units,
  amountAtRisk: z.number().finite().nonnegative(), fulfilledOrders: units,
  rows: z.array(z.object({
    lineId: id, orderId: id, customerId: id, vip: z.boolean().nullable(), productId: id, storeId: id,
    planIds: z.array(id), quantity: units.positive(), dueAt: timestamp.nullable(), onTime: units.nullable(),
    late: units.nullable(), uncovered: units.nullable(), readyAt: timestamp.nullable(),
    amountAtRisk: z.number().finite().nonnegative().nullable(),
  })),
});
export const productionDecisionSchema = z.object({
  schemaVersion: z.literal(1), execution: z.literal('analysis-only'), recordedAt: timestamp,
  recordedBy: id, input: legacyProductionInputSchema, selected: z.enum(['maintain', 'vip', 'recovery']),
  rationale: z.string().trim().min(1).max(2000), nextAction: z.string().trim().min(1).max(1000),
  source: z.object({ datasetId: id, version: id, asOf: timestamp, receivedAt: timestamp,
    mode: z.enum(['live', 'memory']), scenarioVersion: id, inputFingerprint: id }),
  plans: z.array(planSchema), baseline: assessmentSchema, options: z.array(assessmentSchema).length(3),
}).superRefine((value, context) => {
  if (new Set(value.options.map(option => option.id)).size !== 3) context.addIssue({ code: 'custom', message: '対応案が重複しています。' });
  for (const option of [value.baseline, ...value.options]) {
    for (const row of option.rows) {
      if (row.onTime !== null && (row.late === null || row.uncovered === null || row.onTime + row.late + row.uncovered !== row.quantity)) {
        context.addIssue({ code: 'custom', message: '受注の数量内訳が一致しません。' });
      }
    }
  }
});
export type ProductionDecision = z.infer<typeof productionDecisionSchema>;

