import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition } from 'cytoscape';
import { Maximize2, Network, ZoomIn, ZoomOut } from 'lucide-react';
import type { Dataset } from './domain';
import { jpy } from './analytics';
import { arrivalLabels, delayLabel, isLate, lineAmount, selectSupply, summarizeSupply, supplyDate } from './supply-model';
import type { SupplyPeriod } from './supply-model';

interface SupplyGraphProps {
  data: Dataset;
  period: SupplyPeriod;
  selectedId: string;
  onSelect: (id: string) => void;
}
interface GraphRecord { id: string; label: string; kind: string; detail: string }

export function SupplyGraph({ data, period, selectedId, onSelect }: SupplyGraphProps) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  const [mode, setMode] = useState<'network' | 'orders'>('network');
  const [records, setRecords] = useState<GraphRecord[]>([]);
  const [recordId, setRecordId] = useState('');
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => {
    if (!host.current) return;
    const rows = selectSupply(data, period);
    const selected = rows.find(row => row.shipment.id === selectedId);
    if (!selected) return;
    const supplier = data.suppliers.find(row => row.id === selected.shipment.supplierId);
    const elements: ElementDefinition[] = [];
    const entries: GraphRecord[] = [];
    const positions = new Map<string, { wide: [number, number]; narrow: [number, number] }>();
    const node = (id: string, label: string, kind: string, detail: string, wide: [number, number], narrow: [number, number], classes = '', shipmentId = '') => {
      if (positions.has(id)) return;
      positions.set(id, { wide, narrow });
      entries.push({ id, label, kind, detail });
      elements.push({ data: { id, label, shipmentId }, classes });
    };
    const edge = (source: string, target: string, label: string, classes = '') => elements.push({ data: { id: `${source}:${target}`, source, target, label }, classes });
    node(selected.shipment.supplierId, supplier?.name ?? selected.shipment.supplierId, '供給会社', supplier?.city ?? '所在地未確認', [100, 200], [220, 55], 'supplier');
    if (mode === 'network') {
      const related = rows.filter(row => row.shipment.supplierId === selected.shipment.supplierId);
      related.forEach((row, index) => {
        const store = data.stores.find(candidate => candidate.id === row.shipment.storeId);
        const totals = summarizeSupply([row]);
        const tone = isLate(row) ? 'late' : row.state === 'on-time' ? 'ontime' : '';
        const selectedClass = row.shipment.id === selectedId ? ' active' : '';
        node(row.shipment.id, `${supplyDate(row.shipment.expectedAt)} 便\n${isLate(row) ? `+${delayLabel(row.delayHours)}` : arrivalLabels[row.state]}`, '入荷便', `${arrivalLabels[row.state]} / ${row.shipment.reason}`, [365, 65 + index * 150], [100, 220 + index * 180], `${tone}${selectedClass}`, row.shipment.id);
        const storeNodeId = `${row.shipment.id}:store`;
        node(storeNodeId, `${store?.name ?? row.shipment.storeId}\n${totals.cancelled.length ? `取消 ${totals.cancelled.length} 明細 / ${jpy(totals.cancelledAmount)}` : '関連する取消記録なし'}`, '店舗', `${row.shipment.storeId} / ${store?.city ?? '所在地未確認'}`, [650, 65 + index * 150], [350, 220 + index * 180], `${totals.cancelled.length ? 'late' : ''}${selectedClass}`, row.shipment.id);
        edge(selected.shipment.supplierId, row.shipment.id, '出荷', tone);
        edge(row.shipment.id, storeNodeId, '店舗へ入荷', tone);
      });
    } else {
      const row = selected;
      const store = data.stores.find(candidate => candidate.id === row.shipment.storeId);
      const tone = isLate(row) ? 'late' : row.state === 'on-time' ? 'ontime' : '';
      positions.set(row.shipment.supplierId, { wide: [100, 65], narrow: [105, 55] });
      node(row.shipment.id, `入荷便\n${isLate(row) ? `+${delayLabel(row.delayHours)}` : arrivalLabels[row.state]}`, '入荷便', `${row.shipment.id} / ${row.shipment.reason}`, [325, 65], [105, 215], tone);
      node(row.shipment.storeId, store?.name ?? row.shipment.storeId, '店舗', store?.city ?? '所在地未確認', [550, 65], [355, 55]);
      edge(row.shipment.supplierId, row.shipment.id, '出荷', tone);
      edge(row.shipment.id, row.shipment.storeId, '入荷先', tone);
      row.impacts.forEach(({ impact, line, order }, index) => {
        const product = data.products.find(candidate => candidate.id === line.productId);
        const customer = data.customers.find(candidate => candidate.id === order.customerId);
        const offset = index * 360;
        const impactTone = order.status === 'cancelled' ? 'late' : '';
        node(impact.id, `欠品確認\n${supplyDate(impact.shortageAt)}`, '欠品記録', impact.evidence, [325, 250 + offset], [105, 390 + index * 510], impactTone);
        node(line.id, `対象明細 ${line.quantity} 点\n${jpy(lineAmount(line))}（税抜）`, '注文明細', `${line.id} / ${product?.name ?? line.productId}`, [550, 250 + offset], [355, 390 + index * 510], impactTone);
        node(line.productId, product?.name ?? line.productId, '商品', `${line.productId} / ${product?.serving ?? '仕様未確認'}`, [550, 425 + offset], [355, 215 + index * 510], 'product');
        node(order.id, `${order.status === 'cancelled' ? '取消注文' : order.status === 'completed' ? '完了注文' : order.status === 'confirmed' ? '受付注文' : '遅延注文'}\n${order.id}`, '注文', `注文日時 ${supplyDate(order.orderedAt)} / ${order.fulfilledAt ? `受取 ${supplyDate(order.fulfilledAt)}` : order.pickupAt ? `受取予定 ${supplyDate(order.pickupAt)}` : '受取実績なし'}`, [775, 250 + offset], [355, 555 + index * 510], impactTone);
        node(order.customerId, `${customer?.displayName ?? order.customerId}\n${customer?.loyaltyTier ?? '会員区分未確認'}`, '顧客', order.customerId, [1000, 250 + offset], [105, 555 + index * 510]);
        edge(row.shipment.id, impact.id, '欠品記録', impactTone);
        edge(impact.id, line.id, '対象明細', impactTone);
        edge(line.id, line.productId, '商品');
        edge(line.id, order.id, '所属注文', impactTone);
        edge(order.id, order.customerId, '注文者');
      });
    }
    setRecords(entries);
    setRecordId(selected.shipment.id);
    const colors = () => {
      const tokens = getComputedStyle(document.documentElement);
      const color = (name: string) => tokens.getPropertyValue(`--cp-${name}`).trim();
      return [
        { selector: 'node', style: { label: 'data(label)', shape: 'round-rectangle', width: 174, height: 72, 'background-color': color('surface'), 'border-color': color('border-strong'), 'border-width': 1, color: color('text'), 'text-wrap': 'wrap', 'text-max-width': '155px', 'font-size': 13, 'font-family': '"BIZ UDPGothic", "Yu Gothic UI", Meiryo, sans-serif', 'text-valign': 'center', 'text-halign': 'center' } },
        { selector: 'edge', style: { label: 'data(label)', width: 1.5, 'line-color': color('border-strong'), 'target-arrow-color': color('border-strong'), 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', color: color('text-muted'), 'font-size': 10, 'text-background-color': color('surface-soft'), 'text-background-opacity': 1, 'text-background-padding': '3px', 'text-rotation': 'none' } },
        { selector: 'node.supplier', style: { 'background-color': color('text'), color: color('surface'), 'border-color': color('text') } },
        { selector: 'node.product', style: { 'border-color': color('link') } },
        { selector: 'node.late', style: { 'border-color': color('danger'), 'border-width': 2 } },
        { selector: 'edge.late', style: { 'line-color': color('danger'), 'target-arrow-color': color('danger'), width: 2.3 } },
        { selector: 'node.ontime', style: { 'border-color': color('success'), 'border-width': 2 } },
        { selector: 'edge.ontime', style: { 'line-color': color('success'), 'target-arrow-color': color('success') } },
        { selector: 'node.active', style: { 'underlay-color': color('accent'), 'underlay-opacity': .1, 'underlay-padding': 7 } },
        { selector: 'node:selected', style: { 'overlay-color': color('link'), 'overlay-opacity': .08, 'overlay-padding': 4 } },
      ] satisfies cytoscape.StylesheetJson;
    };
    const instance = cytoscape({ container: host.current, elements, layout: { name: 'preset' }, style: colors(), minZoom: .2, maxZoom: 2.5, userZoomingEnabled: false, autoungrabify: true });
    graph.current = instance;
    const resize = () => {
      instance.resize();
      const narrow = (host.current?.clientWidth ?? 900) < 560;
      instance.nodes().positions(current => {
        const position = positions.get(current.id())!;
        const [horizontal, vertical] = narrow ? position.narrow : position.wide;
        return { x: horizontal, y: vertical };
      });
      instance.fit(undefined, 24);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host.current);
    const themeObserver = new MutationObserver(() => instance.style(colors()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    instance.on('tap', 'node', event => {
      setRecordId(event.target.id());
      const shipmentId = event.target.data('shipmentId') as string;
      if (shipmentId && shipmentId !== selectedId) onSelectRef.current(shipmentId);
    });
    resize();
    return () => { resizeObserver.disconnect(); themeObserver.disconnect(); instance.destroy(); graph.current = null; };
  }, [data, period, selectedId, mode]);
  const record = records.find(row => row.id === recordId);
  const zoom = (factor: number) => {
    const instance = graph.current;
    if (instance) instance.zoom({ level: instance.zoom() * factor, renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 } });
  };
  return <section className="supply-graph" aria-label="供給オントロジー">
    <div className="supply-graph-header"><h2><Network size={17}/>供給オントロジー</h2><div className="graph-tools">
      <button title="拡大" aria-label="供給関係図を拡大" onClick={() => zoom(1.2)}><ZoomIn size={15}/></button>
      <button title="縮小" aria-label="供給関係図を縮小" onClick={() => zoom(1 / 1.2)}><ZoomOut size={15}/></button>
      <button title="全体を表示" aria-label="供給関係図全体を表示" onClick={() => graph.current?.fit(undefined, 24)}><Maximize2 size={15}/></button>
    </div></div>
    <div className="supply-graph-toolbar"><div className="supply-segments" role="group" aria-label="関係図の視点"><button aria-pressed={mode === 'network'} onClick={() => setMode('network')}>供給網</button><button aria-pressed={mode === 'orders'} onClick={() => setMode('orders')}>注文への影響</button></div><div className="supply-legend"><span><i className="late"/>遅延・取消</span><span><i className="ontime"/>定刻内</span></div></div>
    <div ref={host} className={`supply-graph-canvas${period === 'all' && mode === 'network' ? ' is-history' : ''}`} role="img" aria-label={mode === 'network' ? '供給会社から各入荷便、店舗への関係。遅延便と定刻便、関連する取消明細数を表示。' : '選択した入荷便から、店舗、欠品記録、商品、注文明細、注文者への関係。'}/>
    <div className="supply-graph-inspector"><label>対象<select aria-label="オントロジーの対象" value={recordId} onChange={event => { setRecordId(event.target.value); graph.current?.nodes().unselect(); graph.current?.getElementById(event.target.value).select(); }}>{records.map(row => <option key={row.id} value={row.id}>{row.kind} / {row.label.replaceAll('\n', ' ')}</option>)}</select></label>{record && <p><strong>{record.kind}</strong><span>{record.detail}</span><code>{record.id}</code></p>}</div>
  </section>;
}