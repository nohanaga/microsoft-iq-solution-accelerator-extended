import { z } from 'zod';
import { graphSnapshotHash, graphSnapshotUserId, readSqlGraphSnapshot, writeSqlGraphSnapshot } from './graph-snapshot-repository';
import type { GraphResult } from './workspace-repository';

export const graphCacheLifetime = 15 * 60_000;
const memory = new Map<string, GraphResult>();
let generation = 0;
const resultSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).max(1001),
  graphId: z.string(), retrievedAt: z.iso.datetime(), truncated: z.literal(false).optional(),
});

function remember(key: string, result: GraphResult) {
  memory.delete(key);
  memory.set(key, result);
  if (memory.size > 128) memory.delete(memory.keys().next().value!);
}

export async function readGraphCache(key: string, signal: AbortSignal, onSqlRead?: () => void): Promise<GraphResult | undefined> {
  signal.throwIfAborted();
  const current = generation;
  let result = memory.get(key);
  const source = result ? 'memory' : 'sql';
  if (!result) {
    onSqlRead?.();
    const stored = await readSqlGraphSnapshot(key, signal);
    signal.throwIfAborted();
    if (current !== generation || !stored) return;
    const parsed = resultSchema.parse(JSON.parse(stored.payload));
    if (parsed.graphId !== stored.graphId || parsed.retrievedAt !== stored.retrievedAt) throw new Error('SQL グラフの取得情報が一致しません。');
    if (Date.parse(parsed.retrievedAt) > Date.now() + 60_000) throw new Error('SQL グラフの取得日時が不正です。');
    result = { ...parsed, cacheOrigin: 'sql', persistence: 'saved' };
  }
  remember(key, result);
  return { ...result, source, cacheHit: true, stale: Date.now() - Date.parse(result.retrievedAt) >= graphCacheLifetime };
}

export async function writeGraphCache(key: string, result: GraphResult, signal: AbortSignal) {
  const userId = graphSnapshotUserId();
  const validated = resultSchema.parse(result);
  signal.throwIfAborted();
  const current = generation;
  const entry: GraphResult = { ...validated, cacheOrigin: 'graph', persistence: 'saving' };
  remember(key, entry);
  try {
    const payload = JSON.stringify(validated);
    const payloadHash = await graphSnapshotHash(payload);
    signal.throwIfAborted();
    if (userId !== graphSnapshotUserId()) throw new DOMException('Graph session changed', 'AbortError');
    await writeSqlGraphSnapshot(key, { graphId: validated.graphId, retrievedAt: validated.retrievedAt, payload, payloadHash }, signal);
    if (current === generation && memory.get(key) === entry && !signal.aborted) remember(key, { ...entry, persistence: 'saved' });
  } catch (reason) {
    if (current === generation && memory.get(key) === entry && !signal.aborted) {
      remember(key, { ...entry, persistence: 'failed', persistenceError: reason instanceof Error ? reason.message : 'SQL に保存できません。' });
    }
    throw reason;
  }
}

export function clearGraphCache() {
  generation += 1;
  memory.clear();
}