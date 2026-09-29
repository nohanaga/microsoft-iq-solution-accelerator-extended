import type { WorkspaceData } from './workspace-schema';

export type Predictions = WorkspaceData['predictions'];
export type ShipmentRisk = Predictions['shipmentRisk'][number];
export type DemandForecast = Predictions['demandForecast'][number];
export type BeanDepletion = Predictions['beanDepletion'][number];

export const forecastDay = (value: string) => value.slice(0, 10);
const mean = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export interface LaneRisk {
  supplierId: string; storeId: string; shipments: number;
  delayProbability: number; shortageProbability: number; expectedLossExTax: number;
  actualDelayRate: number; actualAmountExTax: number;
}

/** 供給会社と店舗の組ごとに、遅延確率と期待逸失額をまとめます。 */
export function summarizeLanes(rows: ShipmentRisk[], filter: { storeId?: string; supplierId?: string } = {}) {
  const scoped = rows.filter(row => (!filter.storeId || row.storeId === filter.storeId)
    && (!filter.supplierId || row.supplierId === filter.supplierId));
  const lanes = new Map<string, ShipmentRisk[]>();
  for (const row of scoped) {
    const key = `${row.supplierId}\u0000${row.storeId}`;
    lanes.set(key, [...lanes.get(key) ?? [], row]);
  }
  return [...lanes.entries()].map(([key, group]): LaneRisk => {
    const [supplierId, storeId] = key.split('\u0000');
    return {
      supplierId, storeId, shipments: group.length,
      delayProbability: mean(group.map(row => row.delayProbability)),
      shortageProbability: mean(group.map(row => row.jointShortageProbability)),
      expectedLossExTax: sum(group.map(row => row.expectedLossExTax)),
      actualDelayRate: group.filter(row => row.actualDelayed).length / group.length,
      actualAmountExTax: sum(group.map(row => row.actualAmountExTax)),
    };
  }).sort((first, second) => second.expectedLossExTax - first.expectedLossExTax);
}

export interface ForecastSummary {
  days: number; from: string; to: string; totalCups: number; lowerCups: number; upperCups: number;
  byStore: Array<{ storeId: string; cups: number; lower: number; upper: number }>;
  byDay: Array<{ day: string; cups: number; lower: number; upper: number }>;
  modelVersion: string;
}

export function summarizeForecast(rows: DemandForecast[], filter: { storeId?: string } = {}): ForecastSummary | null {
  const scoped = rows.filter(row => !filter.storeId || row.storeId === filter.storeId);
  if (!scoped.length) return null;
  const days = [...new Set(scoped.map(row => forecastDay(row.date)))].sort();
  const group = <T extends string>(pick: (row: DemandForecast) => T) => {
    const buckets = new Map<T, DemandForecast[]>();
    for (const row of scoped) buckets.set(pick(row), [...buckets.get(pick(row)) ?? [], row]);
    return buckets;
  };
  return {
    days: days.length, from: days[0], to: days[days.length - 1],
    totalCups: sum(scoped.map(row => row.yhat)),
    lowerCups: sum(scoped.map(row => row.yhatLower)),
    upperCups: sum(scoped.map(row => row.yhatUpper)),
    byStore: [...group(row => row.storeId).entries()]
      .map(([storeId, group]) => ({ storeId, cups: sum(group.map(row => row.yhat)),
        lower: sum(group.map(row => row.yhatLower)), upper: sum(group.map(row => row.yhatUpper)) }))
      .sort((first, second) => second.cups - first.cups),
    byDay: days.map(day => {
      const group = scoped.filter(row => forecastDay(row.date) === day);
      return { day, cups: sum(group.map(row => row.yhat)),
        lower: sum(group.map(row => row.yhatLower)), upper: sum(group.map(row => row.yhatUpper)) };
    }),
    modelVersion: scoped[0].modelVersion,
  };
}

/** 枯渇予測は予測期間内に尽きる順で並べます。期間外は末尾に置きます。 */
export function orderDepletion(rows: BeanDepletion[]) {
  return [...rows].sort((first, second) => Number(second.withinHorizon) - Number(first.withinHorizon)
    || (first.depletionDayIndex ?? Infinity) - (second.depletionDayIndex ?? Infinity));
}
