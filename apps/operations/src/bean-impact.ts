import { scenarioComponents } from './blend-workbench-model';
import type { BlendCalculation, BlendDataset, BlendScenario } from './blend-workbench-model';
import { collapseBridges, measureHops } from './fabric-impact';
import type { FabricGraphNode, FabricGraphSnapshot, FabricGraphTiming } from './fabric-impact';
import type { GraphDomain } from './ontology-records';
import type { GraphCacheState } from './workspace-repository';

/** 既定で折りたたむ補足エンティティ。Fabric から取得済みで、表示だけを抑えます。 */
export const foldedEntityTypes = new Set(['BeanOrigin', 'DevelopmentFacility', 'BeanStock']);

export type BeanChangeKind = 'added' | 'removed' | 'increased' | 'decreased' | 'kept';
export interface BeanChange { materialId: string; name: string; kind: BeanChangeKind; before: number | null; after: number | null }
export interface ImpactNode {
  id: string; domain: GraphDomain; tableId: string; recordId: string; entityType: string; label: string; name: string;
  detail: string; metric: string; hop: number; start: boolean; risk: boolean; change: BeanChangeKind | null;
}
export interface ImpactEdge {
  id: string; source: string; target: string; label: string; kind: 'asserted' | 'derived';
  via: string | null; detail: string; span: number;
}
export interface ImpactSupplier { id: string; name: string; city: string; hop: number; direct: string[]; shared: string[] }
export interface ImpactCount { tableId: string; label: string; count: number }
export interface ImpactProvenance extends GraphCacheState {
  graphIds: Partial<Record<GraphDomain, string>>; retrievedAt: string; timing: FabricGraphTiming;
  truncated: boolean; derivedEdges: number; collapsed: number; hidden: number; missingScopeIds: string[];
  scopeSize: number; focusSize: number;
}
export interface BeanImpact {
  depth: number; changed: boolean; changes: BeanChange[];
  nodes: ImpactNode[]; edges: ImpactEdge[]; suppliers: ImpactSupplier[]; counts: ImpactCount[];
  reach: number; relations: string[]; provenance: ImpactProvenance; supplyReached: boolean;
}

const formatKilograms = (grams: number) => (grams / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 2 });

export function beanChanges(scenario: BlendScenario, data: BlendDataset): BeanChange[] {
  const registered = data.recipeLines.filter(row => row.recipeId === scenario.recipeId);
  const before = new Map(registered.map(row => [row.materialId, row.percent]));
  const after = new Map(scenarioComponents(scenario, data).map(row => [row.materialId, row.percent]));
  return [...new Set([...after.keys(), ...before.keys()])].map(materialId => {
    const past = before.get(materialId) ?? null;
    const next = after.get(materialId) ?? null;
    const kind: BeanChangeKind = past === null ? 'added' : next === null ? 'removed'
      : next > past ? 'increased' : next < past ? 'decreased' : 'kept';
    return { materialId, name: data.materials.find(row => row.id === materialId)?.name ?? materialId, kind, before: past, after: next };
  });
}

/**
 * 取得範囲。登録配合と現在の配合の和集合を使う。比率を動かしても値が変わらないので再取得が起きない。
 * `universe` を渡すと先読みし、豆の差し替えでもキャッシュに当たるようにする。
 */
export function beanImpactScopeIds(changes: BeanChange[], universe: string[] = []): string[] {
  return [...new Set([...changes.map(row => row.materialId), ...universe])].sort();
}

/** 注目対象。変更があればその豆だけ、なければ現在の配合全体。段数はここから数える。 */
export function beanImpactFocusIds(changes: BeanChange[]): string[] {
  const moved = changes.filter(row => row.kind !== 'kept');
  return (moved.length ? moved : changes).map(row => row.materialId);
}

function text(value: unknown) {
  return value === null || value === undefined || value === '' ? '' : String(value);
}

/** ノードの説明文は GraphModel が返したプロパティだけから作る。 */
function nodeDetail(node: FabricGraphNode): string {
  const property = (name: string) => text(node.properties[name]);
  const parts: string[] = [];
  switch (node.entityType) {
    case 'RoastedBean':
      if (property('materials_specification')) parts.push(property('materials_specification'));
      if (property('materials_pricePerKg')) parts.push(`${Number(node.properties.materials_pricePerKg).toLocaleString('ja-JP')} 円 / kg（税抜）`);
      break;
    case 'DevelopmentSupplier':
    case 'Supplier':
      if (property('suppliers_city')) parts.push(property('suppliers_city'));
      break;
    case 'BlendRecipe':
      if (property('recipes_status')) parts.push(property('recipes_status') === 'draft' ? '下書き' : '登録済み');
      break;
    case 'DevelopmentProduct':
      if (property('products_gramsPerUnit')) parts.push(`${property('products_gramsPerUnit')} g / ${property('products_unit')}`);
      break;
    case 'ProductionPlan':
      if (property('plans_units')) parts.push(`${Number(node.properties.plans_units).toLocaleString('ja-JP')} 単位`);
      if (property('plans_status')) parts.push(property('plans_status') === 'confirmed' ? '確定' : '下書き');
      break;
    case 'Product':
      if (property('products_category')) parts.push(property('products_category'));
      if (property('products_priceExTax')) parts.push(`${Number(node.properties.products_priceExTax).toLocaleString('ja-JP')} 円（税抜）`);
      break;
    case 'OrderLine':
      if (property('orderLines_quantity')) parts.push(`${property('orderLines_quantity')} 点`);
      if (property('orderLines_priceExTax')) parts.push(`${Number(node.properties.orderLines_priceExTax).toLocaleString('ja-JP')} 円（税抜）`);
      break;
    case 'Order':
      if (property('orders_status')) parts.push(property('orders_status'));
      if (property('orders_orderedAt')) parts.push(property('orders_orderedAt').slice(0, 10));
      break;
    case 'Store':
      if (property('stores_city')) parts.push(property('stores_city'));
      break;
    case 'Shipment':
      if (property('shipments_status')) parts.push(property('shipments_status'));
      break;
    case 'SupplyImpact':
      if (property('supplyImpacts_reason')) parts.push(property('supplyImpacts_reason'));
      break;
    default:
      break;
  }
  return parts.join(' / ');
}

export function buildBeanImpact(input: {
  snapshot: FabricGraphSnapshot; changes: BeanChange[]; focusRecordIds: string[];
  calculation: BlendCalculation | null; depth: number; simplified: boolean;
}): BeanImpact {
  const { snapshot, changes, calculation, depth, simplified } = input;
  const focusIds = input.focusRecordIds.map(recordId => `development:materials:${recordId}`);
  const collapsedGraph = simplified ? collapseBridges(snapshot) : { nodes: snapshot.nodes, edges: snapshot.edges, collapsed: 0 };
  const visibleNodes = simplified ? collapsedGraph.nodes.filter(node => !foldedEntityTypes.has(node.entityType)) : collapsedGraph.nodes;
  const visibleIds = new Set(visibleNodes.map(node => node.id));
  const visibleEdges = collapsedGraph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const hops = measureHops(visibleNodes, visibleEdges, focusIds);
  const reachable = visibleNodes.filter(node => hops.has(node.id));
  const reachableIds = new Set(reachable.map(node => node.id));

  const shortage = new Set((calculation?.requirements ?? []).filter(row => (row.shortageGrams ?? 0) > 0).map(row => row.material.id));
  const unknown = new Set((calculation?.requirements ?? []).filter(row => row.shortageGrams === null).map(row => row.material.id));
  const changeOf = new Map(changes.map(row => [row.materialId, row.kind]));

  const nodes: ImpactNode[] = reachable.map(node => {
    const requirement = node.tableId === 'materials'
      ? calculation?.requirements.find(row => row.material.id === node.recordId) : undefined;
    const metric = !requirement ? ''
      : requirement.shortageGrams === null ? '在庫未確認'
        : requirement.shortageGrams > 0 ? `不足 ${formatKilograms(requirement.shortageGrams)} kg`
          : `必要 ${formatKilograms(requirement.requiredGrams)} kg`;
    return {
      id: node.id, domain: node.domain, tableId: node.tableId, recordId: node.recordId, entityType: node.entityType,
      label: node.label, name: node.name, detail: nodeDetail(node), metric, hop: hops.get(node.id) ?? 0,
      start: focusIds.includes(node.id),
      risk: node.domain === 'development' && node.tableId === 'materials' && (shortage.has(node.recordId) || unknown.has(node.recordId)),
      change: node.domain === 'development' && node.tableId === 'materials' ? changeOf.get(node.recordId) ?? null : null,
    };
  }).sort((first, second) => first.hop - second.hop
    || first.domain.localeCompare(second.domain)
    || first.entityType.localeCompare(second.entityType)
    || first.name.localeCompare(second.name, 'ja'));

  const edges: ImpactEdge[] = visibleEdges
    .filter(edge => reachableIds.has(edge.source) && reachableIds.has(edge.target))
    .map(edge => ({ ...edge, span: Math.abs((hops.get(edge.source) ?? 0) - (hops.get(edge.target) ?? 0)) }));

  const changedIds = new Set(changes.map(row => row.materialId));
  const suppliers: ImpactSupplier[] = nodes.filter(node => node.tableId === 'suppliers' && node.domain === 'development').map(node => {
    const supplied = reachable.filter(row => row.domain === 'development' && row.tableId === 'materials'
      && text(row.properties.materials_supplierId) === node.recordId);
    return {
      id: node.recordId, name: node.name, city: node.detail, hop: node.hop,
      direct: supplied.filter(row => changedIds.has(row.recordId)).map(row => row.name),
      shared: supplied.filter(row => !changedIds.has(row.recordId)).map(row => row.name),
    };
  });

  const counts: ImpactCount[] = [...nodes.reduce((totals, node) => {
    const key = `${node.domain}:${node.tableId}`;
    totals.set(key, { tableId: node.tableId, label: node.domain === 'supply' ? `${node.label}（供給）` : node.label, count: (totals.get(key)?.count ?? 0) + 1 });
    return totals;
  }, new Map<string, ImpactCount>()).values()];

  return {
    depth, changed: changes.some(row => row.kind !== 'kept'), changes, nodes, edges, suppliers, counts,
    reach: nodes.reduce((deepest, node) => Math.max(deepest, node.hop), 0),
    relations: [...new Set(edges.map(row => row.label))],
    supplyReached: nodes.some(node => node.domain === 'supply'),
    provenance: {
      source: snapshot.source, sources: snapshot.sources, cacheOrigin: snapshot.cacheOrigin, persistence: snapshot.persistence,
      stale: snapshot.stale, refreshing: snapshot.refreshing, refreshError: snapshot.refreshError, persistenceError: snapshot.persistenceError,
      graphIds: snapshot.graphIds, retrievedAt: snapshot.retrievedAt, timing: snapshot.timing,
      truncated: snapshot.truncated, derivedEdges: edges.filter(edge => edge.kind === 'derived').length,
      collapsed: collapsedGraph.collapsed, hidden: collapsedGraph.nodes.length - visibleNodes.length,
      missingScopeIds: snapshot.missingScopeIds, scopeSize: snapshot.scopeIds.length, focusSize: focusIds.length,
    },
  };
}
