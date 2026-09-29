import type { GraphCacheState, GraphRequest, GraphResult } from './workspace-repository';

export type GraphLoadPhase = 'cache' | 'sql' | 'auth' | 'graph';
export interface GraphActivity extends GraphCacheState { phases: GraphLoadPhase[]; retrievedAt?: string; error?: string }
type GraphModel = GraphRequest['model'];
const listeners = new Set<() => void>();
const active = { development: new Map<symbol, GraphLoadPhase>(), supply: new Map<symbol, GraphLoadPhase>() };
const empty = (): Record<GraphModel, GraphActivity> => ({ development: { phases: [] }, supply: { phases: [] } });
let snapshot = empty();
let generation = 0;

export function getGraphActivity() { return snapshot; }
export function subscribeGraphActivity(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(model: GraphModel, patch: Partial<GraphActivity> = {}) {
  const phases = [...active[model].values()];
  snapshot = { ...snapshot, [model]: { ...snapshot[model], ...patch, phases, refreshing: phases.some(phase => phase === 'auth' || phase === 'graph') } };
  for (const listener of listeners) listener();
}
export function beginGraphActivity(model: GraphModel, phase: GraphLoadPhase) {
  const id = Symbol();
  const current = generation;
  active[model].set(id, phase);
  publish(model);
  return {
    phase(next: GraphLoadPhase) {
      if (generation !== current) return;
      active[model].set(id, next); publish(model);
    },
    finish() {
      if (generation !== current) return;
      active[model].delete(id); publish(model);
    },
  };
}
export function reportGraphResult(model: GraphModel, result: GraphResult) {
  const { source, cacheOrigin, persistence, retrievedAt, stale, refreshing, refreshError, persistenceError } = result;
  publish(model, { source, cacheOrigin, persistence, retrievedAt, stale, refreshing, refreshError, persistenceError, error: refreshError ?? (stale ? snapshot[model].error : undefined) });
}
export function reportGraphError(model: GraphModel, error: unknown) {
  publish(model, { error: error instanceof Error ? error.message : 'Graph を取得できません。', refreshing: false });
}
export function reportGraphPersistence(model: GraphModel, retrievedAt: string, error?: unknown) {
  if (snapshot[model].retrievedAt !== retrievedAt) return;
  publish(model, { persistence: error ? 'failed' : 'saved', persistenceError: error ? error instanceof Error ? error.message : 'SQL に保存できません。' : undefined });
}
export function resetGraphActivity() {
  generation += 1;
  active.development.clear(); active.supply.clear(); snapshot = empty();
  for (const listener of listeners) listener();
}