import { useSyncExternalStore } from 'react';
import { AlertCircle, CircleCheck, CircleDashed, Database, FlaskConical, LoaderCircle, MemoryStick, Network, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getGraphActivity, subscribeGraphActivity } from './graph-activity';
import type { GraphLoadPhase } from './graph-activity';
import type { GraphCacheState } from './workspace-repository';
import './graph-cache-status.css';

const sourceLabels = { graph: 'Graph 取得', sql: 'SQL 復元', memory: 'メモリーキャッシュ' };
const phaseLabels = { cache: 'キャッシュ確認中', sql: 'SQL 読込中', auth: 'Graph 認証中', graph: 'Graph 取得中' };

export function GraphCacheStatus({ state, loading = false, phase, label, retrievedAt, error, compactIcon: CompactIcon }: {
  state: GraphCacheState | null | undefined; loading?: boolean; phase?: GraphLoadPhase; label?: string; retrievedAt?: string; error?: string; compactIcon?: LucideIcon;
}) {
  if (!state && !loading && !error) return null;
  const sources = state?.sources?.length ? state.sources : state?.source ? [state.source] : [];
  const busy = loading || state?.refreshing || state?.persistence === 'saving';
  const failure = error || state?.refreshError || state?.persistenceError;
  const Icon = busy ? LoaderCircle : failure ? AlertCircle : sources.length ? CircleCheck : CircleDashed;
  const text = phase ? phaseLabels[phase] : loading ? '照会中' : state?.refreshing ? '更新中' : sources.length ? '取得済み' : failure ? '取得失敗' : '未取得';
  const persistenceText = state?.persistence ? state.persistence === 'saved' ? 'SQL 保存済み' : state.persistence === 'saving' ? 'SQL 保存中' : 'SQL 保存失敗' : undefined;
  if (CompactIcon) {
    const details = [
      `${label ?? 'Graph'}: ${text}`,
      ...sources.map(source => `${sourceLabels[source]}${source === 'memory' && state?.cacheOrigin ? `（${state.cacheOrigin === 'sql' ? 'SQL 復元分' : 'Graph 取得分'}）` : ''}`),
      state?.stale ? '前回取得分' : undefined,
      persistenceText,
      retrievedAt ? `取得 ${new Date(retrievedAt).toLocaleString('ja-JP')}` : undefined,
      failure ? `${state?.persistenceError ? '保存失敗' : sources.length ? '更新失敗' : '取得失敗'}: ${failure}` : undefined,
    ].filter(Boolean).join('\n');
    const StatusIcon = state?.stale && !busy && !failure ? AlertCircle : Icon;
    return <div className="graph-cache-status graph-cache-status-compact" role="status" tabIndex={0} aria-label={details} data-state={busy ? 'loading' : failure ? 'error' : state?.stale ? 'stale' : sources.length ? 'ready' : 'idle'} data-source={sources.join(',')}>
      <span className="graph-cache-status-symbol"><CompactIcon size={18} aria-hidden="true"/>
        <StatusIcon size={12} aria-hidden="true" className={`graph-cache-status-badge${busy ? ' graph-status-spinner' : ''}`}/></span>
      <span className="graph-cache-status-tooltip" aria-hidden="true">{details}</span>
    </div>;
  }
  return <div className="graph-cache-status" role="status" data-state={busy ? 'loading' : failure ? 'error' : sources.length ? 'ready' : 'idle'} data-source={sources.join(',')}>
    <span className="graph-cache-status-main"><Icon size={14} aria-hidden="true" className={busy ? 'graph-status-spinner' : undefined}/>{label && <strong>{label}</strong>}<span>{text}</span></span>
    {sources.map(source => {
      const SourceIcon = source === 'sql' ? Database : source === 'graph' ? Network : MemoryStick;
      return <span className="graph-cache-status-source" key={source}><SourceIcon size={13} aria-hidden="true"/>{sourceLabels[source]}{source === 'memory' && state?.cacheOrigin && <span>（{state.cacheOrigin === 'sql' ? 'SQL 復元分' : 'Graph 取得分'}）</span>}</span>;
    })}
    {state?.stale && <span className="graph-cache-status-warning">前回取得分</span>}
    {persistenceText && <span className="graph-cache-status-save">{persistenceText}</span>}
    {retrievedAt && <time dateTime={retrievedAt} title={new Date(retrievedAt).toLocaleString('ja-JP')}>取得 {new Date(retrievedAt).toLocaleTimeString('ja-JP')}</time>}
    {failure && <span className="graph-cache-status-error" title={failure}>{state?.persistenceError ? '保存失敗' : sources.length ? '更新失敗' : '取得失敗'}: {failure}</span>}
  </div>;
}

export function GraphActivityStatus() {
  const activity = useSyncExternalStore(subscribeGraphActivity, getGraphActivity, getGraphActivity);
  return <div className="graph-activity-status" aria-label="グラフ取得状況">{(['development', 'supply'] as const).map(model => {
    const state = activity[model];
    const phase = (['graph', 'auth', 'sql', 'cache'] as const).find(value => state.phases.includes(value));
    return <GraphCacheStatus key={model} state={state} label={model === 'development' ? '開発 Graph' : '供給 Graph'} compactIcon={model === 'development' ? FlaskConical : Truck} phase={phase} loading={!!phase} retrievedAt={state.retrievedAt} error={state.error}/>;
  })}</div>;
}