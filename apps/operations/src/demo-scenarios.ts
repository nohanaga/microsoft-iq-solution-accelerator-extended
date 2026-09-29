import { calculateBlend, initialBlendScenario } from './blend-workbench-model';
import type { BlendDataset } from './blend-workbench-model';
import type { UiCommand } from './copilot-ui-command';
import type { Dataset, ReviewFilter } from './domain';
import { compareSupplyCase, createSupplyCase, stockLimitedScenario } from './supply-response-model';

export const demoOptions = [
  { id: 'voices', label: '顧客の声を確認' },
  { id: 'blend', label: 'ブレンドの数量比較' },
  { id: 'supply', label: '供給停止への対応' },
  { id: 'relations', label: '供給と開発の関係探索' },
] as const;
export type DemoId = typeof demoOptions[number]['id'];
export interface DemoStep {
  id: string; title: string; question: string; target: string;
  commands: UiCommand[]; requiresGraph?: boolean; manual?: boolean;
}
export interface DemoScenario { id: DemoId; version: number; dataVersion: string; steps: DemoStep[] }
export type DemoPhase = 'waiting' | 'ready' | 'paused' | 'error' | 'complete';
export interface DemoRun { index: number; phase: DemoPhase; autoplay: boolean; error: string }
export type DemoEvent = { type: 'ready' } | { type: 'pause' } | { type: 'resume'; autoplay: boolean }
  | { type: 'fail'; message: string } | { type: 'move'; index: number } | { type: 'finish' };
export function transitionDemo(state: DemoRun, event: DemoEvent): DemoRun {
  switch (event.type) {
    case 'ready': return state.phase === 'waiting' ? { ...state, phase: 'ready', error: '' } : state;
    case 'pause': return { ...state, phase: 'paused', autoplay: false };
    case 'resume': return { ...state, phase: 'waiting', autoplay: event.autoplay, error: '' };
    case 'fail': return { ...state, phase: 'error', autoplay: false, error: event.message };
    case 'move': return { ...state, index: event.index, phase: 'waiting', error: '' };
    case 'finish': return { ...state, phase: 'complete', autoplay: false };
  }
}

export function buildDemoScenario(id: DemoId, data: BlendDataset, operations: Dataset, mode: 'live' | 'memory', filter: ReviewFilter): DemoScenario {
  const commandId = () => crypto.randomUUID();
  if (id === 'voices') {
    if (!operations.products.some(row => row.id === filter.productId)) throw new Error('対象商品がありません。');
    const steps: DemoStep[] = [
      { id: 'all', title: '顧客の声', question: '対象期間と商品は何か。', target: 'reviews', commands: [{ commandId: commandId(), type: 'reviews.setFilter', filter, source: 'all', topic: '' }] },
      { id: 'review', title: '購入後の評価', question: '購入者の評価にどのような根拠があるか。', target: 'reviews', commands: [{ commandId: commandId(), type: 'reviews.setFilter', filter, source: 'review', topic: '' }] },
      { id: 'social', title: '投稿の確認', question: '投稿と購入者評価に違いがあるか。', target: 'reviews', commands: [{ commandId: commandId(), type: 'reviews.setFilter', filter, source: 'social', topic: '' }], manual: true },
    ];
    return { id, version: 1, dataVersion: operations.version, steps };
  }
  const baseline = { ...initialBlendScenario('blend', data), units: 200 };
  if (id === 'blend') {
    const limited = stockLimitedScenario(baseline, data);
    return { id, version: 1, dataVersion: data.version, steps: [
      { id: 'baseline', title: '元条件', question: '既存確保を維持すると何kg不足するか。', target: 'development', commands: [{ commandId: commandId(), type: 'development.setScenario', view: 'blend', scenario: baseline }] },
      { id: 'quantity', title: '数量の見直し', question: '現在の配合で在庫内に収まる製造数はいくつか。', target: 'development', commands: [{ commandId: commandId(), type: 'development.setScenario', view: 'blend', scenario: limited }] },
      { id: 'decision', title: '未確認条件', question: '数量が足りても、品質と設備能力は確認済みか。', target: 'development', commands: [{ commandId: commandId(), type: 'development.setScenario', view: 'blend', scenario: limited }], manual: true },
    ] };
  }
  if (id === 'relations' && mode !== 'live') throw new Error('関係探索シナリオには実接続モードが必要です。モードは自動で切り替えません。');
  if (data.version !== '2026-09-11.2' || data.datasetId !== 'maikuro-development-v3') throw new Error('この供給台本はmaikuro-development-v3 / 2026-09-11.2を対象としています。');
  if (!operations.suppliers.some(row => row.id === 'SUP-02')) throw new Error('供給側にSUP-02がありません。');
  const initial = createSupplyCase(data, 'SUP-02');
  const stopped = { ...initial, assumption: { ...initial.assumption, enabled: true, reason: 'デモ仮定: 供給会社の補充停止。手元在庫は維持。' } };
  const quantity = { ...stopped, proposal: stockLimitedScenario(initial.baseline, data) };
  const balanced = { ...stopped, proposal: { ...initial.baseline, custom: [{ materialId: 'ROASTED-BR', percent: 62.5 }, { materialId: 'ROASTED-CO', percent: 37.5 }] } };
  const verified = compareSupplyCase(balanced, data);
  if (verified.baseline.calculation.shortageGrams !== 5000 || verified.proposal.calculation.shortageGrams !== 0 || calculateBlend(quantity.proposal, data).shortageGrams !== 0) throw new Error('現在の在庫・確保が台本の前提と異なります。通常の対応検討で確認してください。');
  const step = (stepId: string, title: string, question: string, value = initial, target = 'supply-response', edit = false): DemoStep => ({
    id: stepId, title, question, target, commands: [{ commandId: commandId(), type: 'supply.setCase', value, edit }],
  });
  const relationStep = { ...step('relations', '関係の探索', '供給会社から開発側の豆・計画へ、どの関係で到達したか。', stopped, 'supply-graph'), requiresGraph: true };
  if (id === 'relations') return { id, version: 1, dataVersion: data.version, steps: [relationStep, { ...step('evidence', '関係と事実の境界', '派生した共通会社IDの関係と、GraphModelの関係を区別できるか。', stopped, 'supply-graph'), requiresGraph: true, manual: true }] };
  return { id, version: 1, dataVersion: data.version, steps: [
    step('baseline', '対象と元条件', '追加200袋と既存ラテの確保を両立できるか。'),
    step('suspension', '補充停止の仮定', '停止仮定を置いても手元在庫は変わっていないか。', stopped, 'supply-assumption'),
    ...(mode === 'live' ? [relationStep] : []),
    step('quantity', '数量案', '150袋へ減らしたとき、何を見送るか。', quantity, 'supply-comparison'),
    step('blend', '配合変更案', 'ブラジル62.5%・コロンビア37.5%では何が変わるか。', balanced, 'development', true),
    step('compare', '比較へ戻る', '200袋を作れても、使用豆の未確保残量0を許容できるか。', balanced, 'supply-comparison'),
    { ...step('decision', '判断材料の確認', '選択理由と未確認条件は何か。保存は人の判断で行う。', balanced, 'supply-save'), manual: true },
  ] };
}