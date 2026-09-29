import { graphRelations, graphTables } from './ontology-records';
import type { GraphDomain, GraphTableInfo } from './ontology-records';
import type { GraphCacheState, GraphExpandRequest, GraphResult } from './workspace-repository';

export interface FabricGraphNode {
  id: string; domain: GraphDomain; tableId: string; entityType: string; label: string;
  recordId: string; name: string; properties: Record<string, unknown>;
}
export interface FabricGraphEdge {
  id: string; source: string; target: string; label: string;
  kind: 'asserted' | 'derived'; via: string | null; detail: string;
}
export interface FabricGraphTiming {
  queryCount: number; cacheHits: number; elapsedMs: number; slowestQueryMs: number; rounds: number;
}
export interface FabricGraphSnapshot extends GraphCacheState {
  nodes: FabricGraphNode[]; edges: FabricGraphEdge[];
  scopeIds: string[]; graphIds: Partial<Record<GraphDomain, string>>;
  retrievedAt: string; timing: FabricGraphTiming; truncated: boolean; missingScopeIds: string[];
}
export type GraphExpander = (request: GraphExpandRequest, signal: AbortSignal) => Promise<GraphResult>;
export { refreshFabricGraphCache as clearImpactGraphCache, graphCacheChangedEvent } from './fabric-graph-client';

const rowLimit = 200;
const nodeBudget = 400;
const keyBatch = 40;
const concurrency = 4;
/** 中間実体を畳んで派生辺にできるエンティティ型と、辺に載せる属性プロパティ。 */
const bridgeEntityTypes: Record<string, { property: string; format: (value: unknown) => string } | null> = {
  BlendRecipeLine: { property: 'recipeLines_percent', format: value => `${Number(value)}%` },
  BeanReservation: { property: 'reservations_grams', format: value => `${(Number(value) / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 2 })} kg` },
};

interface RawEntity { labels: string[]; oid: string; properties: Record<string, unknown> }

function rawEntity(value: unknown): RawEntity | null {
  const entity = value as Partial<RawEntity> | null;
  if (!entity || typeof entity !== 'object') return null;
  if (!Array.isArray(entity.labels) || typeof entity.oid !== 'string' || !entity.properties || typeof entity.properties !== 'object') return null;
  return { labels: entity.labels.map(String), oid: entity.oid, properties: entity.properties as Record<string, unknown> };
}

function tableIndex(domain: GraphDomain) {
  return new Map(graphTables(domain).map(table => [table.entityType, table] as const));
}

function relationIndex(domain: GraphDomain) {
  return new Set(graphRelations(domain).map(relation => `${relation.name}|${relation.sourceEntityType}|${relation.targetEntityType}`));
}

function toNode(domain: GraphDomain, table: GraphTableInfo, entity: RawEntity): FabricGraphNode {
  const recordId = String(entity.properties[table.keyProperty] ?? entity.oid);
  return {
    id: `${domain}:${table.id}:${recordId}`, domain, tableId: table.id, entityType: table.entityType,
    label: table.label, recordId, name: String(entity.properties[table.displayProperty] ?? recordId),
    properties: entity.properties,
  };
}

async function runConcurrently<Input, Output>(inputs: Input[], task: (input: Input) => Promise<Output>): Promise<Output[]> {
  const outputs: Output[] = new Array(inputs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (next < inputs.length) {
      const index = next++;
      outputs[index] = await task(inputs[index]);
    }
  }));
  return outputs;
}

/**
 * 起点レコードから Fabric GraphModel を 1 ホップずつ展開する。辺は GraphModel が返したものだけを保持し、
 * 同じレベルの問い合わせは並列に、既に取得済みのレコードはキャッシュから返す。
 */
export async function collectImpactGraph(options: {
  expand: GraphExpander; scopeTableId: string; scopeRecordIds: string[];
  scopeModel?: GraphDomain;
  depth: number; includeSupply: boolean; bridgeTableId?: string; signal: AbortSignal;
}): Promise<FabricGraphSnapshot> {
  const { expand, scopeTableId, depth, includeSupply, signal } = options;
  const scopeModel = options.scopeModel ?? 'development';
  const otherModel = scopeModel === 'development' ? 'supply' : 'development';
  const bridgeTableId = options.bridgeTableId ?? 'suppliers';
  const scopeRecordIds = [...new Set(options.scopeRecordIds)];
  const nodes = new Map<string, FabricGraphNode>();
  const edges = new Map<string, FabricGraphEdge>();
  const startedAt = performance.now();
  const retrievedTimes: string[] = [];
  const cacheState: GraphCacheState = {};
  const sources = new Set<NonNullable<GraphResult['source']>>();
  const origins = new Set<NonNullable<GraphResult['cacheOrigin']>>();
  const refreshErrors = new Set<string>();
  const persistenceErrors = new Set<string>();
  const graphIds: Partial<Record<GraphDomain, string>> = {};
  const timing: FabricGraphTiming = { queryCount: 0, cacheHits: 0, elapsedMs: 0, slowestQueryMs: 0, rounds: 0 };
  let truncated = false;

  const fetchNeighbors = async (domain: GraphDomain, tableId: string, recordIds: string[]) => {
    const measuredAt = performance.now();
    const result = await expand({ model: domain, tableId, recordIds, limit: rowLimit }, signal);
    signal.throwIfAborted();
    const elapsed = performance.now() - measuredAt;
    timing.queryCount += result.cacheHit ? 0 : 1;
    if (result.cacheHit) timing.cacheHits += recordIds.length;
    timing.slowestQueryMs = Math.max(timing.slowestQueryMs, elapsed);
    graphIds[domain] = result.graphId;
    retrievedTimes.push(result.retrievedAt);
    cacheState.stale ||= result.stale;
    cacheState.refreshing ||= result.refreshing;
    if (result.source) sources.add(result.source);
    if (result.cacheOrigin) origins.add(result.cacheOrigin);
    if (result.persistence === 'failed' || (cacheState.persistence !== 'failed' && result.persistence === 'saving') || !cacheState.persistence) cacheState.persistence = result.persistence;
    if (result.refreshError) refreshErrors.add(result.refreshError);
    if (result.persistenceError) persistenceErrors.add(result.persistenceError);
    truncated ||= result.truncated ?? result.rows.length >= rowLimit;
    return result.rows;
  };

  const absorb = (domain: GraphDomain, tables: Map<string, GraphTableInfo>, relations: Set<string>, rows: Record<string, unknown>[]) => {
    const discovered: FabricGraphNode[] = [];
    for (const row of rows) {
      const source = rawEntity(row.source);
      const target = rawEntity(row.target);
      const relationship = rawEntity(row.relationship);
      const sourceTable = source && tables.get(source.labels.find(label => tables.has(label)) ?? '');
      const targetTable = target && tables.get(target.labels.find(label => tables.has(label)) ?? '');
      if (!source || !target || !sourceTable || !targetTable) continue;
      const sourceNode = toNode(domain, sourceTable, source);
      const targetNode = toNode(domain, targetTable, target);
      for (const node of [sourceNode, targetNode]) {
        if (nodes.has(node.id)) continue;
        if (nodes.size >= nodeBudget) { truncated = true; continue; }
        nodes.set(node.id, node);
        discovered.push(node);
      }
      if (!nodes.has(sourceNode.id) || !nodes.has(targetNode.id)) continue;
      const label = relationship?.labels[0] ?? '関連';
      // 無向で問い合わせているので、関係型の宣言された端点で向きを戻す。
      const reversed = !relations.has(`${label}|${sourceTable.entityType}|${targetTable.entityType}`)
        && relations.has(`${label}|${targetTable.entityType}|${sourceTable.entityType}`);
      const [from, to] = reversed ? [targetNode.id, sourceNode.id] : [sourceNode.id, targetNode.id];
      const id = `${from}>${to}:${label}`;
      if (!edges.has(id)) edges.set(id, { id, source: from, target: to, label, kind: 'asserted', via: null, detail: '' });
    }
    return discovered;
  };

  const traverse = async (domain: GraphDomain, seeds: Map<string, string[]>, levels: number) => {
    const tables = tableIndex(domain);
    const relations = relationIndex(domain);
    const visited = new Set<string>();
    let frontier = seeds;
    for (let level = 0; level < levels && frontier.size; level += 1) {
      const requests: { tableId: string; recordIds: string[] }[] = [];
      for (const [tableId, recordIds] of frontier) {
        const pending = recordIds.filter(recordId => !visited.has(`${tableId}:${recordId}`));
        for (const recordId of pending) visited.add(`${tableId}:${recordId}`);
        for (let offset = 0; offset < pending.length; offset += keyBatch) {
          requests.push({ tableId, recordIds: pending.slice(offset, offset + keyBatch) });
        }
      }
      if (!requests.length) break;
      signal.throwIfAborted();
      timing.rounds += 1;
      const responses = await runConcurrently(requests, request => fetchNeighbors(domain, request.tableId, request.recordIds));
      signal.throwIfAborted();
      const next = new Map<string, Set<string>>();
      for (const rows of responses) {
        for (const node of absorb(domain, tables, relations, rows)) {
          if (visited.has(`${node.tableId}:${node.recordId}`)) continue;
          const bucket = next.get(node.tableId) ?? new Set<string>();
          bucket.add(node.recordId);
          next.set(node.tableId, bucket);
        }
      }
      if (nodes.size >= nodeBudget) { truncated = true; break; }
      frontier = new Map([...next].map(([tableId, ids]) => [tableId, [...ids]]));
    }
  };

  await traverse(scopeModel, new Map([[scopeTableId, scopeRecordIds]]), depth);

  const reachedBridge = [...nodes.values()].filter(node => node.domain === scopeModel && node.tableId === bridgeTableId);
  if (includeSupply && reachedBridge.length) {
    await traverse(otherModel, new Map([[bridgeTableId, reachedBridge.map(node => node.recordId)]]), depth);
    for (const node of reachedBridge) {
      const counterpart = `${otherModel}:${bridgeTableId}:${node.recordId}`;
      if (!nodes.has(counterpart)) continue;
      const id = `${node.id}>${counterpart}:同一取引先`;
      edges.set(id, {
        id, source: node.id, target: counterpart, label: '同一取引先', kind: 'derived',
        via: '共通キー', detail: `${node.recordId} が両オントロジーで同じ識別子を持つため連結しています。`,
      });
    }
  }

  timing.elapsedMs = Math.round(performance.now() - startedAt);
  const scopeIds = scopeRecordIds.map(recordId => `${scopeModel}:${scopeTableId}:${recordId}`);
  return {
    nodes: [...nodes.values()], edges: [...edges.values()], scopeIds, truncated, timing,
    ...cacheState, refreshError: [...refreshErrors].join(' / '), persistenceError: [...persistenceErrors].join(' / '),
    sources: [...sources], cacheOrigin: origins.size === 1 ? [...origins][0] : undefined,
    graphIds,
    retrievedAt: retrievedTimes.sort()[0] ?? new Date().toISOString(),
    missingScopeIds: scopeRecordIds.filter(recordId => !nodes.has(`${scopeModel}:${scopeTableId}:${recordId}`)),
  };
}

/** 取得済みグラフ上で中間実体を畳む。生成した辺は派生として印を残し、経由した実体を保持する。 */
export function collapseBridges(snapshot: FabricGraphSnapshot): { nodes: FabricGraphNode[]; edges: FabricGraphEdge[]; collapsed: number } {
  const bridges = snapshot.nodes.filter(node => node.entityType in bridgeEntityTypes);
  if (!bridges.length) return { nodes: snapshot.nodes, edges: snapshot.edges, collapsed: 0 };
  const bridgeIds = new Set(bridges.map(node => node.id));
  const edges = snapshot.edges.filter(edge => !bridgeIds.has(edge.source) && !bridgeIds.has(edge.target));
  const derived = new Map<string, FabricGraphEdge>();
  for (const bridge of bridges) {
    const incident = snapshot.edges.filter(edge => edge.source === bridge.id || edge.target === bridge.id);
    const neighbors = [...new Set(incident.map(edge => edge.source === bridge.id ? edge.target : edge.source))]
      .filter(id => !bridgeIds.has(id));
    const attribute = bridgeEntityTypes[bridge.entityType];
    const value = attribute ? bridge.properties[attribute.property] : undefined;
    const suffix = attribute && value !== undefined && value !== null ? ` ${attribute.format(value)}` : '';
    const relations = [...new Set(incident.map(edge => edge.label))].join(' + ');
    for (let first = 0; first < neighbors.length; first += 1) {
      for (let second = first + 1; second < neighbors.length; second += 1) {
        const id = `${neighbors[first]}~${neighbors[second]}:${bridge.entityType}:${bridge.recordId}`;
        derived.set(id, {
          id, source: neighbors[first], target: neighbors[second], label: `${bridge.label}${suffix}`,
          kind: 'derived', via: bridge.entityType,
          detail: `${bridge.label} ${bridge.recordId} を経由（${relations}）。GraphModel 上は直接の関係ではありません。`,
        });
      }
    }
  }
  return {
    nodes: snapshot.nodes.filter(node => !bridgeIds.has(node.id)),
    edges: [...edges, ...derived.values()],
    collapsed: bridges.length,
  };
}

/** 注目レコードからの段数を、取得済みの辺だけを使って数える。 */
export function measureHops(nodes: FabricGraphNode[], edges: FabricGraphEdge[], focusIds: string[]) {
  const present = new Set(nodes.map(node => node.id));
  const adjacency = new Map<string, string[]>();
  const connect = (from: string, to: string) => {
    const bucket = adjacency.get(from);
    if (bucket) bucket.push(to); else adjacency.set(from, [to]);
  };
  for (const edge of edges) {
    if (!present.has(edge.source) || !present.has(edge.target)) continue;
    connect(edge.source, edge.target);
    connect(edge.target, edge.source);
  }
  const hops = new Map<string, number>(focusIds.filter(id => present.has(id)).map(id => [id, 0]));
  let frontier = [...hops.keys()];
  for (let level = 1; frontier.length; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (hops.has(neighbor)) continue;
        hops.set(neighbor, level);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return hops;
}
