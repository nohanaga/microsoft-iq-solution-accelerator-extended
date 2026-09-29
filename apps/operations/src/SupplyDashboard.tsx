import { useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, FileText, Map as MapIcon, ReceiptText, RotateCcw, Share2, Store, Truck, X } from 'lucide-react';
import type { Dataset, Order } from './domain';
import { jpy } from './analytics';
import { arrivalLabels, delayLabel, isLate, lineAmount, selectSupply, summarizeSupply, supplyDate } from './supply-model';
import { OntologyExplorer } from './OntologyExplorer';
import { SupplyFlowMap } from './SupplyFlowMap';
import { SupplyPredictionPanel } from './MlPredictions';
import { useWorkspace } from './workspace-context';
import { supplyOntology } from './ontology-records';
import type { GraphScope, RecordSelection } from './ontology-records';
import type { SupplyUiFilter } from './copilot-ui-command';
import './supply-dashboard.css';

const dayInJapan = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const orderLabels: Array<{ value: Order['status']; label: string }> = [
  { value: 'confirmed', label: '受付済み' }, { value: 'completed', label: '受取完了' },
  { value: 'cancelled', label: '取消' }, { value: 'delayed', label: '遅延' },
];
const orderStatusLabel = (status: Order['status']) => orderLabels.find(row => row.value === status)?.label ?? status;

interface SupplyDashboardProps {
  data: Dataset;
  filter: SupplyUiFilter;
  onFilterChange: (next: SupplyUiFilter) => void;
  selection: RecordSelection | null;
  onSelectionChange: (next: RecordSelection | null) => void;
}

export function SupplyDashboard({ data, filter, onFilterChange, selection, onSelectionChange }: SupplyDashboardProps) {
  const { storeId, supplierId, from, to, tab, status, graphMode, shipmentId } = filter;
  const [view, setView] = useState<'map' | 'ontology'>('map');
  const update = (next: Partial<SupplyUiFilter>) => onFilterChange({ ...filter, ...next });
  // 絞り込みを変えたときは入荷便の選択を解除する。
  const refine = (next: Partial<SupplyUiFilter>) => { onFilterChange({ ...filter, ...next, shipmentId: '' }); onSelectionChange(null); };
  const dateMatches = (value: string) => { const day = dayInJapan(value); return (!from || day >= from) && (!to || day <= to); };
  const badDates = !!from && !!to && from > to;
  const shipments = badDates ? [] : selectSupply(data, 'all').filter(row => (!storeId || row.shipment.storeId === storeId) && (!supplierId || row.shipment.supplierId === supplierId) && dateMatches(row.shipment.expectedAt));
  const productIds = new Set(data.products.filter(row => !supplierId || row.supplierId === supplierId).map(row => row.id));
  const orderLines = data.orderLines.filter(row => productIds.has(row.productId));
  const orders = badDates ? [] : data.orders.filter(row => (!storeId || row.storeId === storeId) && dateMatches(row.orderedAt) && orderLines.some(line => line.orderId === row.id));
  const orderIds = new Set(orders.map(row => row.id));
  const scopedLines = orderLines.filter(row => orderIds.has(row.orderId));
  const totals = summarizeSupply(shipments);
  const completedIds = new Set(orders.filter(row => row.status === 'completed').map(row => row.id));
  const completedAmount = scopedLines.filter(row => completedIds.has(row.orderId)).reduce((total, row) => total + lineAmount(row), 0);
  const selected = shipments.find(row => row.shipment.id === shipmentId);
  const graphRows = selected ? [selected] : shipments;
  const impacts = graphRows.flatMap(row => row.impacts);
  const graphSuppliers = [...new Set(graphRows.map(row => row.shipment.supplierId))];
  const graphStores = [...new Set(graphRows.map(row => row.shipment.storeId))];
  const scope: GraphScope = { suppliers: graphSuppliers, shipments: graphRows.map(row => row.shipment.id), stores: graphStores,
    ...(graphMode === 'impact' ? { supplyImpacts: impacts.map(row => row.impact.id), orderLines: impacts.map(row => row.line.id), products: [...new Set(impacts.map(row => row.line.productId))], orders: [...new Set(impacts.map(row => row.order.id))], customers: [...new Set(impacts.map(row => row.order.customerId))] } : {}) };
  const visibleShipments = shipments.filter(row => status === 'all' || (status === 'late' ? isLate(row) : status === row.state));
  const visibleOrders = orders.filter(row => status === 'all' || row.status === status);
  const name = (id: string) => data.stores.find(row => row.id === id)?.name ?? id;
  const chooseShipment = (id: string) => { update({ shipmentId: id }); onSelectionChange({ tableId: 'shipments', recordId: id }); };
  const selectedImpacts = selected?.impacts ?? [];
  const predictions = useWorkspace().data.predictions;
  const supplierName = (id: string) => data.suppliers.find(row => row.id === id)?.name ?? id;
  const model = supplyOntology(data);
  return <div className="supply-dashboard">
    <header className="sd-heading"><div><span className="eyebrow">オペレーション</span><h1>供給と注文</h1></div><span className="sd-asof">入荷・注文ダッシュボード</span></header>
    <div className="sd-filters"><label>店舗<select aria-label="供給の店舗" value={storeId} onChange={event => refine({ storeId: event.target.value })}><option value="">すべての店舗</option>{data.stores.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>供給会社<select aria-label="供給会社" value={supplierId} onChange={event => refine({ supplierId: event.target.value })}><option value="">すべての供給会社</option>{data.suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>開始日<input aria-label="集計開始日" type="date" value={from} onChange={event => refine({ from: event.target.value })}/></label><label>終了日<input aria-label="集計終了日" type="date" value={to} onChange={event => refine({ to: event.target.value })}/></label><button title="絞り込みを解除" aria-label="供給の絞り込みを解除" onClick={() => refine({ storeId: '', supplierId: '', from: '', to: '', status: 'all' })}><RotateCcw size={16}/></button></div>
    {badDates && <p className="message error" role="alert">開始日は終了日以前にしてください。</p>}
    <section className="sd-metrics" aria-label="供給と注文の集計"><div><span><Truck size={15}/>入荷便</span><strong>{shipments.length}<small>便</small></strong><span>予定到着日で集計</span></div><div className={totals.lateCount ? 'is-risk' : ''}><span><Clock3 size={15}/>遅延実績</span><strong>{totals.lateCount}<small>便</small></strong><span>うち未着 {totals.pendingCount} 便</span></div><div><span><ReceiptText size={15}/>注文</span><strong>{orders.length}<small>件</small></strong><span>受取完了 {completedIds.size} / 取消 {orders.filter(row => row.status === 'cancelled').length}</span></div><div><span>受取完了の商品額（税抜）</span><strong>{jpy(completedAmount)}</strong><span>注文日で集計 / 対象供給会社の商品</span></div></section>
    <div className="sd-overview"><section className="sd-stores"><div className="section-heading"><h2><Store size={16}/>店舗別の状況</h2><span>{storeId ? 1 : data.stores.length} 店舗</span></div><div className="sd-store-labels"><span>店舗</span><span>入荷 / 遅延</span><span>注文</span></div>{data.stores.filter(row => !storeId || row.id === storeId).map(store => { const deliveries = shipments.filter(row => row.shipment.storeId === store.id); const late = deliveries.filter(isLate).length; const count = orders.filter(row => row.storeId === store.id).length; return <button className="sd-store-row" key={store.id} onClick={() => refine({ storeId: store.id })}><strong>{store.name}</strong><span className={late ? 'sd-danger' : ''}>{deliveries.length} / {late}</span><span>{count}</span></button>; })}<div className="sd-impact-summary"><span>供給記録と結び付いた取消</span><strong>{totals.cancelled.length} 明細<span>{jpy(totals.cancelledAmount)}</span></strong><small>税抜商品額 / 会計上の損失額ではありません</small></div></section>
    <div className="sd-ontology"><div className="sd-view-tabs" role="tablist" aria-label="供給の可視化"><button role="tab" id="sd-view-map" aria-selected={view === 'map'} aria-controls="sd-view-panel" onClick={() => setView('map')}><MapIcon size={14}/>地図</button><button role="tab" id="sd-view-ontology" aria-selected={view === 'ontology'} aria-controls="sd-view-panel" onClick={() => setView('ontology')}><Share2 size={14}/>オントロジー</button></div><div id="sd-view-panel" role="tabpanel" aria-labelledby={view === 'map' ? 'sd-view-map' : 'sd-view-ontology'}>{view === 'map'
      ? <SupplyFlowMap stores={data.stores} suppliers={data.suppliers} rows={shipments} asOf={data.asOf} selectedId={shipmentId} storeId={storeId} onSelectShipment={chooseShipment} onClearShipment={() => { update({ shipmentId: '' }); onSelectionChange(null); }} onSelectStore={id => refine({ storeId: id })}/>
      : <><div className="sd-graph-context"><div role="group" aria-label="供給の関係"><button aria-pressed={graphMode === 'network'} onClick={() => { update({ graphMode: 'network' }); onSelectionChange(null); }}>供給網</button><button aria-pressed={graphMode === 'impact'} onClick={() => { update({ graphMode: 'impact' }); onSelectionChange(null); }}>注文への影響</button></div>{selected && <button onClick={() => { update({ shipmentId: '' }); onSelectionChange(null); }} title="全入荷便へ戻す"><X size={13}/>{selected.shipment.id}</button>}</div><OntologyExplorer model={model} fabricModel="supply" scope={scope} columns={graphMode === 'network' ? [['suppliers'], ['shipments'], ['stores'], ['products', 'supplyImpacts', 'orderLines', 'orders', 'customers']] : [['suppliers', 'stores'], ['shipments'], ['supplyImpacts'], ['orderLines', 'products'], ['orders'], ['customers']]} title="供給と注文のオントロジー" highlights={graphRows.filter(isLate).map(row => `shipments:${row.shipment.id}`)} selection={selection} onSelection={onSelectionChange}/></>}</div></div></div>
    <section className="sd-ledger"><div className="sd-ledger-heading"><div role="group" aria-label="業務レコード"><button aria-pressed={tab === 'shipments'} onClick={() => update({ tab: 'shipments', status: 'all' })}>入荷便 <span>{shipments.length}</span></button><button aria-pressed={tab === 'orders'} onClick={() => update({ tab: 'orders', status: 'all' })}>注文 <span>{orders.length}</span></button></div><label>状態<select aria-label="一覧の状態" value={status} onChange={event => update({ status: event.target.value })}><option value="all">すべて</option>{tab === 'shipments' ? <><option value="late">遅延あり</option><option value="on-time">定刻内</option><option value="late-pending">遅延・未着</option><option value="unknown">到着未確認</option><option value="scheduled">入荷予定</option></> : orderLabels.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className="table-scroll">{tab === 'shipments' ? <table><thead><tr><th>入荷便</th><th>供給会社</th><th>店舗</th><th>予定到着</th><th>到着実績</th><th>状態</th><th>遅延</th></tr></thead><tbody>{visibleShipments.map(row => <tr key={row.shipment.id} className={selected?.shipment.id === row.shipment.id ? 'is-selected' : ''}><td><button className="sd-record-link" onClick={() => chooseShipment(row.shipment.id)}>{row.shipment.id}<ArrowRight size={12}/></button></td><td>{data.suppliers.find(supplier => supplier.id === row.shipment.supplierId)?.name}</td><td>{name(row.shipment.storeId)}</td><td>{supplyDate(row.shipment.expectedAt)}</td><td>{row.arrivedAt ? supplyDate(row.arrivedAt) : '未確認'}</td><td className={isLate(row) ? 'sd-danger' : ''}>{arrivalLabels[row.state]}</td><td>{row.delayHours === null ? '未確認' : delayLabel(row.delayHours)}</td></tr>)}</tbody></table> : <table><thead><tr><th>注文</th><th>店舗</th><th>注文日時</th><th>商品</th><th>数量</th><th>商品額（税抜）</th><th>状態</th></tr></thead><tbody>{visibleOrders.map(order => { const lines = scopedLines.filter(row => row.orderId === order.id); return <tr key={order.id}><td><button className="sd-record-link" onClick={() => onSelectionChange({ tableId: 'orders', recordId: order.id })}>{order.id}<FileText size={12}/></button></td><td>{name(order.storeId)}</td><td>{supplyDate(order.orderedAt)}</td><td>{lines.map(line => data.products.find(row => row.id === line.productId)?.name ?? line.productId).join('、')}</td><td>{lines.reduce((total, row) => total + row.quantity, 0)}</td><td>{jpy(lines.reduce((total, row) => total + lineAmount(row), 0))}</td><td className={order.status === 'cancelled' ? 'sd-danger' : ''}>{orderStatusLabel(order.status)}</td></tr>; })}</tbody></table>}</div>
      {!(tab === 'shipments' ? visibleShipments.length : visibleOrders.length) && <p className="empty">対象のレコードはありません。</p>}
    </section>
    {selected && <section className="sd-shipment-detail" aria-label="入荷便の詳細"><div className="section-heading"><h2><Truck size={17}/>{selected.shipment.id} / {name(selected.shipment.storeId)}</h2><button title="詳細を閉じる" aria-label="入荷便の詳細を閉じる" onClick={() => { update({ shipmentId: '' }); onSelectionChange(null); }}><X size={16}/></button></div><div className="sd-arrival"><span>予定<strong>{supplyDate(selected.shipment.expectedAt)}</strong></span><ArrowRight size={20}/><span className={isLate(selected) ? 'sd-danger' : ''}>{arrivalLabels[selected.state]}<strong>{selected.arrivedAt ? supplyDate(selected.arrivedAt) : '未確認'}</strong></span><span className={isLate(selected) ? 'sd-danger' : ''}><Clock3 size={14}/>{delayLabel(selected.delayHours)}</span></div><p>{selected.shipment.reason}</p>{selectedImpacts.map(row => <div className="sd-impact-record" key={row.impact.id}><FileText size={16}/><div><strong>{row.line.id} / {jpy(lineAmount(row.line))}（税抜）</strong><p>{row.impact.evidence}</p><time>欠品確認 {supplyDate(row.impact.shortageAt)}</time></div><button onClick={() => { update({ graphMode: 'impact' }); onSelectionChange({ tableId: 'supplyImpacts', recordId: row.impact.id }); }}>レコード<ArrowRight size={13}/></button></div>)}{!selectedImpacts.length && <p className="sd-neutral"><CheckCircle2 size={14}/>この便に関連する欠品記録はありません。</p>}</section>}
    <SupplyPredictionPanel risk={predictions.shipmentRisk} forecast={predictions.demandForecast} storeId={storeId} supplierId={supplierId} storeName={name} supplierName={supplierName}/>
    <footer className="sd-footer">入荷は店舗向け。期間は入荷の予定到着日・注文の注文日で集計。影響分析は対象便に紐づく全記録が対象です。遅延は分析基準時点の記録です。</footer>  </div>;
}