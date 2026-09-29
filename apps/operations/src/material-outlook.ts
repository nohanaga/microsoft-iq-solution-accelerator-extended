import { z } from 'zod';
import type { BlendScenario } from './blend-workbench-model';
import type { WorkspaceData } from './workspace-schema';

const id = z.string().trim().min(1).max(500);
const date = z.iso.date();
const reference = z.object({ datasetId: id, version: id });
const mappingSchema = z.object({
  id, productId: id, storeId: id, developmentProductId: id, recipeId: id, facilityId: id,
  unitsPerSale: z.number().finite().positive(), leadDays: z.number().int().min(0).max(365),
  validFrom: date, validTo: date, confirmed: z.literal(true), evidence: id,
}).refine(value => value.validFrom <= value.validTo, '対応の有効期間が逆転しています。');

export const materialOutlookInputSchema = z.object({
  schemaVersion: z.literal(1), source: id, confirmedAt: z.iso.datetime({ offset: true }),
  operations: reference, development: reference.extend({ asOf: z.iso.datetime({ offset: true }) }),
  forecastModelVersion: id,
  demandBasis: z.literal('additional-to-protected-plans'), demandBasisEvidence: id,
  leadTimeBasis: z.literal('calendar-days'),
  mappings: z.array(mappingSchema).max(2000),
  receipts: z.array(z.object({ id, materialId: id, facilityId: id, usableOn: date,
    grams: z.number().finite().positive(), confirmed: z.boolean(), evidence: id })).max(5000),
  receiptCoverage: z.array(z.object({ materialId: id, facilityId: id, from: date, to: date, evidence: id })
    .refine(value => value.from <= value.to, '入荷確認期間が逆転しています。')).max(2000),
});
export type MaterialOutlookInput = z.infer<typeof materialOutlookInputSchema>;
export type MaterialMapping = MaterialOutlookInput['mappings'][number];
export const materialResponseContextSchema = z.object({ materialId: id, date,
  basis: z.object({ source: id, mappingId: id, evidence: id, modelVersion: id, salesDate: date, productId: id, storeId: id,
    forecastUnits: z.number().finite().nonnegative(), productionUnits: z.number().finite().positive() }),
});
export type MaterialResponseContext = z.infer<typeof materialResponseContextSchema>;
export type OutlookForecast = WorkspaceData['predictions']['demandForecast'][number];
export interface OutlookDemand {
  key: string; salesDate: string; neededOn: string; productId: string; storeId: string;
  forecastUnits: number; productionUnits: number; mapping: MaterialMapping;
  materials: { materialId: string; grams: number }[];
}
export interface OutlookExclusion { key: string; productId: string; storeId: string; date: string; reason: string }
export interface MaterialOutlookCell {
  key: string; materialId: string; facilityId: string; date: string;
  requiredGrams: number; openingGrams: number | null; receiptGrams: number | null;
  availableGrams: number | null; closingGrams: number | null; shortageGrams: number | null;
  demands: OutlookDemand[];
}
export interface MaterialOutlook {
  input: MaterialOutlookInput | null; dates: string[]; demands: OutlookDemand[];
  cells: MaterialOutlookCell[]; excluded: OutlookExclusion[]; error: string;
}
export interface MaterialOutlookSelection { materialId: string; facilityId: string; date: string }
export interface MaterialResponseRequest extends MaterialResponseContext {
  supplierId: string; scenario: BlendScenario;
}

export function outlookDate(value: string): string {
  const text = value.slice(0, 10);
  return date.safeParse(text).success ? text : '';
}
const shiftDate = (value: string, days: number) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const businessDate = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const forecastKey = (row: OutlookForecast) => JSON.stringify([row.modelVersion, row.productId, row.storeId, outlookDate(row.date)]);

export function materialOutlookTemplate(data: WorkspaceData): MaterialOutlookInput {
  return { schemaVersion: 1, source: '', confirmedAt: '',
    operations: { datasetId: data.operations.datasetId, version: data.operations.version },
    development: { datasetId: data.development.datasetId, version: data.development.version, asOf: data.development.asOf },
    forecastModelVersion: '', demandBasis: 'additional-to-protected-plans', demandBasisEvidence: '', leadTimeBasis: 'calendar-days',
    mappings: [], receipts: [], receiptCoverage: [] };
}

export function calculateMaterialOutlook(data: WorkspaceData, raw: MaterialOutlookInput | null): MaterialOutlook {
  const forecasts = data.predictions.demandForecast;
  const result: MaterialOutlook = { input: null, dates: [], demands: [], cells: [], excluded: [], error: '' };
  const exclude = (row: OutlookForecast, reason: string) => result.excluded.push({ key: forecastKey(row), productId: row.productId, storeId: row.storeId, date: row.date, reason });
  if (!raw) {
    forecasts.forEach(row => exclude(row, '確認済みの商品・配合対応が未登録'));
    return result;
  }
  try {
    const input = materialOutlookInputSchema.parse(raw);
    const development = data.development;
    if (input.operations.datasetId !== data.operations.datasetId || input.operations.version !== data.operations.version
      || input.development.datasetId !== development.datasetId || input.development.version !== development.version
      || Date.parse(input.development.asOf) !== Date.parse(development.asOf)) throw new Error('対応データと取得済み原本の版・在庫基準日時が一致しません。');
    if (new Set(input.mappings.map(row => row.id)).size !== input.mappings.length
      || new Set(input.receipts.map(row => row.id)).size !== input.receipts.length) throw new Error('対応または入荷予定の ID が重複しています。');
    for (const mapping of input.mappings) {
      if (!data.operations.products.some(row => row.id === mapping.productId)
        || !data.operations.stores.some(row => row.id === mapping.storeId)
        || !development.products.some(row => row.id === mapping.developmentProductId)
        || !development.recipes.some(row => row.id === mapping.recipeId && row.productId === mapping.developmentProductId)
        || !development.facilities.some(row => row.id === mapping.facilityId)) throw new Error(`対応の参照先が未登録です: ${mapping.id}`);
      if (input.mappings.some(other => other.id !== mapping.id && other.productId === mapping.productId && other.storeId === mapping.storeId
        && other.validFrom <= mapping.validTo && mapping.validFrom <= other.validTo)) throw new Error(`同じ商品・店舗の対応期間が重複しています: ${mapping.id}`);
    }
    for (const entry of [...input.receipts, ...input.receiptCoverage]) {
      if (!development.materials.some(row => row.id === entry.materialId) || !development.facilities.some(row => row.id === entry.facilityId)) throw new Error('入荷予定・確認範囲の材料または拠点が未登録です。');
    }
    const counts = new Map<string, number>();
    for (const row of forecasts) counts.set(forecastKey(row), (counts.get(forecastKey(row)) ?? 0) + 1);
    const asOf = businessDate(development.asOf);
    for (const row of forecasts) {
      const salesDate = outlookDate(row.date);
      if (row.modelVersion !== input.forecastModelVersion) { exclude(row, '選択された予測モデル版と不一致'); continue; }
      if (!salesDate || !Number.isFinite(row.yhat) || row.yhat < 0 || counts.get(forecastKey(row)) !== 1) { exclude(row, '予測の日付・数量が不正、または同一キーが重複'); continue; }
      const mapping = input.mappings.find(candidate => candidate.productId === row.productId && candidate.storeId === row.storeId && candidate.validFrom <= salesDate && salesDate <= candidate.validTo);
      if (!mapping) { exclude(row, 'この商品・店舗・日付の確認済み対応なし'); continue; }
      const neededOn = shiftDate(salesDate, -mapping.leadDays);
      if (neededOn <= asOf) { exclude(row, '材料必要日が在庫基準日以前'); continue; }
      if (Date.parse(`${neededOn}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`) > 366 * 86400000) { exclude(row, '見通しは在庫基準日の翌日から366日以内'); continue; }
      const product = development.products.find(candidate => candidate.id === mapping.developmentProductId)!;
      const lines = development.recipeLines.filter(line => line.recipeId === mapping.recipeId);
      if (!lines.length || new Set(lines.map(line => line.materialId)).size !== lines.length
        || lines.some(line => !Number.isFinite(line.percent) || line.percent <= 0 || !development.materials.some(material => material.id === line.materialId))
        || Math.abs(lines.reduce((sum, line) => sum + line.percent, 0) - 100) > .001) throw new Error(`配合が不正です: ${mapping.recipeId}`);
      const productionUnits = row.yhat * mapping.unitsPerSale;
      const materials = lines.map(line => ({ materialId: line.materialId, grams: productionUnits * product.gramsPerUnit * line.percent / 100 }));
      if (!Number.isFinite(productionUnits) || materials.some(material => !Number.isFinite(material.grams))) throw new Error('材料換算数量が計算可能な範囲を超えています。');
      result.demands.push({ key: forecastKey(row), salesDate, neededOn, productId: row.productId, storeId: row.storeId, forecastUnits: row.yhat, productionUnits, mapping, materials });
    }
    result.input = input;
    const lastDay = result.demands.map(row => row.neededOn).sort().at(-1);
    if (!lastDay) return result;
    for (let day = shiftDate(asOf, 1); day <= lastDay; day = shiftDate(day, 1)) result.dates.push(day);
    const pools = new Map<string, { materialId: string; facilityId: string }>();
    for (const demand of result.demands) for (const material of demand.materials) pools.set(JSON.stringify([demand.mapping.facilityId, material.materialId]), { materialId: material.materialId, facilityId: demand.mapping.facilityId });
    for (const pool of pools.values()) {
      const stocks = development.stocks.filter(row => row.materialId === pool.materialId && row.facilityId === pool.facilityId);
      const reserved = development.reservations.filter(row => row.materialId === pool.materialId && development.plans.some(plan => plan.id === row.planId && plan.status === 'confirmed' && plan.facilityId === pool.facilityId)).reduce((sum, row) => sum + row.grams, 0);
      let balance = !stocks.length || stocks.some(row => row.grams === null) ? null : stocks.reduce((sum, row) => sum + row.grams!, 0) - reserved;
      for (const day of result.dates) {
        const demands = result.demands.filter(row => row.neededOn === day && row.mapping.facilityId === pool.facilityId && row.materials.some(material => material.materialId === pool.materialId));
        const requiredGrams = demands.reduce((sum, row) => sum + row.materials.find(material => material.materialId === pool.materialId)!.grams, 0);
        const covered = input.receiptCoverage.some(row => row.materialId === pool.materialId && row.facilityId === pool.facilityId && row.from <= day && day <= row.to);
        const receiptGrams = covered ? input.receipts.filter(row => row.confirmed && row.materialId === pool.materialId && row.facilityId === pool.facilityId && row.usableOn === day).reduce((sum, row) => sum + row.grams, 0) : null;
        const openingGrams: number | null = balance;
        const availableGrams: number | null = balance === null || receiptGrams === null ? null : balance + receiptGrams;
        balance = availableGrams === null ? null : availableGrams - requiredGrams;
        result.cells.push({ key: JSON.stringify([pool.facilityId, pool.materialId, day]), ...pool, date: day, requiredGrams,
          openingGrams, receiptGrams, availableGrams, closingGrams: balance, shortageGrams: balance === null ? null : Math.max(0, -balance), demands });
      }
    }
    return result;
  } catch (reason) {
    return { ...result, input: null, dates: [], demands: [], cells: [], error: reason instanceof Error ? reason.message : '見通しデータを確認できません。' };
  }
}

export function materialResponseRequest(data: WorkspaceData, result: MaterialOutlook, cell: MaterialOutlookCell, demand: OutlookDemand): MaterialResponseRequest {
  if (!result.input || result.error || !result.cells.some(row => row.key === cell.key) || !cell.demands.some(row => row.key === demand.key)
    || cell.shortageGrams === null || cell.shortageGrams <= 0) throw new Error('確認済みの不足と対象需要を選択してください。');
  const material = data.development.materials.find(row => row.id === cell.materialId);
  if (!material) throw new Error('材料を確認できません。');
  const units = Math.ceil(demand.productionUnits);
  if (units < 1 || units > 10000) throw new Error('対応検討の数量範囲（1～10,000）を超えています。');
  return { supplierId: material.supplierId, materialId: material.id, date: cell.date,
    scenario: { productId: demand.mapping.developmentProductId, recipeId: demand.mapping.recipeId, facilityId: cell.facilityId, units, custom: null },
    basis: { source: result.input.source, mappingId: demand.mapping.id, evidence: demand.mapping.evidence, modelVersion: result.input.forecastModelVersion,
      salesDate: demand.salesDate, productId: demand.productId, storeId: demand.storeId, forecastUnits: demand.forecastUnits, productionUnits: demand.productionUnits } };
}