import { calculateBlend, initialBlendScenario } from './blend-workbench-model';
import type { BlendCalculation, BlendDataset, BlendScenario } from './blend-workbench-model';
import type { MaterialResponseContext } from './material-outlook';

export interface SupplyAssumption {
  enabled: boolean;
  supplierId: string;
  from: string;
  to: string;
  reason: string;
}

export interface SupplyCase {
  id: string;
  datasetVersion: string;
  baseline: BlendScenario;
  proposal: BlendScenario;
  assumption: SupplyAssumption;
  rationale: string;
  outlook?: MaterialResponseContext;
}

export interface SupplyAssessment {
  calculation: BlendCalculation;
  status: 'shortage' | 'unknown' | 'within-stock';
  remainingGrams: number | null;
  exposedMaterialIds: string[];
  exposedShortageGrams: number;
  unknowns: string[];
}

export function createSupplyCase(data: BlendDataset, supplierId: string): SupplyCase {
  if (!data.suppliers.some(row => row.id === supplierId)) throw new Error('開発側に対応する供給会社がありません。');
  const baseline = { ...initialBlendScenario('blend', data), units: 200 };
  return {
    id: crypto.randomUUID(), datasetVersion: data.version,
    baseline, proposal: structuredClone(baseline),
    assumption: { enabled: false, supplierId, from: data.asOf.slice(0, 10), to: data.asOf.slice(0, 10), reason: '' },
    rationale: '',
  };
}

export function validateAssumption(assumption: SupplyAssumption, data: BlendDataset) {
  if (!data.suppliers.some(row => row.id === assumption.supplierId)) throw new Error('供給会社を確認してください。');
  if (!assumption.enabled) return;
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(assumption.from) || !validDate(assumption.to) || assumption.from > assumption.to) throw new Error('停止仮定の開始日・終了日を確認してください。');
  if (!assumption.reason.trim()) throw new Error('停止仮定の理由を入力してください。');
}

export function assessSupply(scenario: BlendScenario, assumption: SupplyAssumption, data: BlendDataset): SupplyAssessment {
  validateAssumption(assumption, data);
  const calculation = calculateBlend(scenario, data);
  const exposed = assumption.enabled ? calculation.requirements.filter(row => row.material.supplierId === assumption.supplierId) : [];
  const unknowns = ['品質・販売承認', '製造期間・設備能力', '予備在庫の許容水準', '販売商品・個別注文との対応'];
  if (calculation.unknownCount) unknowns.unshift(`在庫未確認 ${calculation.unknownCount} 種`);
  if (calculation.shortageGrams > 0) unknowns.unshift('追加調達の数量・納期・価格・供給資格');
  if (assumption.enabled) unknowns.unshift('補充停止期間と製造・入荷予定の重なり');
  const remainingGrams = calculation.unknownCount ? null : calculation.requirements.reduce((total, row) => total + Math.max(0, row.availableGrams! - row.requiredGrams), 0);
  return {
    calculation, remainingGrams,
    status: calculation.shortageGrams > 0 ? 'shortage' : calculation.unknownCount ? 'unknown' : 'within-stock',
    exposedMaterialIds: exposed.map(row => row.material.id),
    exposedShortageGrams: exposed.reduce((total, row) => total + (row.shortageGrams ?? 0), 0),
    unknowns,
  };
}

export function compareSupplyCase(value: SupplyCase, data: BlendDataset) {
  if (value.datasetVersion !== data.version) throw new Error('データ版が異なります。新しい検討を開始してください。');
  if (value.baseline.productId !== value.proposal.productId) throw new Error('元条件と対応案は同じ商品を選択してください。');
  return {
    baseline: assessSupply(value.baseline, { ...value.assumption, enabled: false }, data),
    suspended: assessSupply(value.baseline, value.assumption, data),
    proposal: assessSupply(value.proposal, value.assumption, data),
  };
}

export function stockLimitedScenario(scenario: BlendScenario, data: BlendDataset): BlendScenario {
  const calculation = calculateBlend(scenario, data);
  if (calculation.unknownCount) throw new Error('在庫未確認のため製造数を提案できません。');
  const units = Math.min(scenario.units, ...calculation.requirements.map(row => Math.floor(row.availableGrams! / (row.requiredGrams / scenario.units))));
  if (units < 1) throw new Error('現在の配合では1単位分の在庫も確保できません。');
  return { ...scenario, units, custom: scenario.custom?.map(row => ({ ...row })) ?? null };
}