import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { Database, KeyRound, LogIn, Maximize2, Network, Search, X, ZoomIn, ZoomOut } from 'lucide-react';
import { ontologyElements } from './ontology-records';
import type { GraphScope, OntologyModel, RecordSelection } from './ontology-records';
import { useWorkspace } from './workspace-context';
import { graphAuthenticationEvent, GraphSignInRequiredError, signInToGraph } from './fabric-graph-auth';
import { graphCacheChangedEvent } from './fabric-graph-client';
import { GraphCacheStatus } from './GraphCacheStatus';
import type { GraphResult } from './workspace-repository';
import './ontology-explorer.css';

export interface OntologyNodeAnnotation {
  note: string;
  stopped?: boolean;
  affected?: boolean;
  vip?: boolean;
  allocated?: boolean;
}

interface OntologyExplorerProps {
  model: OntologyModel; scope?: GraphScope; title?: string; highlights?: string[];
  columns?: string[][]; selection?: RecordSelection | null; onSelection?: (value: RecordSelection | null) => void;
  fabricModel?: 'development' | 'supply';
  annotations?: Record<string, OntologyNodeAnnotation>;
  pathIds?: string[];
  recordOnly?: boolean;
  dataLabel?: string;
}

interface FabricEntity { labels: string[]; oid: string; properties: Record<string, unknown> }

function fabricEntity(value: unknown): FabricEntity | null {
  if (!value || typeof value !== 'object') return null;
  const entity = value as Record<string, unknown>;
  if (!Array.isArray(entity.labels) || typeof entity.oid !== 'string' || !entity.properties || typeof entity.properties !== 'object') return null;
  return { labels: entity.labels.map(String), oid: entity.oid, properties: entity.properties as Record<string, unknown> };
}

function fabricEntityView(model: OntologyModel, entity: FabricEntity) {
  const table = model.tables.find(candidate => entity.labels.includes(candidate.entityType));
  if (!table) return null;
  const key = table.properties.find(property => property.sourceColumn === table.key)?.name;
  const display = table.properties.find(property => property.sourceColumn === table.displayColumn)?.name;
  const recordId = String(entity.properties[key ?? ''] ?? entity.oid);
  return { table, recordId, label: String(entity.properties[display ?? ''] ?? recordId) };
}

function fabricElements(model: OntologyModel, result: GraphResult) {
  const nodes = new Map<string, { data: { id: string; tableId: string; label: string; recordId: string } }>();
  const edges: { data: { id: string; source: string; target: string; label: string } }[] = [];
  result.rows.forEach((row, index) => {
    const source = fabricEntity(row.source);
    const target = fabricEntity(row.target);
    const relationship = fabricEntity(row.relationship);
    const sourceView = source && fabricEntityView(model, source);
    const targetView = target && fabricEntityView(model, target);
    if (sourceView) nodes.set(`${sourceView.table.id}:${sourceView.recordId}`, { data: { id: `${sourceView.table.id}:${sourceView.recordId}`, tableId: sourceView.table.id, recordId: sourceView.recordId, label: `${sourceView.table.label}\n${sourceView.label}` } });
    if (targetView) nodes.set(`${targetView.table.id}:${targetView.recordId}`, { data: { id: `${targetView.table.id}:${targetView.recordId}`, tableId: targetView.table.id, recordId: targetView.recordId, label: `${targetView.table.label}\n${targetView.label}` } });
    if (sourceView && targetView) edges.push({ data: { id: `fabric:${relationship?.oid ?? index}`, source: `${sourceView.table.id}:${sourceView.recordId}`, target: `${targetView.table.id}:${targetView.recordId}`, label: relationship?.labels[0] ?? '関連' } });
  });
  return { nodes: [...nodes.values()], edges };
}

export function OntologyExplorer({ model, scope, title = 'オントロジー', highlights = [], columns, selection, onSelection, fabricModel, annotations = {}, pathIds = [], recordOnly = false, dataLabel }: OntologyExplorerProps) {
  const { repository, mode } = useWorkspace();
  const host = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const [view, setView] = useState<'records' | 'structure' | 'graph'>('records');
  const structure = view === 'structure';
  const usesFabric = mode === 'live' && !!fabricModel && view === 'graph';
  const [localSelection, setLocalSelection] = useState<RecordSelection | null>(null);
  const selected = selection === undefined ? localSelection : selection;
  const select = (value: RecordSelection | null) => { setLocalSelection(value); onSelection?.(value); };
  const selectRef = useRef(select);
  useEffect(() => { selectRef.current = select; });
  useEffect(() => { if (selected) inspector.current?.scrollIntoView({ block: 'nearest' }); }, [selected?.tableId, selected?.recordId]);
  const localElements = ontologyElements(model, scope, structure);
  const root = selected ?? (localElements.nodes[0] ? { tableId: localElements.nodes[0].data.tableId, recordId: localElements.nodes[0].data.recordId || undefined } : null);
  const [liveGraph, setLiveGraph] = useState<{ result: GraphResult | null; loading: boolean; error: string }>({ result: null, loading: false, error: '' });
  const [graphAuthRequired, setGraphAuthRequired] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [graphRevision, setGraphRevision] = useState(0);
  useEffect(() => {
    setLiveGraph({ result: null, loading: false, error: '' });
  }, [repository, usesFabric, fabricModel, root?.tableId, root?.recordId]);
  useEffect(() => {
    const retry = () => setGraphRevision(value => value + 1);
    window.addEventListener(graphAuthenticationEvent, retry);
    window.addEventListener(graphCacheChangedEvent, retry);
    return () => { window.removeEventListener(graphAuthenticationEvent, retry); window.removeEventListener(graphCacheChangedEvent, retry); };
  }, []);
  const signIn = async () => {
    setSigningIn(true);
    try {
      await signInToGraph();
    } catch (reason) {
      setLiveGraph({ result: null, loading: false, error: reason instanceof Error ? reason.message : 'Graph にサインインできません。' });
    } finally { setSigningIn(false); }
  };
  useEffect(() => {
    setGraphAuthRequired(false);
    if (!usesFabric || !fabricModel || !root) {
      setLiveGraph({ result: null, loading: false, error: '' });
      return;
    }
    const controller = new AbortController();
    setLiveGraph(current => ({ ...current, loading: true, error: '' }));
    repository.graph({ model: fabricModel, tableId: root.tableId, recordId: root.recordId ?? '' }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setLiveGraph({ result, loading: false, error: '' }); })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setGraphAuthRequired(reason instanceof GraphSignInRequiredError);
        setLiveGraph({ result: null, loading: false, error: reason instanceof Error ? reason.message : 'Fabric Graph に接続できません。' });
      });
    return () => controller.abort();
  }, [repository, usesFabric, fabricModel, root?.tableId, root?.recordId, graphRevision]);
  const elements = usesFabric ? (liveGraph.result ? fabricElements(model, liveGraph.result) : { nodes: [], edges: [] }) : localElements;
  const signature = JSON.stringify({ elements, columns, highlights, usesFabric, annotations: structure ? {} : annotations, pathIds: structure ? [] : pathIds });
  useEffect(() => {
    if (!host.current) return;
    const input = JSON.parse(signature) as { elements: ReturnType<typeof ontologyElements>; columns?: string[][]; highlights: string[]; usesFabric: boolean; annotations: Record<string, OntologyNodeAnnotation>; pathIds: string[] };
    const palette = () => {
      const tokens = getComputedStyle(document.documentElement);
      const color = (name: string) => tokens.getPropertyValue(`--cp-${name}`).trim();
      return [
        { selector: 'node', style: { label: 'data(label)', width: 150, height: 65, shape: 'round-rectangle', 'background-color': color('surface'), 'border-color': color('border-strong'), 'border-width': 1.2, color: color('text'), 'text-wrap': 'wrap', 'text-max-width': '138px', 'text-valign': 'center', 'text-halign': 'center', 'font-family': getComputedStyle(document.body).fontFamily, 'font-size': 12 } },
        { selector: 'edge', style: { label: 'data(label)', width: 1.4, 'line-color': color('border-strong'), 'target-arrow-color': color('border-strong'), 'target-arrow-shape': input.usesFabric ? 'none' : 'triangle', 'curve-style': 'bezier', 'font-size': 9, color: color('text-muted'), 'text-background-color': color('surface-soft'), 'text-background-opacity': 1, 'text-background-padding': '3px' } },
        { selector: 'node[tableId = "origins"]', style: { 'border-color': color('success'), 'border-width': 2 } },
        { selector: 'node[tableId = "materials"]', style: { 'border-color': color('accent'), 'border-width': 2 } },
        { selector: 'node[tableId = "stocks"]', style: { 'border-color': color('link'), 'border-width': 2 } },
        { selector: 'node.risk', style: { 'border-color': color('danger'), 'border-width': 3 } },
        { selector: 'node.affected', style: { 'border-color': color('danger'), 'border-width': 3 } },
        { selector: 'edge.affected', style: { 'line-color': color('danger'), 'target-arrow-color': color('danger'), width: 2.5 } },
        { selector: 'node.vip', style: { shape: 'hexagon', 'border-color': color('warning'), 'border-width': 4 } },
        { selector: 'node.allocated', style: { 'border-color': color('success'), 'border-width': 4 } },
        { selector: 'node.stopped', style: { 'background-color': color('danger'), color: color('surface'), 'border-color': color('danger'), 'border-width': 4 } },
        { selector: 'node.path', style: { 'underlay-color': color('link'), 'underlay-opacity': .18, 'underlay-padding': 6 } },
        { selector: 'edge.path', style: { 'line-color': color('link'), 'target-arrow-color': color('link'), width: 4 } },
        { selector: 'node:selected', style: { 'underlay-color': color('link'), 'underlay-opacity': .15, 'underlay-padding': 7 } },
      ] satisfies cytoscape.StylesheetJson;
    };
    const instance = cytoscape({ container: host.current, elements: [...input.elements.nodes, ...input.elements.edges], layout: { name: 'preset' }, style: palette(), minZoom: .15, maxZoom: 3, userZoomingEnabled: false, autoungrabify: true });
    graph.current = instance;
    input.highlights.forEach(id => instance.getElementById(id).addClass('risk'));
    Object.entries(input.annotations).forEach(([id, annotation]) => {
      const node = instance.getElementById(id);
      if (!node.length) return;
      if (annotation.note) node.data('label', `${node.data('label')}\n${annotation.note}`);
      for (const state of ['stopped', 'affected', 'vip', 'allocated'] as const) if (annotation[state]) node.addClass(state);
    });
    instance.edges().forEach(edge => {
      if ((edge.source().hasClass('affected') || edge.source().hasClass('stopped')) && (edge.target().hasClass('affected') || edge.target().hasClass('stopped'))) edge.addClass('affected');
      if (input.pathIds.includes(edge.source().id()) && input.pathIds.includes(edge.target().id())) edge.addClass('path');
    });
    input.pathIds.forEach(id => instance.getElementById(id).addClass('path'));
    const resize = () => {
      instance.resize();
      const groups = input.columns ?? model.tables.map(row => [row.id]);
      const slots = new Map<string, { column: number; row: number; count: number }>();
      groups.forEach((tables, column) => {
        const matches = instance.nodes().filter(node => tables.includes(node.data('tableId') as string));
        matches.forEach((node, row) => { slots.set(node.id(), { column, row, count: matches.length }); });
      });
      instance.nodes().positions(node => {
        const slot = slots.get(node.id()) ?? { column: groups.length, row: 0, count: 1 };
        return { x: 95 + slot.column * 220, y: 65 + slot.row * 115 + (6 - Math.min(6, slot.count)) * 25 };
      });
      instance.fit(undefined, 24);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    const theme = new MutationObserver(() => instance.style(palette()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    instance.on('tap', 'node', event => selectRef.current({ tableId: String(event.target.data('tableId')), recordId: String(event.target.data('recordId')) || undefined }));
    resize();
    return () => { observer.disconnect(); theme.disconnect(); instance.destroy(); graph.current = null; };
  }, [signature, structure]);
  useEffect(() => {
    const instance = graph.current;
    if (!instance) return;
    instance.elements().unselect();
    if (selected?.recordId) instance.getElementById(`${selected.tableId}:${selected.recordId}`).select();
  }, [signature, selected?.tableId, selected?.recordId]);
  const zoom = (factor: number) => { const instance = graph.current; if (instance) instance.zoom({ level: instance.zoom() * factor, renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 } }); };
  return <section className="ontology-explorer" aria-label={title}>
    <div className="ontology-heading"><h2><Network size={17}/>{title}</h2><div className="ontology-tools"><button title="拡大" aria-label="オントロジーを拡大" onClick={() => zoom(1.2)}><ZoomIn size={15}/></button><button title="縮小" aria-label="オントロジーを縮小" onClick={() => zoom(1 / 1.2)}><ZoomOut size={15}/></button><button title="全体表示" aria-label="オントロジーの全体表示" onClick={() => graph.current?.fit(undefined, 24)}><Maximize2 size={15}/></button></div></div>
    <div className="ontology-toolbar"><div role="group" aria-label="オントロジーの表示"><button aria-pressed={!structure && !usesFabric} onClick={() => { setView('records'); select(null); }}>{dataLabel ?? (mode === 'live' ? 'Fabric データ' : 'レコード')}</button>{!recordOnly && <button aria-pressed={structure} onClick={() => { setView('structure'); select(null); }}>構造</button>}{mode === 'live' && fabricModel && <button aria-pressed={usesFabric} title="GraphModel を直接照会" onClick={() => { setView('graph'); select(null); }}>GraphModel</button>}</div><span>{usesFabric && liveGraph.error ? '照会できません' : liveGraph.loading && usesFabric ? 'Fabric Graph を照会中' : `${elements.nodes.length} ${structure ? '型' : '件'} / ${elements.edges.length} 関係${usesFabric ? ' / GraphModel' : ''}`}</span><button className="ontology-data-button" onClick={() => select({ tableId: model.tables[0].id })}><Database size={14}/>データ</button></div>
    {liveGraph.error && usesFabric && <p className="ontology-graph-error" role="alert">{liveGraph.error}</p>}
    {usesFabric && <GraphCacheStatus state={liveGraph.result} loading={liveGraph.loading} error={liveGraph.error}/>}
    {usesFabric && liveGraph.result && <p className="scope-note">取得: {new Date(liveGraph.result.retrievedAt).toLocaleString('ja-JP')}</p>}
    {usesFabric && graphAuthRequired && <button className="ontology-data-button" disabled={signingIn} onClick={() => void signIn()}><LogIn size={14}/>{signingIn ? '認証中' : 'Graph にサインイン'}</button>}
    <div className="ontology-visual"><div ref={host} className="ontology-canvas" role="img" aria-label={`${title}の${structure ? 'エンティティ型' : 'データレコード'}と、キーで結び付いた関係`}/>{!elements.nodes.length && !liveGraph.loading && !(usesFabric && liveGraph.error) && <p className="ontology-empty">{usesFabric ? 'Fabric Graph に直接つながるレコードはありません。' : '対象のレコードはありません。'}</p>}</div>
    <div className="ontology-access"><label>対象<select aria-label="オントロジーのレコードを選択" value={selected ? `${selected.tableId}:${selected.recordId ?? ''}` : ''} onChange={event => { const [tableId, ...recordId] = event.target.value.split(':'); if (tableId) select({ tableId, recordId: recordId.join(':') || undefined }); }}><option value="">選択してください</option>{selected && !elements.nodes.some(node => node.data.tableId === selected.tableId && node.data.recordId === (selected.recordId ?? '')) && <option value={`${selected.tableId}:${selected.recordId ?? ''}`}>{model.tables.find(row => row.id === selected.tableId)?.label} / {selected.recordId ?? '全レコード'}</option>}{elements.nodes.map(node => <option key={node.data.id} value={`${node.data.tableId}:${node.data.recordId}`}>{node.data.label.replaceAll('\n', ' ')}{node.data.recordId ? ` / ${node.data.recordId}` : ''}</option>)}</select></label></div>
    <div ref={inspector}>{selected && (usesFabric ? <FabricRecordInspector key={`${selected.tableId}:${selected.recordId ?? ''}`} model={model} selection={selected} result={liveGraph.result} loading={liveGraph.loading} error={liveGraph.error} onSelect={select} onClose={() => select(null)}/> : <RecordInspector key={`${selected.tableId}:${selected.recordId ?? ''}`} model={model} selection={selected} fabricData={mode === 'live'} sourceLabel={dataLabel} onSelect={select} onClose={() => select(null)}/>)}</div>
  </section>;
}

function FabricRecordInspector({ model, selection, result, loading, error, onSelect, onClose }: { model: OntologyModel; selection: RecordSelection; result: GraphResult | null; loading: boolean; error: string; onSelect: (value: RecordSelection) => void; onClose: () => void }) {
  const sourceTable = model.tables.find(row => row.id === selection.tableId);
  const root = result?.rows.map(row => fabricEntity(row.source)).find(Boolean) ?? null;
  const related = (result?.rows ?? []).flatMap(row => {
    const target = fabricEntity(row.target);
    const view = target && fabricEntityView(model, target);
    const relationship = fabricEntity(row.relationship);
    return view ? [{ ...view, relationship: relationship?.labels[0] ?? '関連' }] : [];
  });
  return <section className="ontology-records" aria-label="Fabric Graph レコード">
    <div className="ontology-record-heading"><h3><Database size={16}/>{sourceTable?.label ?? selection.tableId}<code>Fabric Graph</code></h3><button title="閉じる" aria-label="レコードを閉じる" onClick={onClose}><X size={16}/></button></div>
    <div className="ontology-provenance"><span>GraphModel <code>{result?.graphId ?? '照会中'}</code></span><span>{result ? new Date(result.retrievedAt).toLocaleString('ja-JP') : ''}</span></div>
    {loading && <p className="empty">関連を照会しています。</p>}
    {error && <p className="message error" role="alert">{error}</p>}
    {root && <div className="table-scroll"><table><thead><tr><th>プロパティ</th><th>値</th></tr></thead><tbody>{Object.entries(root.properties).map(([name, value]) => <tr key={name}><td>{name}</td><td>{value === null ? <span className="ontology-null">null</span> : String(value)}</td></tr>)}</tbody></table></div>}
    {!loading && !error && <div className="table-scroll"><table><thead><tr><th>関係</th><th>関連先</th><th>レコード</th></tr></thead><tbody>{related.map((row, index) => <tr key={`${row.table.id}:${row.recordId}:${index}`}><td>{row.relationship}</td><td>{row.table.label}</td><td><button className="ontology-key-link" onClick={() => onSelect({ tableId: row.table.id, recordId: row.recordId })}>{row.label}</button></td></tr>)}</tbody></table>{!related.length && result && <p className="empty">直接つながるレコードはありません。</p>}</div>}
  </section>;
}

export function RecordInspector({ model, selection, onSelect, onClose, fabricData = false, sourceLabel }: { model: OntologyModel; selection: RecordSelection; onSelect: (value: RecordSelection) => void; onClose: () => void; fabricData?: boolean; sourceLabel?: string }) {
  const [tab, setTab] = useState<'records' | 'properties' | 'relations'>('records');
  const [query, setQuery] = useState('');
  const [allRows, setAllRows] = useState(!selection.recordId);
  const sourceTable = model.tables.find(row => row.id === selection.tableId);
  if (!sourceTable) return null;
  const rows = sourceTable.rows.filter(row => (allRows || String(row[sourceTable.key]) === selection.recordId) && Object.values(row).some(value => String(value ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const relations = model.relations.filter(row => row.source === sourceTable.id || row.target === sourceTable.id);
  const draftOnly = !allRows && selection.recordId?.startsWith('DRAFT');
  const hasDraft = rows.some(row => String(row[sourceTable.key]).startsWith('DRAFT'));
  const cell = (row: typeof sourceTable.rows[number], column: string) => {
    const value = row[column];
    if (value === null) return <span className="ontology-null">null</span>;
    const link = relations.find(candidate => candidate.source === sourceTable.id && candidate.targetColumn === column);
    return link && value !== undefined ? <button className="ontology-key-link" onClick={() => onSelect({ tableId: link.target, recordId: String(value) })}>{String(value)}</button> : String(value ?? '');
  };
  return <section className="ontology-records" aria-label="データレコード">
    <div className="ontology-record-heading"><h3><Database size={16}/>{sourceTable.label}<code>{sourceTable.entityType}</code></h3><button title="閉じる" aria-label="レコードを閉じる" onClick={onClose}><X size={16}/></button></div>
    <div className="ontology-provenance"><span>データ元 <code>{sourceLabel ? `${sourceLabel} / ${sourceTable.id}` : draftOnly ? `配合下書き / ${sourceTable.id}` : fabricData ? `Fabric / ${sourceTable.id}` : `${sourceTable.source}#/${sourceTable.id}`}</code>{hasDraft && !draftOnly && <span>＋ 配合下書き</span>}</span><span><KeyRound size={12}/>キー <code>{sourceTable.key}</code></span><span>{sourceLabel ?? (draftOnly ? '下書き' : fabricData ? 'Fabric データ' : 'メモリー')}{hasDraft ? ' / 下書き未配置' : ''}</span></div>
    <div className="ontology-record-tabs" role="group" aria-label="レコード情報"><button aria-pressed={tab === 'records'} onClick={() => setTab('records')}>レコード</button><button aria-pressed={tab === 'properties'} onClick={() => setTab('properties')}>プロパティ</button><button aria-pressed={tab === 'relations'} onClick={() => setTab('relations')}>関連定義</button><select aria-label="データテーブル" value={sourceTable.id} onChange={event => onSelect({ tableId: event.target.value })}>{model.tables.map(row => <option key={row.id} value={row.id}>{row.label} / {row.id}</option>)}</select></div>
    {tab === 'records' && <><div className="ontology-record-filter"><label><Search size={14}/><input aria-label="レコード検索" placeholder="レコードを検索" value={query} onChange={event => setQuery(event.target.value)}/></label>{selection.recordId && <label><input type="checkbox" checked={allRows} onChange={event => setAllRows(event.target.checked)}/>同じ型の全レコード</label>}<span>{rows.length} 件</span></div><div className="table-scroll"><table><thead><tr>{sourceTable.properties.map(field => <th key={field.name}>{field.sourceColumn === sourceTable.key && <KeyRound size={10}/>} {field.sourceColumn}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={String(row[sourceTable.key])} className={String(row[sourceTable.key]) === selection.recordId ? 'is-selected' : ''}>{sourceTable.properties.map(field => <td key={field.name}>{cell(row, field.sourceColumn)}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="empty">該当するレコードはありません。</p>}</div></>}
    {tab === 'properties' && <div className="table-scroll"><table><thead><tr><th>プロパティ</th><th>元の列</th><th>Fabric 値型</th><th>キー</th></tr></thead><tbody>{sourceTable.properties.map(field => <tr key={field.name}><td>{field.name}</td><td>{field.sourceColumn}</td><td>{field.valueType}</td><td>{field.sourceColumn === sourceTable.key ? '主キー' : ''}</td></tr>)}</tbody></table></div>}
    {tab === 'relations' && <div className="table-scroll"><table><thead><tr><th>関係</th><th>参照元</th><th>参照先</th><th>対応テーブル / 列</th></tr></thead><tbody>{relations.map(link => <tr key={link.id}><td>{link.name}</td><td>{model.tables.find(row => row.id === link.source)?.entityType}</td><td>{model.tables.find(row => row.id === link.target)?.entityType}</td><td>{link.mappingTable}: {link.sourceColumn} → {link.targetColumn}</td></tr>)}</tbody></table></div>}
  </section>;
}