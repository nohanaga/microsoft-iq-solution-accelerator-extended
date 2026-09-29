import { z } from 'zod';
import { analyticsConfig as liveConfig } from './connection-config';
import { developmentDefinition, supplyDefinition } from '../v3/ontology/model';
import { getGraphAccessToken, graphAuthenticationEvent, graphCacheIdentity, GraphSignInRequiredError } from './fabric-graph-auth';
import { clearGraphCache, graphCacheLifetime, readGraphCache, writeGraphCache } from './fabric-graph-cache';
import { graphSnapshotHash } from './graph-snapshot-repository';
import { beginGraphActivity, reportGraphError, reportGraphPersistence, reportGraphResult, resetGraphActivity } from './graph-activity';
import { fabricConfig } from './fabric.generated';
import type { GraphExpandRequest, GraphRequest, GraphResult } from './workspace-repository';

const responseSchema = z.object({
  status: z.object({ code: z.string(), description: z.string() }),
  result: z.object({ kind: z.literal('TABLE'), data: z.array(z.record(z.string(), z.unknown())) }).optional(),
});
const recordIdPattern = /^[A-Za-z0-9_.:-]{1,200}$/;
const maxExpandKeys = 40;
const snapshotLimit = 1001;
const schemaKeys = { development: JSON.stringify(developmentDefinition), supply: JSON.stringify(supplyDefinition) };
export const graphCacheChangedEvent = 'maikuro:graph-cache-changed';
export const graphRefreshAuthenticationEvent = 'maikuro:graph-refresh-auth-required';
const pendingQueries = new Map<string, { promise: Promise<GraphResult>; controller: AbortController }>();
const pendingRefreshes = new Map<string, { promise: Promise<GraphResult>; controller: AbortController }>();
const persistenceControllers = new Set<AbortController>();
const refreshFailures = new Map<string, { retryAt: number; error: Error }>();
const refreshedRevisions = new Map<string, number>();
let refreshRevision = 0;
const unavailableSnapshots = new Map<string, number>();
const adjacency = new WeakMap<GraphResult['rows'], Map<string, Map<string, GraphResult['rows']>>>();
let cacheGeneration = 0;
const entitySchema = z.object({ labels: z.array(z.string()), oid: z.string(), properties: z.record(z.string(), z.unknown()) });
const snapshotRowSchema = z.object({ source: entitySchema, target: entitySchema, relationship: entitySchema });

function notifyGraphCacheChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(graphCacheChangedEvent));
}

if (typeof window !== 'undefined') window.addEventListener(graphAuthenticationEvent, () => refreshFailures.clear());

export function graphRefreshNeedsAuthentication() {
  return [...refreshFailures.values()].some(failure => failure.error instanceof GraphSignInRequiredError);
}

export function refreshFabricGraphCache(notify = true) {
  refreshRevision += 1;
  refreshFailures.clear();
  unavailableSnapshots.clear();
  if (notify) notifyGraphCacheChanged();
}

export function clearFabricGraphCache(notify = true) {
  cacheGeneration += 1;
  for (const pending of pendingQueries.values()) pending.controller.abort();
  for (const pending of pendingRefreshes.values()) pending.controller.abort();
  for (const controller of persistenceControllers) controller.abort();
  pendingQueries.clear();
  pendingRefreshes.clear();
  persistenceControllers.clear();
  refreshFailures.clear();
  refreshedRevisions.clear();
  refreshRevision = 0;
  unavailableSnapshots.clear();
  const cleared = clearGraphCache();
  resetGraphActivity();
  if (notify) notifyGraphCacheChanged();
  return cleared;
}

function waitForQuery(pending: Promise<GraphResult>, signal: AbortSignal): Promise<GraphResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(result => {
      if (!signal.aborted) resolve(result);
    }, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function graphTable(model: GraphRequest['model'], tableId: string) {
  const definition = model === 'development' ? developmentDefinition : supplyDefinition;
  const table = definition.tables.find(candidate => candidate.id === tableId);
  if (!table) throw new Error(`Graph に存在しないテーブルです: ${tableId}`);
  const key = table.properties.find(property => property.sourceColumn === table.key)?.name;
  if (!key) throw new Error(`Graph キーが構成されていません: ${table.id}.${table.key}`);
  return { table, key };
}

function parseRows(rows: Record<string, unknown>[]) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => {
    if (typeof value !== 'string') return [name, value];
    try { return [name, JSON.parse(value) as unknown]; } catch { return [name, value]; }
  })));
}

function assertRecordId(recordId: string) {
  if (!recordIdPattern.test(recordId)) throw new Error('Graph のレコード ID に使用できない文字が含まれています。');
}

async function executeGraphQuery(model: GraphRequest['model'], query: string, signal: AbortSignal, snapshot = false): Promise<GraphResult> {
  const graphId = liveConfig.graphs[model];
  if (!graphId) throw new Error(`Fabric Graph が構成されていません: ${model}`);
  const identity = graphCacheIdentity();
  const generation = cacheGeneration;
  signal.throwIfAborted();
  const ensureCurrent = () => {
    if (generation !== cacheGeneration || identity !== graphCacheIdentity()) throw new DOMException('Graph session changed', 'AbortError');
  };
  ensureCurrent();
  const cacheKey = await graphSnapshotHash(JSON.stringify(['sql-v1', identity, fabricConfig.semanticModels.maikuroV3Live.workspaceId, graphId, schemaKeys[model], query]));
  ensureCurrent();
  const requestKey = JSON.stringify([generation, cacheKey]);
  let pending = pendingQueries.get(requestKey);
  if (!pending) {
    const controller = new AbortController();
    const promise = (async () => {
      let cached: GraphResult | undefined;
      const reading = beginGraphActivity(model, 'cache');
      try { cached = await readGraphCache(cacheKey, controller.signal, () => reading.phase('sql')); }
      catch { controller.signal.throwIfAborted(); }
      finally { reading.finish(); }
      ensureCurrent();
      controller.signal.throwIfAborted();
      const usable = cached?.graphId === graphId && !cached.truncated && (!snapshot || cached.rows.length < snapshotLimit)
        && cached.rows.every(row => snapshotRowSchema.safeParse(row).success) ? cached : undefined;
      const forced = (refreshedRevisions.get(cacheKey) ?? 0) < refreshRevision;
      const refresh = () => {
        const running = pendingRefreshes.get(requestKey);
        if (running) return running.promise;
        const failed = refreshFailures.get(cacheKey);
        if (failed && failed.retryAt > Date.now()) return Promise.reject(failed.error);
        const refreshController = new AbortController();
        const revision = refreshRevision;
        const updating = beginGraphActivity(model, 'auth');
        const request = (async () => {
          const accessToken = await getGraphAccessToken();
          ensureCurrent();
          refreshController.signal.throwIfAborted();
          updating.phase('graph');
          const result = await fetchGraphQuery(graphId, query, accessToken, refreshController.signal);
          ensureCurrent();
          refreshFailures.delete(cacheKey);
          const complete = !result.truncated && (!snapshot || result.rows.length < snapshotLimit);
          if (!complete && usable) throw new Error('更新結果が取得上限に達しました。前回の取得分を表示しています。');
          if (complete) {
            result.persistence = 'saving';
            reportGraphResult(model, result);
            refreshedRevisions.set(cacheKey, revision);
            persistenceControllers.add(refreshController);
            void writeGraphCache(cacheKey, result, refreshController.signal).then(() => {
              if (generation === cacheGeneration) reportGraphPersistence(model, result.retrievedAt);
            }, reason => {
              if (generation === cacheGeneration) reportGraphPersistence(model, result.retrievedAt, reason);
            }).finally(() => {
              persistenceControllers.delete(refreshController);
              if (generation === cacheGeneration) notifyGraphCacheChanged();
            });
          }
          return result;
        })().catch(reason => {
          if (generation === cacheGeneration && !refreshController.signal.aborted) {
            reportGraphError(model, reason);
            const error = reason instanceof Error ? reason : new Error('Graph を更新できません。');
            refreshFailures.set(cacheKey, { retryAt: Date.now() + 30_000, error });
            if (reason instanceof GraphSignInRequiredError && typeof window !== 'undefined') window.dispatchEvent(new Event(graphRefreshAuthenticationEvent));
          }
          throw reason;
        }).finally(() => {
          updating.finish();
          pendingRefreshes.delete(requestKey);
          if (generation === cacheGeneration) notifyGraphCacheChanged();
        });
        pendingRefreshes.set(requestKey, { promise: request, controller: refreshController });
        return request;
      };
      if (!usable) return refresh();
      if (usable.stale || forced) void refresh().catch(() => {});
      return {
        ...usable, stale: usable.stale || forced,
        refreshing: pendingRefreshes.has(requestKey), refreshError: refreshFailures.get(cacheKey)?.error.message,
      };
    })().finally(() => pendingQueries.delete(requestKey));
    pending = { promise, controller };
    pendingQueries.set(requestKey, pending);
  }
  const result = await waitForQuery(pending.promise, signal);
  ensureCurrent();
  reportGraphResult(model, result);
  return result;
}

async function fetchGraphQuery(graphId: string, query: string, accessToken: string, signal: AbortSignal): Promise<GraphResult> {
  const startedAt = performance.now();
  const response = await fetch(`https://api.fabric.microsoft.com/v1/workspaces/${fabricConfig.semanticModels.maikuroV3Live.workspaceId}/GraphModels/${graphId}/executeQuery?preview=true`, {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await response.json().catch(() => null);
  performance.clearMeasures('maikuro.graph.http');
  performance.measure('maikuro.graph.http', { start: startedAt, end: performance.now() });
  if (!response.ok) {
    const error = z.object({ errorCode: z.string(), message: z.string() }).safeParse(body);
    const detail = error.success ? `${error.data.errorCode}: ${error.data.message}` : response.statusText;
    throw new Error(`Fabric Graph の HTTP ${response.status}: ${detail}`);
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Fabric Graph から不正な応答を受信しました。');
  if (!/^0[0-3]/.test(parsed.data.status.code)) {
    throw new Error(`Fabric Graph ${parsed.data.status.code}: ${parsed.data.status.description}`);
  }
  if (!parsed.data.result && !/^02/.test(parsed.data.status.code)) throw new Error('Fabric Graph の照会結果がありません。');
  const rows = parseRows(parsed.data.result?.data ?? []);
  if (rows.some(row => !snapshotRowSchema.safeParse(row).success)) throw new Error('Fabric Graph の関係データが不正です。');
  return { rows, graphId, source: 'graph', cacheOrigin: 'graph', retrievedAt: new Date().toISOString(), truncated: /^01/.test(parsed.data.status.code) ? true : undefined };
}

async function modelSnapshot(model: GraphRequest['model'], signal: AbortSignal): Promise<GraphResult | undefined> {
  const key = JSON.stringify([graphCacheIdentity(), model, liveConfig.graphs[model]]);
  if ((unavailableSnapshots.get(key) ?? 0) > Date.now()) return;
  const query = `MATCH (source)-[\`relationship\`]->(target)\nRETURN TO_JSON_STRING(source) AS source, TO_JSON_STRING(\`relationship\`) AS \`relationship\`, TO_JSON_STRING(target) AS target LIMIT ${snapshotLimit};`;
  const result = await executeGraphQuery(model, query, signal, true);
  if (result.rows.length >= snapshotLimit || result.truncated) {
    unavailableSnapshots.set(key, Date.now() + graphCacheLifetime);
    return;
  }
  return result;
}

function snapshotRows(model: GraphRequest['model'], snapshot: GraphResult, tableId: string, recordIds: string[] | null, limit: number): GraphResult {
  let index = adjacency.get(snapshot.rows);
  if (!index) {
    index = new Map();
    const definition = model === 'development' ? developmentDefinition : supplyDefinition;
    const tables = new Map(definition.tables.map(table => [table.entityType, graphTable(model, table.id)]));
    const append = (entity: z.infer<typeof entitySchema>, row: Record<string, unknown>) => {
      for (const label of entity.labels) {
        const entry = tables.get(label);
        if (!entry) continue;
        const records = index!.get(entry.table.id) ?? new Map<string, GraphResult['rows']>();
        const recordId = String(entity.properties[entry.key] ?? entity.oid);
        const rows = records.get(recordId) ?? [];
        rows.push(row);
        records.set(recordId, rows);
        index!.set(entry.table.id, records);
      }
    };
    for (const value of snapshot.rows) {
      const parsed = snapshotRowSchema.safeParse(value);
      if (!parsed.success) throw new Error('Fabric Graph の関係データが不正です。');
      const row = parsed.data;
      append(row.source, row);
      if (row.source.oid !== row.target.oid) append(row.target, { source: row.target, relationship: row.relationship, target: row.source });
    }
    adjacency.set(snapshot.rows, index);
  }
  const records = index.get(tableId);
  const rows = recordIds ? recordIds.flatMap(recordId => records?.get(recordId) ?? []) : [...records?.values() ?? []].flat();
  return { ...snapshot, rows: rows.slice(0, limit), truncated: rows.length > limit };
}

export async function prefetchFabricGraphs(signal: AbortSignal) {
  const results = await Promise.allSettled((['development', 'supply'] as const).map(model => modelSnapshot(model, signal)));
  signal.throwIfAborted();
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

export async function queryFabricGraph(request: GraphRequest, signal: AbortSignal): Promise<GraphResult> {
  const { table, key } = graphTable(request.model, request.tableId);
  if (request.recordId) assertRecordId(request.recordId);
  const snapshot = await modelSnapshot(request.model, signal);
  if (snapshot) return snapshotRows(request.model, snapshot, request.tableId, request.recordId ? [request.recordId] : null, 100);
  const filter = request.recordId ? ` WHERE source.\`${key}\` = '${request.recordId}'` : '';
  const query = `MATCH (source:\`${table.entityType}\`${filter})-[\`relationship\`]-(target)\nRETURN TO_JSON_STRING(source) AS source, TO_JSON_STRING(\`relationship\`) AS \`relationship\`, TO_JSON_STRING(target) AS target LIMIT 100;`;
  return executeGraphQuery(request.model, query, signal);
}

/**
 * 指定した複数レコードの隣接を 1 ホップ取得する。向きを固定したパターンは、そのラベルに当該の向きの辺型が
 * 存在しないと GQLSTATUS 42000 になる（例: DevelopmentProduct は出向きの辺型を持たない）ため、無向で問い合わせる。
 */
export async function expandFabricGraph(request: GraphExpandRequest, signal: AbortSignal): Promise<GraphResult> {
  const { table, key } = graphTable(request.model, request.tableId);
  const recordIds = [...new Set(request.recordIds)].sort().slice(0, maxExpandKeys);
  if (!recordIds.length) throw new Error('Graph の展開対象が空です。');
  for (const recordId of recordIds) assertRecordId(recordId);
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 1000) throw new Error('Graph の取得上限が不正です。');
  const snapshot = await modelSnapshot(request.model, signal);
  if (snapshot) return snapshotRows(request.model, snapshot, request.tableId, recordIds, request.limit);
  const keys = recordIds.map(recordId => `'${recordId}'`).join(', ');
  const query = `MATCH (source:\`${table.entityType}\` WHERE source.\`${key}\` IN [${keys}])-[\`relationship\`]-(target)\nRETURN TO_JSON_STRING(source) AS source, TO_JSON_STRING(\`relationship\`) AS \`relationship\`, TO_JSON_STRING(target) AS target\nLIMIT ${request.limit};`;
  return executeGraphQuery(request.model, query, signal);
}
