import { z } from 'zod';
import type { ReviewFilter } from './domain';
import type { VoiceSourceFilter } from './voice';
import { voiceSourceLabels } from './voice';
import type { BlendScenario, DevelopmentView } from './blend-workbench-model';
import { graphTables } from './ontology-records';
import type { SupplyCase } from './supply-response-model';

export type CopilotPage = 'reviews' | 'development' | 'blend' | 'supply';
export type OntologyModelId = 'development' | 'supply';

export interface SupplyUiFilter {
  storeId: string;
  supplierId: string;
  from: string;
  to: string;
  tab: 'shipments' | 'orders';
  status: string;
  graphMode: 'network' | 'impact';
  shipmentId: string;
}

export const initialSupplyFilter: SupplyUiFilter = {
  storeId: '', supplierId: '', from: '', to: '',
  tab: 'shipments', status: 'all', graphMode: 'network', shipmentId: '',
};

/** Agent へ渡さず、null 引数を現在値へ解決するためだけに使う画面 state。 */
export interface CopilotUiState {
  page: CopilotPage;
  reviews: { filter: ReviewFilter; source: VoiceSourceFilter; topic: string };
  supply: SupplyUiFilter;
}

export type UiCommand =
  | { commandId: string; type: 'navigate'; page: CopilotPage }
  | { commandId: string; type: 'reviews.setFilter'; filter: ReviewFilter; source: VoiceSourceFilter; topic: string }
  | { commandId: string; type: 'development.setScenario'; view: DevelopmentView; scenario: BlendScenario }
  | { commandId: string; type: 'supply.setFilter'; filter: SupplyUiFilter }
  | { commandId: string; type: 'supply.setCase'; value: SupplyCase; edit: boolean }
  | { commandId: string; type: 'ontology.selectRecord'; model: OntologyModelId; tableId: string; recordId: string }
  | { commandId: string; type: 'copilot.openReference'; referenceId: string };

export const uiToolNames = [
  'ui_navigate',
  'customer_voice_propose_filter',
  'development_propose_scenario',
  'supply_propose_filter',
  'ontology_select_record',
  'copilot_open_reference',
] as const;
export type UiToolName = typeof uiToolNames[number];

const pages = ['reviews', 'development', 'blend', 'supply'] as const;
const voiceSources = ['all', 'review', 'survey', 'social', 'chat'] as const;
const shipmentStatuses = ['all', 'late', 'on-time', 'late-pending', 'unknown', 'scheduled'];
const orderStatuses = ['all', 'confirmed', 'completed', 'cancelled', 'delayed'];
const pageLabels: Record<CopilotPage, string> = { reviews: '顧客の声', development: '飲料開発 DEV-001', blend: 'ブレンド調合 DEV-002', supply: '供給と注文' };

const id = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD で指定してください');

const navigateArgs = z.object({ page: z.enum(pages), reason: z.string().max(400) });
const reviewArgs = z.object({
  productId: id.nullable(),
  storeIds: z.array(id).min(1).max(20).nullable(),
  from: day.nullable(),
  to: day.nullable(),
  source: z.enum(voiceSources),
  topic: z.string().max(64),
});
const developmentArgs = z.object({
  view: z.enum(['beverage', 'blend']),
  productId: id,
  recipeId: id,
  facilityId: id,
  units: z.number().int().min(1).max(10000),
  components: z.array(z.object({ materialId: id, percent: z.number().finite().min(0).max(100) })).min(1).max(12).nullable(),
});
const supplyArgs = z.object({
  storeId: id.nullable(),
  supplierId: id.nullable(),
  from: day.nullable(),
  to: day.nullable(),
  tab: z.enum(['shipments', 'orders']),
  status: z.string().min(1).max(32),
  graphMode: z.enum(['network', 'impact']),
});
const ontologyArgs = z.object({ model: z.enum(['development', 'supply']), tableId: id, recordId: id });
const referenceArgs = z.object({ referenceId: z.string().min(1).max(128) });

export interface UiCommandResult { command?: UiCommand; error?: string }

function fail(error: string): UiCommandResult {
  return { error };
}

function issues(error: z.ZodError): string {
  return error.issues.slice(0, 3).map(entry => `${entry.path.join('.') || '引数'}: ${entry.message}`).join(' / ');
}

/**
 * Agent の function_call を型付き UiCommand へ変換する。
 * strict スキーマはモデル側の補助でしかないため、ここで必ず再検証する。
 */
export function toUiCommand(name: string, args: string, state: CopilotUiState): UiCommandResult {
  if (!(uiToolNames as readonly string[]).includes(name)) return fail(`許可リストにないツールです: ${name}`);
  let raw: unknown;
  try { raw = JSON.parse(args || '{}'); } catch { return fail('引数が JSON として解釈できません。'); }
  const commandId = crypto.randomUUID();

  if (name === 'ui_navigate') {
    const parsed = navigateArgs.safeParse(raw);
    if (!parsed.success) return fail(issues(parsed.error));
    return { command: { commandId, type: 'navigate', page: parsed.data.page } };
  }

  if (name === 'customer_voice_propose_filter') {
    const parsed = reviewArgs.safeParse(raw);
    if (!parsed.success) return fail(issues(parsed.error));
    const current = state.reviews.filter;
    const filter: ReviewFilter = {
      productId: parsed.data.productId ?? current.productId,
      storeIds: parsed.data.storeIds ?? current.storeIds,
      from: parsed.data.from ?? current.from,
      to: parsed.data.to ?? current.to,
    };
    if (filter.from > filter.to) return fail('開始日は終了日以前にしてください。');
    return { command: { commandId, type: 'reviews.setFilter', filter, source: parsed.data.source, topic: parsed.data.topic.trim() } };
  }

  if (name === 'development_propose_scenario') {
    const parsed = developmentArgs.safeParse(raw);
    if (!parsed.success) return fail(issues(parsed.error));
    const components = parsed.data.components;
    if (components) {
      if (new Set(components.map(row => row.materialId)).size !== components.length) return fail('同じ焙煎豆が重複しています。');
      const total = Math.round(components.reduce((sum, row) => sum + row.percent, 0) * 1000) / 1000;
      if (total !== 100) return fail(`配合比率の合計が 100 ではありません: ${total}`);
    }
    const scenario: BlendScenario = {
      productId: parsed.data.productId,
      recipeId: parsed.data.recipeId,
      units: parsed.data.units,
      facilityId: parsed.data.facilityId,
      custom: components ? components.map(row => ({ materialId: row.materialId, percent: row.percent })) : null,
    };
    return { command: { commandId, type: 'development.setScenario', view: parsed.data.view, scenario } };
  }

  if (name === 'supply_propose_filter') {
    const parsed = supplyArgs.safeParse(raw);
    if (!parsed.success) return fail(issues(parsed.error));
    const allowed = parsed.data.tab === 'shipments' ? shipmentStatuses : orderStatuses;
    if (!allowed.includes(parsed.data.status)) return fail(`${parsed.data.tab} にない状態です: ${parsed.data.status}`);
    const from = parsed.data.from ?? '';
    const to = parsed.data.to ?? '';
    if (from && to && from > to) return fail('開始日は終了日以前にしてください。');
    const filter: SupplyUiFilter = {
      storeId: parsed.data.storeId ?? '',
      supplierId: parsed.data.supplierId ?? '',
      from, to,
      tab: parsed.data.tab,
      status: parsed.data.status,
      graphMode: parsed.data.graphMode,
      // 絞り込みを変えた時点で入荷便の選択は解除する。
      shipmentId: '',
    };
    return { command: { commandId, type: 'supply.setFilter', filter } };
  }

  if (name === 'ontology_select_record') {
    const parsed = ontologyArgs.safeParse(raw);
    if (!parsed.success) return fail(issues(parsed.error));
    const tables = graphTables(parsed.data.model).map(table => table.id);
    if (!tables.includes(parsed.data.tableId)) return fail(`${parsed.data.model} に存在しない実体です: ${parsed.data.tableId}`);
    return { command: { commandId, type: 'ontology.selectRecord', model: parsed.data.model, tableId: parsed.data.tableId, recordId: parsed.data.recordId } };
  }

  const parsed = referenceArgs.safeParse(raw);
  if (!parsed.success) return fail(issues(parsed.error));
  return { command: { commandId, type: 'copilot.openReference', referenceId: parsed.data.referenceId } };
}

export function uiCommandLabel(command: UiCommand): string {
  switch (command.type) {
    case 'supply.setCase':
      return '供給の検討下書きを更新';
    case 'navigate':
      return `画面を「${pageLabels[command.page]}」へ切り替え`;
    case 'reviews.setFilter':
      return `顧客の声を絞り込み（${command.filter.productId} / ${command.filter.from}〜${command.filter.to} / ${voiceSourceLabels[command.source]}${command.topic ? ` / ${command.topic}` : ''}）`;
    case 'development.setScenario':
      return `商品開発の試算を更新（${command.scenario.productId} / ${command.scenario.units} ${command.view === 'blend' ? '袋' : '杯'}${command.scenario.custom ? ' / カスタム配合' : ''}）`;
    case 'supply.setFilter':
      return `供給と注文を絞り込み（${command.filter.tab === 'shipments' ? '入荷便' : '注文'} / 状態 ${command.filter.status}${command.filter.storeId ? ` / ${command.filter.storeId}` : ''}${command.filter.from || command.filter.to ? ` / ${command.filter.from || '下限なし'}〜${command.filter.to || '上限なし'}` : ''}）`;
    case 'ontology.selectRecord':
      return `オントロジーで ${command.tableId} の ${command.recordId} を選択`;
    case 'copilot.openReference':
      return `根拠 ${command.referenceId} を開く`;
  }
}
