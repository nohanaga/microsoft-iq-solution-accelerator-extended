import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, Crosshair, Minus, Plus, Ruler, Scan, Truck } from 'lucide-react';
import type { Store, Supplier } from './domain';
import type { SupplyShipment } from './supply-model';
import { arrivalLabels, delayLabel, isLate, supplyDate } from './supply-model';
import { createTileViewport, distanceKm, fitView, geoNote, scaleBarKm, storeGeo, supplierGeo } from './supply-geo';
import type { MapView } from './supply-geo';
import './supply-flow-map.css';

/** 全体表示のときに地名ラベルを逃がす余白。 */
const PADDING = 84;
const MIN_ZOOM = 5;
const MAX_ZOOM = 16;
type Tone = 'late' | 'ontime' | 'scheduled' | 'unknown';
type Hover = { kind: 'flow' | 'store' | 'supplier'; id: string; x: number; y: number };
interface Vector { x: number; y: number }

const toneOf = (row: SupplyShipment): Tone => isLate(row) ? 'late'
  : row.state === 'on-time' ? 'ontime' : row.state === 'scheduled' ? 'scheduled' : 'unknown';
const quadraticPoint = (from: Vector, control: Vector, to: Vector, t: number): Vector => ({
  x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x,
  y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y,
});
const shorten = (point: Vector, towards: Vector, by: number): Vector => {
  const dx = point.x - towards.x, dy = point.y - towards.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: point.x - (dx / length) * by, y: point.y - (dy / length) * by };
};
const degrees = (value: number) => `${value.toFixed(2)}°`;
const shortId = (id: string) => id.replace('SHP-JP-', '').replace('SHP-', '');
const barLabel = (km: number) => km >= 1 ? `${km} km` : `${km * 1000} m`;

interface SupplyFlowMapProps {
  stores: Store[];
  suppliers: Supplier[];
  rows: SupplyShipment[];
  asOf: string;
  selectedId: string;
  storeId: string;
  onSelectShipment: (id: string) => void;
  onClearShipment: () => void;
  onSelectStore: (id: string) => void;
}

export function SupplyFlowMap({ stores, suppliers, rows, asOf, selectedId, storeId, onSelectShipment, onClearShipment, onSelectStore }: SupplyFlowMapProps) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [moved, setMoved] = useState<{ key: string; view: MapView } | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const surfaceRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; distance: number } | null>(null);
  const draggedRef = useRef(false);
  const wheelRef = useRef<(event: WheelEvent) => void>(() => {});
  const panRef = useRef<(event: PointerEvent) => void>(() => {});
  const observerRef = useRef<ResizeObserver | null>(null);
  const detachWheel = useRef<(() => void) | null>(null);

  // データ到着後に初めて mount することがあるので、監視はコールバック ref で張る。
  const attachBox = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({
      width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height),
    }));
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  // React の onWheel は passive なので、拡大縮小には生のリスナーが要る。
  const attachSurface = useCallback((element: SVGSVGElement | null) => {
    detachWheel.current?.();
    detachWheel.current = null;
    surfaceRef.current = element;
    if (!element) return;
    const listener = (event: WheelEvent) => wheelRef.current(event);
    element.addEventListener('wheel', listener, { passive: false });
    detachWheel.current = () => element.removeEventListener('wheel', listener);
  }, []);

  const located = rows.filter(row => storeGeo.has(row.shipment.storeId) && supplierGeo.has(row.shipment.supplierId));
  const unmapped = rows.length - located.length;
  const activeSuppliers = new Set(located.map(row => row.shipment.supplierId));
  const mapStores = stores.filter(row => storeGeo.has(row.id));
  const mapSuppliers = suppliers.filter(row => activeSuppliers.has(row.id));
  const anchors = [...mapStores.map(row => storeGeo.get(row.id)!), ...mapSuppliers.map(row => supplierGeo.get(row.id)!)];
  // 拠点の顔ぶれか表示サイズが変わったら、手動の移動を捨てて全体表示へ戻す。
  const fitKey = `${mapStores.map(row => row.id).join()}|${mapSuppliers.map(row => row.id).join()}|${size.width}x${size.height}`;
  const ready = anchors.length > 0 && size.width > 0 && size.height > 0;
  const view = ready
    ? (moved?.key === fitKey ? moved.view : fitView(anchors, size.width, size.height, PADDING))
    : null;
  const viewport = view ? createTileViewport(view, size.width, size.height) : null;
  const applyView = (next: MapView) => setMoved({ key: fitKey, view: next });

  const zoomBy = (delta: number, anchor?: { x: number; y: number }) => {
    if (!view || !viewport) return;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom + delta));
    if (zoom === view.zoom) return;
    if (!anchor) return applyView({ ...view, zoom });
    const before = viewport.locate(anchor.x, anchor.y);
    const after = createTileViewport({ ...view, zoom }, size.width, size.height).locate(anchor.x, anchor.y);
    applyView({
      zoom,
      center: {
        latitude: view.center.latitude + (before.latitude - after.latitude),
        longitude: view.center.longitude + (before.longitude - after.longitude),
      },
    });
  };
  wheelRef.current = event => {
    if (!surfaceRef.current) return;
    event.preventDefault();
    const box = surfaceRef.current.getBoundingClientRect();
    zoomBy(event.deltaY > 0 ? -0.32 : 0.32, { x: event.clientX - box.left, y: event.clientY - box.top });
  };
  panRef.current = event => {
    const drag = dragRef.current;
    if (!drag || !view || !viewport) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.distance += Math.hypot(dx, dy);
    if (drag.distance > 4) draggedRef.current = true;
    dragRef.current = { x: event.clientX, y: event.clientY, distance: drag.distance };
    applyView({ ...view, center: viewport.locate(size.width / 2 - dx, size.height / 2 - dy) });
  };
  // ポインター キャプチャを使うと click の対象が svg に奇わるので、window で受ける。
  const startDrag = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY, distance: 0 };
    draggedRef.current = false;
    setDragging(true);
    const move = (moveEvent: PointerEvent) => panRef.current(moveEvent);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      dragRef.current = null;
      setDragging(false);
      setTimeout(() => { draggedRef.current = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  if (!anchors.length) return <p className="empty sfm-empty">座標を登録した拠点がありません。</p>;

  const project = (point: { latitude: number; longitude: number }) => viewport ? viewport.project(point) : { x: 0, y: 0 };
  const maxCups = Math.max(...mapStores.map(row => row.cupsPerDay ?? 0), 1);
  const storeRadius = (row: Store) => row.cupsPerDay === null ? 10 : 22 * Math.sqrt(row.cupsPerDay / maxCups);
  const shipmentsOf = (id: string) => located.filter(row => row.shipment.storeId === id);
  const dispatchedBy = (id: string) => located.filter(row => row.shipment.supplierId === id);
  const maxDispatch = Math.max(...mapSuppliers.map(row => dispatchedBy(row.id).length), 1);
  const supplierSize = (id: string) => 13 + 9 * Math.sqrt(dispatchedBy(id).length / maxDispatch);
  const storeName = (id: string) => stores.find(row => row.id === id)?.name ?? id;
  const supplierName = (id: string) => suppliers.find(row => row.id === id)?.name ?? id;
  const placed = [
    ...mapStores.map(row => ({ id: row.id, ...project(storeGeo.get(row.id)!) })),
    ...mapSuppliers.map(row => ({ id: row.id, ...project(supplierGeo.get(row.id)!) })),
  ];
  /** すぐ上に別の拠点があるときは、ラベルを下側へ逃がす。 */
  const labelBelow = (id: string, point: Vector) =>
    placed.some(other => other.id !== id && other.y < point.y && Math.hypot(other.x - point.x, other.y - point.y) < 74);

  const bundle = new Map<string, number>();
  located.forEach(row => {
    const key = `${row.shipment.supplierId}>${row.shipment.storeId}`;
    bundle.set(key, (bundle.get(key) ?? 0) + 1);
  });
  const seen = new Map<string, number>();
  const flows = located.map(row => {
    const key = `${row.shipment.supplierId}>${row.shipment.storeId}`;
    const rank = seen.get(key) ?? 0;
    seen.set(key, rank + 1);
    const offset = rank - ((bundle.get(key) ?? 1) - 1) / 2;
    const origin = project(supplierGeo.get(row.shipment.supplierId)!);
    const target = project(storeGeo.get(row.shipment.storeId)!);
    const store = stores.find(item => item.id === row.shipment.storeId);
    const from = shorten(origin, target, supplierSize(row.shipment.supplierId) + 4);
    const to = shorten(target, origin, (store ? storeRadius(store) : 12) + 12);
    const curvature = 0.15 + offset * 0.26;
    const control = {
      x: (from.x + to.x) / 2 - (to.y - from.y) * curvature,
      y: (from.y + to.y) / 2 + (to.x - from.x) * curvature,
    };
    return {
      row, from, to, control,
      tone: toneOf(row),
      // 同じ区間が 1 便だけなら、中点に集まる地名ラベルを避けて到着側へ寄せる。
      label: quadraticPoint(from, control, to, bundle.get(key) === 1 ? 0.75 : 0.5 + offset * 0.11),
      kilometres: distanceKm(supplierGeo.get(row.shipment.supplierId)!, storeGeo.get(row.shipment.storeId)!),
    };
  });

  const metresPerPixel = viewport?.metresPerPixel ?? 1;
  const barKm = scaleBarKm((metresPerPixel * 150) / 1000);
  const barWidth = (barKm * 1000) / metresPerPixel;
  const lateCount = located.filter(isLate).length;
  const hovered = hover?.kind === 'flow' ? flows.find(item => item.row.shipment.id === hover.id) : null;
  const hoveredStore = hover?.kind === 'store' ? stores.find(row => row.id === hover.id) : null;
  const hoveredSupplier = hover?.kind === 'supplier' ? suppliers.find(row => row.id === hover.id) : null;
  const choose = (id: string) => {
    if (draggedRef.current) return;
    return id === selectedId ? onClearShipment() : onSelectShipment(id);
  };
  const pressed = (run: () => void) => (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    run();
  };

  const span = located.length ? (() => {
    const start = Math.min(...located.map(row => Date.parse(row.shipment.expectedAt)));
    const end = Math.max(...located.map(row => Date.parse(row.arrivedAt ?? asOf)), start + 3600000);
    const margin = (end - start) * 0.06;
    return { start: start - margin, end: end + margin };
  })() : null;
  const ratio = (value: number) => span ? ((value - span.start) / (span.end - span.start)) * 100 : 0;
  const timeline = [...located].sort((first, second) => first.shipment.expectedAt.localeCompare(second.shipment.expectedAt));

  return <div className="supply-flow-map">
    <div className="sfm-toolbar">
      <div className="sfm-counts">
        <span><Truck size={13}/>{located.length} 便</span>
        <span className={lateCount ? 'is-late' : ''}><AlertTriangle size={13}/>遅延 {lateCount} 便</span>
        <span>中心 {view ? `${degrees(view.center.latitude)}N ${degrees(view.center.longitude)}E` : '—'}</span>
      </div>
      <p className="sfm-precision"><Crosshair size={12}/>市区町村の代表点・合成座標</p>
    </div>

    <div className="sfm-canvas" ref={attachBox}>
      <svg ref={attachSurface} className={dragging ? 'sfm-surface is-dragging' : 'sfm-surface'}
        width={size.width || 1} height={size.height || 1} viewBox={`0 0 ${size.width || 1} ${size.height || 1}`} role="group"
        aria-label={`入荷便のフロー地図。${mapSuppliers.length} 供給会社から ${mapStores.length} 店舗へ ${located.length} 便、うち遅延 ${lateCount} 便。`}
        onPointerDown={startDrag}>
        <defs>
          <radialGradient id="sfm-hub">
            <stop offset="0%" className="sfm-hub-core"/>
            <stop offset="100%" className="sfm-hub-edge"/>
          </radialGradient>
          <filter id="sfm-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          {(['late', 'ontime', 'scheduled', 'unknown'] as Tone[]).map(item =>
            <marker key={item} id={`sfm-arrow-${item}`} className={`sfm-arrow is-${item}`} markerWidth="11" markerHeight="11"
              refX="9" refY="5.5" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M 1 1.4 L 10 5.5 L 1 9.6 L 3 5.5 Z"/>
            </marker>)}
        </defs>

        <g className="sfm-tiles">
          {viewport?.tiles.map(tile =>
            <image key={tile.key} href={tile.url} x={tile.x} y={tile.y} width={tile.size + 1} height={tile.size + 1}
              preserveAspectRatio="none" onError={() => setTilesFailed(true)}/>)}
        </g>

        {mapSuppliers.map(row => {
          const point = project(supplierGeo.get(row.id)!);
          return <circle key={`hub-${row.id}`} className="sfm-hub" cx={point.x} cy={point.y} r={96} fill="url(#sfm-hub)"/>;
        })}

        <g className={selectedId ? 'sfm-flows has-selection' : 'sfm-flows'}>
          {flows.map(flow => {
            const id = flow.row.shipment.id;
            const active = id === selectedId;
            const path = `M ${flow.from.x} ${flow.from.y} Q ${flow.control.x} ${flow.control.y} ${flow.to.x} ${flow.to.y}`;
            return <g key={id} role="button" tabIndex={0}
              className={`sfm-flow is-${flow.tone}${active ? ' is-selected' : ''}${flow.row.arrivedAt ? '' : ' is-open'}`}
              aria-label={`${id}、${supplierName(flow.row.shipment.supplierId)} から ${storeName(flow.row.shipment.storeId)} へ、${arrivalLabels[flow.row.state]}、${delayLabel(flow.row.delayHours)}`}
              onClick={() => choose(id)} onKeyDown={pressed(() => choose(id))}
              onMouseEnter={() => setHover({ kind: 'flow', id, x: flow.label.x, y: flow.label.y })}
              onMouseLeave={() => setHover(null)} onFocus={() => setHover({ kind: 'flow', id, x: flow.label.x, y: flow.label.y })}
              onBlur={() => setHover(null)}>
              <path className="sfm-flow-hit" d={path}/>
              <path className="sfm-flow-line" d={path} markerEnd={`url(#sfm-arrow-${flow.tone})`}/>
              <g className="sfm-flow-tag" transform={`translate(${flow.label.x} ${flow.label.y})`}>
                <rect x={-46} y={-11} width={92} height={22} rx={11}/>
                <text y={4}>{shortId(id)} · {flow.row.delayHours === null ? '未確認' : flow.row.delayHours ? delayLabel(flow.row.delayHours) : '定刻'}</text>
              </g>
            </g>;
          })}
        </g>

        {mapSuppliers.map(row => {
          const point = project(supplierGeo.get(row.id)!);
          const size2 = supplierSize(row.id);
          return <g key={row.id} className="sfm-node sfm-supplier" transform={`translate(${point.x} ${point.y})`}
            onMouseEnter={() => setHover({ kind: 'supplier', id: row.id, x: point.x, y: point.y })} onMouseLeave={() => setHover(null)}>
            <rect x={-size2 / 2} y={-size2 / 2} width={size2} height={size2} rx={3} transform="rotate(45)"/>
            <text className="sfm-node-name" y={size2 + 16}>{row.name}</text>
            <text className="sfm-node-city" y={size2 + 30}>{row.city}</text>
          </g>;
        })}

        {mapStores.map(row => {
          const point = project(storeGeo.get(row.id)!);
          const radius = storeRadius(row);
          const deliveries = shipmentsOf(row.id);
          const late = deliveries.filter(isLate).length;
          const below = labelBelow(row.id, point);
          return <g key={row.id} role="button" tabIndex={0}
            className={`sfm-node sfm-store${late ? ' is-late' : ''}${deliveries.length ? '' : ' is-idle'}${storeId === row.id ? ' is-focused' : ''}`}
            transform={`translate(${point.x} ${point.y})`}
            aria-label={`${row.name}、入荷 ${deliveries.length} 便、遅延 ${late} 便`}
            onClick={() => onSelectStore(row.id)} onKeyDown={pressed(() => onSelectStore(row.id))}
            onMouseEnter={() => setHover({ kind: 'store', id: row.id, x: point.x, y: point.y })} onMouseLeave={() => setHover(null)}
            onFocus={() => setHover({ kind: 'store', id: row.id, x: point.x, y: point.y })} onBlur={() => setHover(null)}>
            <circle className="sfm-store-halo" r={radius + 7}/>
            <circle className={row.cupsPerDay === null ? 'sfm-store-dot is-unknown' : 'sfm-store-dot'} r={radius}/>
            <text className="sfm-node-name" y={below ? radius + 19 : -radius - 14}>{row.name}</text>
            <text className="sfm-node-city" y={below ? radius + 32 : -radius - 2}>{row.city}</text>
          </g>;
        })}

        <g className="sfm-scale" transform={`translate(18 ${(size.height || 1) - 26})`}>
          <line x1={0} y1={0} x2={barWidth} y2={0}/>
          <line x1={0} y1={-5} x2={0} y2={5}/><line x1={barWidth} y1={-5} x2={barWidth} y2={5}/>
          <text x={barWidth / 2} y={-10}>{barLabel(barKm)}</text>
        </g>
      </svg>

      <div className="sfm-controls">
        <button type="button" aria-label="拡大" title="拡大" onClick={() => zoomBy(0.6)}><Plus size={15}/></button>
        <button type="button" aria-label="縮小" title="縮小" onClick={() => zoomBy(-0.6)}><Minus size={15}/></button>
        <button type="button" aria-label="全体表示に戻す" title="全体表示に戻す" onClick={() => setMoved(null)}><Scan size={15}/></button>
      </div>

      <aside className="sfm-panel">
        <h3>入荷便のフロー</h3>
        <dl className="sfm-panel-keys">
          <div className="is-late"><dt><i/>遅延</dt><dd>{lateCount}</dd></div>
          <div className="is-ontime"><dt><i/>定刻</dt><dd>{located.filter(row => row.state === 'on-time').length}</dd></div>
          <div className="is-scheduled"><dt><i/>入荷予定</dt><dd>{located.filter(row => row.state === 'scheduled').length}</dd></div>
          <div className="is-unknown"><dt><i/>到着未確認</dt><dd>{located.filter(row => row.state === 'unknown').length}</dd></div>
        </dl>
        <ul className="sfm-panel-notes">
          <li><span className="sfm-swatch is-dashed"/>破線は到着実績なし</li>
          <li><span className="sfm-swatch is-area"/>円の面積は 1 日あたり杯数</li>
          <li><span className="sfm-swatch is-hollow"/>破線の円は杯数が不明</li>
          <li><span className="sfm-swatch is-hub"/>ひし形は供給会社</li>
        </ul>
      </aside>

      <p className="sfm-attribution">地図タイル © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap</a> 協力者</p>
      {tilesFailed && <p className="sfm-offline" role="status">背景地図を取得できません。拠点と便だけを表示しています。</p>}

      {hover && <div className="sfm-tip" data-flip={hover.y < 170 ? 'down' : undefined}
        style={{ left: `${hover.x}px`, top: `${hover.y}px` }}>
        {hovered && <>
          <strong>{hovered.row.shipment.id}</strong>
          <p>{supplierName(hovered.row.shipment.supplierId)} → {storeName(hovered.row.shipment.storeId)}</p>
          <dl>
            <div><dt>予定到着</dt><dd>{supplyDate(hovered.row.shipment.expectedAt)}</dd></div>
            <div><dt>到着実績</dt><dd>{hovered.row.arrivedAt ? supplyDate(hovered.row.arrivedAt) : '未確認'}</dd></div>
            <div><dt>状態</dt><dd className={isLate(hovered.row) ? 'is-late' : ''}>{arrivalLabels[hovered.row.state]}</dd></div>
            <div><dt>遅延</dt><dd>{delayLabel(hovered.row.delayHours)}</dd></div>
            <div><dt>直線距離</dt><dd>{hovered.kilometres.toFixed(1)} km</dd></div>
          </dl>
          <small>直線距離であり、道路距離ではありません。</small>
        </>}
        {hoveredStore && <>
          <strong>{hoveredStore.name}</strong>
          <p>{hoveredStore.city}</p>
          <dl>
            <div><dt>入荷</dt><dd>{shipmentsOf(hoveredStore.id).length} 便</dd></div>
            <div><dt>遅延</dt><dd className={shipmentsOf(hoveredStore.id).some(isLate) ? 'is-late' : ''}>{shipmentsOf(hoveredStore.id).filter(isLate).length} 便</dd></div>
            <div><dt>1 日あたり</dt><dd>{hoveredStore.cupsPerDay === null ? '不明' : `${hoveredStore.cupsPerDay} 杯`}</dd></div>
          </dl>
        </>}
        {hoveredSupplier && <>
          <strong>{hoveredSupplier.name}</strong>
          <p>{hoveredSupplier.city}</p>
          <dl><div><dt>出荷</dt><dd>{dispatchedBy(hoveredSupplier.id).length} 便</dd></div></dl>
        </>}
      </div>}
    </div>

    {span && <section className="sfm-timeline" aria-label="入荷便の予定と実績">
      <div className="sfm-timeline-heading"><Ruler size={13}/><h3>予定から到着までの時間</h3><span>{supplyDate(new Date(span.start).toISOString())} 〜 {supplyDate(new Date(span.end).toISOString())}</span></div>
      {timeline.map(row => {
        const start = ratio(Date.parse(row.shipment.expectedAt));
        const finish = ratio(Date.parse(row.arrivedAt ?? asOf));
        return <button key={row.shipment.id} className={`sfm-track is-${toneOf(row)}${row.shipment.id === selectedId ? ' is-selected' : ''}`}
          onClick={() => choose(row.shipment.id)}>
          <span className="sfm-track-id">{row.shipment.id}</span>
          <span className="sfm-track-rail">
            <span className={row.arrivedAt ? 'sfm-track-bar' : 'sfm-track-bar is-open'}
              style={{ left: `${start}%`, width: `${Math.max(finish - start, 0.8)}%` }}/>
            <span className="sfm-track-pin" style={{ left: `${start}%` }}/>
          </span>
          <span className="sfm-track-delay">{row.delayHours === null ? '未確認' : row.delayHours ? delayLabel(row.delayHours) : '定刻'}</span>
        </button>;
      })}
    </section>}

    {!located.length && <p className="empty">対象の入荷便はありません。</p>}
    {unmapped > 0 && <p className="message error" role="alert">座標が未登録のため地図に表示できない便が {unmapped} 件あります。</p>}
    <footer className="sfm-footer">{geoNote}経路の形状は記録がないため、実際の走行経路ではなく重なりを避けるための弧で描いています。背景地図は OpenStreetMap の公開タイルサービスを参照しており、常時稼働の業務利用では別途タイル提供元の確保が必要です。</footer>
  </div>;
}
