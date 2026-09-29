import { GraphCacheStatus } from './GraphCacheStatus';
import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { ArrowRight, Hand, LayoutGrid, LogIn, Maximize, Maximize2, Minimize, Orbit, RefreshCw, RotateCcw, Share2, Tag, Waypoints, ZoomIn, ZoomOut } from 'lucide-react';
import type { BeanImpact, ImpactNode } from './bean-impact';
import type { RecordSelection } from './ontology-records';

interface BeanImpactFlowProps {
  impact: BeanImpact | null;
  depth: number;
  onDepth: (value: number) => void;
  onSelect: (value: RecordSelection) => void;
  simplified: boolean;
  onSimplified: (value: boolean) => void;
  includeSupply: boolean;
  onIncludeSupply: (value: boolean) => void;
  status: { loading: boolean; error: string; authRequired: boolean; available: boolean };
  onRetry: () => void;
  onSignIn: () => void;
}
type FlowLayout = 'columns' | 'rings';

const changeLabels: Record<string, string> = { added: '追加', removed: '除外', increased: '増加', decreased: '減少', kept: '据置' };
const depths = [1, 2, 3, 4];
const zoomStep = 1.25;
const emptyImpact = { nodes: [] as BeanImpact['nodes'], edges: [] as BeanImpact['edges'] };

export function BeanImpactFlow({ impact, depth, onDepth, onSelect, simplified, onSimplified, includeSupply, onIncludeSupply, status, onRetry, onSignIn }: BeanImpactFlowProps) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const arrange = useRef<() => void>(() => {});
  const clear = useRef<() => void>(() => {});
  const pinned = useRef<string | null>(null);
  const details = useRef(new Map<string, ImpactNode>());
  const selectRef = useRef(onSelect);
  const layoutRef = useRef<FlowLayout>('columns');
  const [layout, setLayout] = useState<FlowLayout>('columns');
  const [expanded, setExpanded] = useState(false);
  const [labels, setLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    selectRef.current = onSelect;
    layoutRef.current = layout;
    details.current = new Map((impact?.nodes ?? []).map(node => [node.id, node]));
  });
  const signature = JSON.stringify({
    nodes: (impact?.nodes ?? emptyImpact.nodes).map(({ id, tableId, recordId, domain, hop, label, name, metric, start, change, risk }) => ({ id, tableId, recordId, domain, hop, label, name, metric, start, change, risk })),
    edges: (impact?.edges ?? emptyImpact.edges).map(({ id, source, target, label, kind, span }) => ({ id, source, target, label, kind, span })),
  });
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    const input = JSON.parse(signature) as { nodes: Omit<ImpactNode, 'detail' | 'entityType'>[]; edges: { id: string; source: string; target: string; label: string; kind: string; span: number }[] };
    const palette = () => {
      const tokens = getComputedStyle(document.documentElement);
      const color = (name: string) => tokens.getPropertyValue(`--cp-${name}`).trim();
      return [
        { selector: 'node', style: { label: 'data(label)', width: 152, height: 56, shape: 'round-rectangle', 'background-color': color('surface'), 'border-color': color('border-strong'), 'border-width': 1.2, color: color('text'), 'text-wrap': 'wrap', 'text-max-width': '138px', 'text-valign': 'center', 'text-halign': 'center', 'font-family': getComputedStyle(document.body).fontFamily, 'font-size': 12, 'transition-property': 'opacity', 'transition-duration': 140 } },        { selector: 'edge', style: { label: 'data(label)', width: 1.4, 'line-color': color('border-strong'), 'target-arrow-color': color('border-strong'), 'target-arrow-shape': 'triangle', 'arrow-scale': .85, 'curve-style': 'bezier', 'font-size': 9, color: color('text-muted'), 'text-background-color': color('surface-soft'), 'text-background-opacity': 1, 'text-background-padding': '3px' } },
        { selector: 'node[tableId = "materials"]', style: { 'border-color': color('accent'), 'border-width': 2, height: 68 } },
        { selector: 'node[tableId = "suppliers"]', style: { 'border-color': color('warning'), 'border-width': 2.5, 'background-color': color('surface-soft') } },
        { selector: 'node[tableId = "products"]', style: { 'border-color': color('success'), 'border-width': 2 } },
        { selector: 'node[tableId = "recipes"]', style: { shape: 'round-diamond', width: 150, height: 80 } },
        { selector: 'node[domain = "supply"]', style: { shape: 'round-tag', 'border-color': color('link'), 'border-width': 2 } },
        { selector: 'edge[kind = "derived"]', style: { 'line-style': 'dashed', 'target-arrow-shape': 'none', 'line-color': color('text-muted'), width: 1.1 } },
        { selector: 'node.is-start', style: { 'underlay-color': color('accent'), 'underlay-opacity': .22, 'underlay-padding': 8, 'border-width': 3 } },
        { selector: 'node.is-added', style: { 'background-color': color('accent'), 'background-opacity': .12 } },
        { selector: 'node.is-risk', style: { 'border-color': color('danger'), 'border-width': 3.5, 'background-color': color('danger'), 'background-opacity': .1, 'border-style': 'double' } },
        { selector: 'edge.is-span', style: { 'line-style': 'dashed', 'curve-style': 'unbundled-bezier', 'control-point-distances': [-92], 'control-point-weights': [.5] } },
        { selector: '.is-dim', style: { opacity: .14 } },
        { selector: 'node.is-focus', style: { 'underlay-color': color('link'), 'underlay-opacity': .2, 'underlay-padding': 9 } },
        { selector: 'edge.is-focus', style: { width: 2.6, 'line-color': color('link'), 'target-arrow-color': color('link'), color: color('link'), 'z-index': 9 } },
        { selector: 'node:selected', style: { 'underlay-color': color('link'), 'underlay-opacity': .18, 'underlay-padding': 8 } },
      ] satisfies cytoscape.StylesheetJson;
    };
    const instance = cytoscape({
      container,
      elements: [
        ...input.nodes.map(node => ({
          data: { id: node.id, tableId: node.tableId, recordId: node.recordId, domain: node.domain, hop: node.hop, label: `${node.label}\n${node.name}${node.metric ? `\n${node.metric}` : ''}` },
          classes: [node.start ? 'is-start' : '', node.change === 'added' ? 'is-added' : '', node.risk ? 'is-risk' : ''].filter(Boolean).join(' '),
        })),
        ...input.edges.map(edge => ({ data: edge, classes: edge.span > 1 ? 'is-span' : '' })),
      ],
      layout: { name: 'preset' }, style: palette(), minZoom: .12, maxZoom: 4, userZoomingEnabled: false, boxSelectionEnabled: false,
    });
    graph.current = instance;
    const levels = [...new Set(input.nodes.map(node => node.hop))].sort((first, second) => first - second);
    const place = () => {
      const tallest = Math.max(...levels.map(level => input.nodes.filter(node => node.hop === level).length), 1);
      instance.nodes().positions(node => {
        const hop = Number(node.data('hop'));
        const column = input.nodes.filter(row => row.hop === hop);
        const index = Math.max(0, column.findIndex(row => row.id === node.id()));
        if (layoutRef.current === 'rings') {
          if (hop === 0 && column.length === 1) return { x: 0, y: 0 };
          const radius = hop === 0 ? 82 : 110 + hop * 150;
          const angle = Math.PI * 2 * index / column.length + hop * .38;
          return { x: Math.round(Math.cos(angle) * radius * 1.3), y: Math.round(Math.sin(angle) * radius) };
        }
        return { x: 100 + levels.indexOf(hop) * 260, y: 56 + (tallest - column.length) * 46 + index * 92 };
      });
    };
    arrange.current = () => { instance.resize(); place(); instance.fit(undefined, 26); setZoom(instance.zoom()); };
    const highlight = (id: string | null) => {
      instance.batch(() => {
        instance.elements().removeClass('is-dim is-focus');
        if (!id) return;
        const node = instance.getElementById(id);
        if (node.empty()) return;
        const neighborhood = node.closedNeighborhood();
        instance.elements().difference(neighborhood).addClass('is-dim');
        neighborhood.addClass('is-focus');
      });
    };
    if (pinned.current && instance.getElementById(pinned.current).empty()) pinned.current = null;
    clear.current = () => { highlight(pinned.current); setHover(null); };
    clear.current();
    const observer = new ResizeObserver(() => arrange.current());
    observer.observe(container);
    const theme = new MutationObserver(() => instance.style(palette()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    instance.on('zoom', () => setZoom(instance.zoom()));
    instance.on('tap', 'node', event => {
      pinned.current = pinned.current === event.target.id() ? null : event.target.id();
      clear.current();
      selectRef.current({ tableId: String(event.target.data('tableId')), recordId: String(event.target.data('recordId')) });
    });
    instance.on('tap', event => {
      if (event.target !== instance) return;
      pinned.current = null;
      clear.current();
    });
    instance.on('mouseover', 'node', event => {
      if (!pinned.current) highlight(event.target.id());
      const position = event.target.renderedPosition();
      setHover({ id: event.target.id(), x: Math.round(position.x), y: Math.round(position.y - event.target.renderedHeight() / 2) });
    });
    instance.on('mouseout', 'node', () => clear.current());
    instance.on('grab pan', () => setHover(null));
    const leave = () => clear.current();
    container.addEventListener('mouseleave', leave);
    // Cytoscape のホイール拡大縮小を切り、拡大縮小ボタンと同じ倍率でカーソル位置を基点に変更する。
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const bounds = container.getBoundingClientRect();
      instance.zoom({
        level: instance.zoom() * (event.deltaY < 0 ? zoomStep : 1 / zoomStep),
        renderedPosition: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      });
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    arrange.current();
    return () => { container.removeEventListener('mouseleave', leave); container.removeEventListener('wheel', onWheel); observer.disconnect(); theme.disconnect(); instance.destroy(); graph.current = null; arrange.current = () => {}; clear.current = () => {}; };
  }, [signature]);
  useEffect(() => { clear.current(); arrange.current(); }, [layout, expanded]);
  useEffect(() => {
    const edges = graph.current?.edges();
    if (!edges) return;
    // inline styles cannot hold a data() mapper, so restore the stylesheet value instead.
    if (labels) edges.removeStyle('label'); else edges.style('label', '');
  }, [labels, signature]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);
  const scale = (factor: number) => {
    const instance = graph.current;
    if (instance) instance.zoom({ level: instance.zoom() * factor, renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 } });
  };
  const hovered = hover ? details.current.get(hover.id) : null;
  const moved = (impact?.changes ?? []).filter(row => row.kind !== 'kept');
  const added = moved.filter(row => row.kind === 'added');
  const supplyOrders = impact?.counts.find(row => row.tableId === 'orders')?.count ?? 0;
  const supplyStores = impact?.counts.find(row => row.tableId === 'stores')?.count ?? 0;
  return <section className={`dd-impact${expanded ? ' is-expanded' : ''}`} aria-label="豆の変更による波及範囲">
    <div className="dd-impact-heading">
      <h2><Share2 size={17}/>この豆はどこまで影響するか</h2>
      <div className="dd-impact-tools">
        <div className="dd-impact-depth" role="group" aria-label="たどる関係の段数"><span>段数</span>{depths.map(value => <button key={value} type="button" aria-pressed={depth === value} onClick={() => onDepth(value)}>{value}</button>)}</div>
        <div className="dd-impact-layout" role="group" aria-label="配置">
          <button type="button" aria-pressed={layout === 'columns'} title="段ごとの列に並べる" onClick={() => setLayout('columns')}><LayoutGrid size={13}/>段</button>
          <button type="button" aria-pressed={layout === 'rings'} title="波及の半径として並べる" onClick={() => setLayout('rings')}><Orbit size={13}/>半径</button>
        </div>
        <button type="button" aria-pressed={labels} title="関係名の表示を切り替え" aria-label="関係名の表示を切り替え" onClick={() => setLabels(value => !value)}><Tag size={14}/></button>
        <button type="button" aria-pressed={simplified} title={simplified ? '中間実体を畳んでいます。解除すると GraphModel の関係をそのまま表示します。' : '中間実体を畳んで読みやすくします。'} onClick={() => onSimplified(!simplified)}><Waypoints size={14}/>簡略</button>
        <button type="button" aria-pressed={includeSupply} title="調達先を共有する供給側オントロジーまで追跡します。" onClick={() => onIncludeSupply(!includeSupply)}>供給まで</button>
        <button type="button" title="再取得" aria-label="波及範囲を再取得" onClick={onRetry}><RefreshCw size={14}/></button>
        <span className="dd-impact-divider"/>
        <button type="button" title="縮小" aria-label="波及範囲を縮小" onClick={() => scale(1 / zoomStep)}><ZoomOut size={15}/></button>
        <output className="dd-impact-zoom" aria-label="拡大率">{Math.round(zoom * 100)}%</output>
        <button type="button" title="拡大" aria-label="波及範囲を拡大" onClick={() => scale(zoomStep)}><ZoomIn size={15}/></button>
        <button type="button" title="全体表示" aria-label="波及範囲の全体表示" onClick={() => graph.current?.fit(undefined, 26)}><Maximize2 size={15}/></button>
        <button type="button" title="配置を戻す" aria-label="配置を初期状態に戻す" onClick={() => arrange.current()}><RotateCcw size={15}/></button>
        <button type="button" aria-pressed={expanded} title={expanded ? '通常表示に戻す' : '全画面で表示'} aria-label={expanded ? '通常表示に戻す' : '全画面で表示'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize size={15}/> : <Maximize size={15}/>}</button>
      </div>
    </div>
    <p className="dd-impact-lead" role="status">
      {added.length
        ? <><strong>{added.map(row => row.name).join('・')}</strong> を追加しました。</>
        : moved.length ? <><strong>配合を変更</strong>しました（{moved.map(row => `${row.name} ${row.before ?? 0}→${row.after ?? 0}%`).join(' / ')}）。</>
          : <>登録配合のままの依存関係です。豆を追加すると、変更点を起点に波及範囲を強調します。</>}
      {impact
        ? <>Fabric GraphModel を {impact.reach} 段たどると、<strong>調達先 {impact.suppliers.length} 社</strong>{impact.supplyReached ? <>・<strong>注文 {supplyOrders} 件</strong>・店舗 {supplyStores} 件</> : null}に届きます。</>
        : status.loading ? <>Fabric GraphModel を照会しています。</> : <>波及範囲は未取得です。</>}
    </p>
    {!status.available && <p className="dd-impact-state" role="status">実データ取得モードで Fabric GraphModel に接続すると波及範囲を表示します。メモリーモードでは代替の関係を組み立てません。</p>}
    {status.error && <p className="dd-impact-state is-error" role="alert">{status.error}</p>}
    {status.authRequired && <button type="button" className="dd-impact-signin" onClick={onSignIn}><LogIn size={14}/>Graph にサインイン</button>}
    {status.available && <GraphCacheStatus state={impact?.provenance} loading={status.loading} error={status.error}/>}
    {impact && <ul className="dd-impact-counts">{impact.counts.map(row => <li key={`${row.label}-${row.tableId}`}><span>{row.label}</span><strong>{row.count}</strong></li>)}</ul>}
    <div className="dd-impact-visual" data-layout={layout}>
      <div ref={host} className="dd-impact-canvas" role="img" aria-label={`変更した豆から ${impact?.reach ?? 0} 段先までの関係。到達した調達先は ${impact?.suppliers.map(row => row.name).join('、') || 'なし'}。`}/>
      {hovered && hover && <div className="dd-impact-tip" style={{ left: `${hover.x}px`, top: `${hover.y}px` }}>
        <strong>{hovered.name}</strong>
        <span>{hovered.label} / 関係 {hovered.hop} 段先{hovered.metric ? ` / ${hovered.metric}` : ''}</span>
        {hovered.detail && <em>{hovered.detail}</em>}
        <code>{hovered.entityType} · {hovered.recordId}</code>
      </div>}
      {status.loading && <p className="dd-impact-loading" role="status">照会中</p>}
      <p className="dd-impact-hint"><Hand size={11}/>ホイールで拡大縮小、ドラッグで移動。ノードは個別に動かせます。カーソルを合わせると隣接だけを強調し、クリックでレコードを開きます。</p>
    </div>
    {impact && <div className="dd-impact-suppliers">
      <h3>到達した調達先</h3>
      {impact.suppliers.length ? <ul>{impact.suppliers.map(row => <li key={row.id}>
        <button type="button" onClick={() => onSelect({ tableId: 'suppliers', recordId: row.id })}><strong>{row.name}</strong><span>{row.city}</span></button>
        <span className="dd-impact-supply">
          {row.direct.length > 0 && <em>変更した配合の豆：{row.direct.join('・')}</em>}
          {row.shared.length > 0 && <em>同じ調達先の他の豆：{row.shared.join('・')}</em>}
          <em>関係 {row.hop} 段先</em>
        </span>
      </li>)}</ul> : <p>到達した調達先はありません。</p>}
    </div>}
    <div className="dd-impact-legend">
      <span className="dd-impact-swatch is-start"/>変更した豆
      <span className="dd-impact-swatch is-risk"/>不足・未確認
      <span className="dd-impact-swatch is-supplier"/>調達先
      <span className="dd-impact-swatch is-supply"/>供給オントロジー
      <span className="dd-impact-arrow"><ArrowRight size={12}/></span>宣言された関係：{impact?.edges.filter(row => row.kind === 'asserted').length ?? 0} 本
      <span className="dd-impact-arrow is-derived"/>畳み込みによる派生：{impact?.provenance.derivedEdges ?? 0} 本
    </div>
    {impact && <ul className="dd-impact-changes">{impact.changes.map(row => <li key={row.materialId} data-kind={row.kind}>
      <span>{changeLabels[row.kind]}</span><strong>{row.name}</strong>
      <em>{row.before === null ? '—' : `${row.before}%`} → {row.after === null ? '—' : `${row.after}%`}</em>
    </li>)}</ul>}
    {impact && <details className="dd-impact-records">
      <summary>到達したレコード {impact.nodes.length} 件の内訳</summary>
      <div className="table-scroll"><table><thead><tr><th>段</th><th>オントロジー</th><th>エンティティ型</th><th>レコード</th><th>内容</th></tr></thead><tbody>{impact.nodes.map(node => <tr key={node.id}>
        <td>{node.hop}</td><td>{node.domain === 'supply' ? 'MaikuroV3Supply' : 'MaikuroV3Development'}</td><td>{node.label}<small>{node.entityType}</small></td>
        <td><button type="button" className="dd-record-link" onClick={() => onSelect({ tableId: node.tableId, recordId: node.recordId })}>{node.name}</button></td>
        <td>{node.detail || '—'}</td>
      </tr>)}</tbody></table></div>
    </details>}
    {impact && <details className="dd-impact-records">
      <summary>関係 {impact.edges.length} 本の出所</summary>
      <div className="table-scroll"><table><thead><tr><th>種別</th><th>関係</th><th>起点</th><th>終点</th><th>根拠</th></tr></thead><tbody>{impact.edges.map(edge => <tr key={edge.id}>
        <td>{edge.kind === 'derived' ? '派生' : '宣言'}</td><td>{edge.label}</td>
        <td>{impact.nodes.find(node => node.id === edge.source)?.name ?? edge.source}</td>
        <td>{impact.nodes.find(node => node.id === edge.target)?.name ?? edge.target}</td>
        <td>{edge.kind === 'derived' ? edge.detail : 'GraphModel が返した関係です。'}</td>
      </tr>)}</tbody></table></div>
    </details>}
    {impact && <p className="scope-note">
      ノードと関係は Fabric GraphModel の GQL 応答だけを使用しています（
      {impact.provenance.graphIds.development ? `MaikuroV3Development ${impact.provenance.graphIds.development}` : 'Development 未取得'}
      {impact.provenance.graphIds.supply ? ` / MaikuroV3Supply ${impact.provenance.graphIds.supply}` : ''}
      、照会 {impact.provenance.timing.queryCount} 回 / キャッシュ {impact.provenance.timing.cacheHits} 件 / {impact.provenance.timing.rounds} ラウンド
      、所要 {(impact.provenance.timing.elapsedMs / 1000).toFixed(1)} 秒（最も遅い 1 本 {Math.round(impact.provenance.timing.slowestQueryMs)} ミリ秒）
      、取得 {new Date(impact.provenance.retrievedAt).toLocaleString('ja-JP')}）。
      取得範囲は焙煎豆 {impact.provenance.scopeSize} 種、段数の起点は {impact.provenance.focusSize} 種です。
      {impact.provenance.collapsed > 0 && `中間実体 ${impact.provenance.collapsed} 件を破線の派生関係に畳んでいます。`}
      {impact.provenance.hidden > 0 && `産地・製造拠点・在庫 ${impact.provenance.hidden} 件を非表示にしています。`}
      {impact.provenance.missingScopeIds.length > 0 && `取得範囲のうち ${impact.provenance.missingScopeIds.join('、')} は GraphModel に見つかりませんでした。`}
      {impact.provenance.truncated && '取得上限に達したため、到達範囲は一部です。'}
      未保存の配合下書きはグラフに含めません。合成データの試算であり、発注・契約・品質判断ではありません。
    </p>}
  </section>;
}
