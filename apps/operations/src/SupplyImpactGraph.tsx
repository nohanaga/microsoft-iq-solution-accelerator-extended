import { useEffect, useEffectEvent, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { LogIn, Maximize, RefreshCw, Share2, ZoomIn, ZoomOut } from 'lucide-react';
import { clearImpactGraphCache, collectImpactGraph, graphCacheChangedEvent } from './fabric-impact';
import type { FabricGraphSnapshot } from './fabric-impact';
import { graphAuthenticationEvent, GraphSignInRequiredError, signInToGraph } from './fabric-graph-auth';
import { useWorkspace } from './workspace-context';
import { GraphCacheStatus } from './GraphCacheStatus';

export function SupplyImpactGraph({ supplierId, materialId, onSnapshot }: { supplierId: string; materialId?: string; onSnapshot: (snapshot: FabricGraphSnapshot | null) => void }) {
  const { repository, mode } = useWorkspace();
  const [snapshot, setSnapshot] = useState<FabricGraphSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'partial' | 'error' | 'auth' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const [depth, setDepth] = useState(3);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const reportSnapshot = useEffectEvent(onSnapshot);
  useEffect(() => {
    setSnapshot(null); reportSnapshot(null); setSelectedId('');
  }, [repository, mode, supplierId, materialId, depth]);
  useEffect(() => {
    const retry = () => setRevision(value => value + 1);
    window.addEventListener(graphAuthenticationEvent, retry);
    window.addEventListener(graphCacheChangedEvent, retry);
    return () => { window.removeEventListener(graphAuthenticationEvent, retry); window.removeEventListener(graphCacheChangedEvent, retry); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    if (mode !== 'live') { setState('unavailable'); return () => controller.abort(); }
    setState('loading');
    collectImpactGraph({ expand: (request, signal) => repository.graphExpand(request, signal), scopeModel: materialId ? 'development' : 'supply', scopeTableId: materialId ? 'materials' : 'suppliers', scopeRecordIds: [materialId ?? supplierId], depth, includeSupply: true, signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setSnapshot(result); reportSnapshot(result);
        setState(result.truncated || result.missingScopeIds.length ? 'partial' : 'ready');
      }).catch(reason => {
        if (controller.signal.aborted) return;
        setState(reason instanceof GraphSignInRequiredError ? 'auth' : 'error');
        setError(reason instanceof Error ? reason.message : '関係を取得できません。');
      });
    return () => controller.abort();
  }, [repository, mode, supplierId, materialId, depth, revision]);
  useEffect(() => {
    if (!snapshot || !host.current) return;
    const instance = cytoscape({ container: host.current, elements: [
      ...snapshot.nodes.map(node => ({ data: { id: node.id, label: `${node.domain === 'development' ? '開発' : '供給'} / ${node.label}\n${node.name}`, start: snapshot.scopeIds.includes(node.id) ? 1 : 0, domain: node.domain } })),
      ...snapshot.edges.map(edge => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.label, kind: edge.kind } })),
    ], minZoom: .15, maxZoom: 3, userZoomingEnabled: false, layout: { name: 'preset' } });
    graph.current = instance;
    const theme = () => {
      const tokens = getComputedStyle(document.documentElement);
      const color = (name: string) => tokens.getPropertyValue(`--cp-${name}`).trim();
      instance.style([
        { selector: 'node', style: { label: 'data(label)', shape: 'round-rectangle', width: 150, height: 54, 'background-color': color('surface'), 'border-color': color('link'), 'border-width': 1.5, color: color('text'), 'font-size': 11, 'font-family': getComputedStyle(document.body).fontFamily, 'text-wrap': 'wrap', 'text-max-width': '140px', 'text-valign': 'center', 'text-halign': 'center' } },
        { selector: 'node[domain="development"]', style: { 'border-color': color('success') } },
        { selector: 'node[start=1]', style: { 'border-color': color('accent'), 'border-width': 4, 'background-color': color('surface-soft') } },
        { selector: 'edge', style: { label: 'data(label)', 'line-color': color('border-strong'), 'target-arrow-color': color('border-strong'), 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', width: 1.5, 'font-size': 9, color: color('text-muted'), 'text-background-color': color('surface'), 'text-background-opacity': 1 } },
        { selector: 'edge[kind="derived"]', style: { 'line-style': 'dashed', 'target-arrow-shape': 'none' } },
        { selector: ':selected', style: { 'border-width': 4, 'border-color': color('accent') } },
      ]);
    };
    theme();
    instance.layout({ name: 'breadthfirst', directed: false, roots: snapshot.scopeIds.filter(id => instance.getElementById(id).length > 0), spacingFactor: 1.4, padding: 24, animate: false }).run();
    instance.on('tap', 'node', event => setSelectedId(event.target.id()));
    const observer = new MutationObserver(theme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const resize = new ResizeObserver(() => { instance.resize(); instance.fit(undefined, 24); });
    resize.observe(host.current);
    return () => { observer.disconnect(); resize.disconnect(); instance.destroy(); graph.current = null; };
  }, [snapshot]);
  const signIn = async () => {
    try { await signInToGraph(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'サインインできません。'); }
  };
  const selected = snapshot?.nodes.find(node => node.id === selectedId);
  return <section className="sr-graph" data-demo-target="supply-graph" data-demo-state={state} aria-label={materialId ? '材料からたどる関係' : '供給会社からたどる関係'}>
    <div className="section-heading"><h2><Share2 size={16}/>{materialId ? '材料からたどる関係' : '会社からたどる関係'}</h2><div className="sr-graph-tools"><label>探索段数<select value={depth} onChange={event => setDepth(Number(event.target.value))}>{[1, 2, 3, 4].map(value => <option key={value}>{value}</option>)}</select></label><button title="再取得" aria-label="関係を再取得" disabled={state === 'loading' || mode !== 'live'} onClick={() => { void clearImpactGraphCache(); }}><RefreshCw size={15}/></button><button title="拡大" aria-label="関係図を拡大" disabled={!snapshot} onClick={() => graph.current?.zoom(Math.min(3, graph.current.zoom() * 1.25))}><ZoomIn size={15}/></button><button title="縮小" aria-label="関係図を縮小" disabled={!snapshot} onClick={() => graph.current?.zoom(Math.max(.15, graph.current.zoom() / 1.25))}><ZoomOut size={15}/></button><button title="全体表示" aria-label="関係図の全体表示" disabled={!snapshot} onClick={() => graph.current?.fit(undefined, 24)}><Maximize size={15}/></button></div></div>
    {state === 'loading' && <p role="status">GraphModelの関係を取得中です。</p>}
    {state === 'unavailable' && <p className="scope-note">メモリーモードではGraphModel未接続です。</p>}
    {(state === 'auth' || state === 'error') && <p className="message error" role="alert">{error}{state === 'auth' && <button onClick={() => void signIn()}><LogIn size={16}/>Graphに接続</button>}</p>}
    {state === 'partial' && <p className="message" role="status">一部の関係のみ取得しました。探索範囲の打切り、または起点レコードの未取得があります。</p>}
    {mode === 'live' && <GraphCacheStatus state={snapshot} loading={state === 'loading'} error={error}/>}
    {snapshot && <><div ref={host} className="sr-graph-canvas" role="img" aria-label={`${snapshot.nodes.length} レコードの関係。破線は共通IDによる派生関係。`}/><div className="sr-graph-legend"><span>実線: GraphModelの関係</span><span>破線: 共通会社IDによる派生</span><span>到達した注文は関連記録</span></div><label>関連レコード<select aria-label="関係図のレコード" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">選択してください</option>{snapshot.nodes.map(node => <option key={node.id} value={node.id}>{node.domain === 'development' ? '開発' : '供給'} / {node.label} / {node.name}</option>)}</select></label>{selected && <p><strong>{selected.label} / {selected.name}</strong><br/><code>{selected.domain}:{selected.tableId}:{selected.recordId}</code></p>}<p className="scope-note">{snapshot.nodes.length} レコード / 照会 {snapshot.retrievedAt} / {Object.values(snapshot.graphIds).filter(Boolean).join(' / ')}</p></>}
  </section>;
}