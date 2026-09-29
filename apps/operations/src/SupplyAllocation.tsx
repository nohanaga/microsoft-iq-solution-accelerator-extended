import { useRef, useState } from 'react';
import { ArrowRight, Check, CircleStop, Crown, Download, PackageCheck, Play, RotateCcw, Save } from 'lucide-react';
import type { Dataset } from './domain';
import { downloadJson } from './adapter';
import { OntologyExplorer } from './OntologyExplorer';
import type { OntologyNodeAnnotation } from './OntologyExplorer';
import { supplyOntology } from './ontology-records';
import { createOntology, supplyDefinition } from '../v3/ontology/model';
import type { GraphScope, RecordSelection } from './ontology-records';
import { allocationDemoData, allocationGraphScope, allocationStock, createAllocationDemo, createAllocationState, releaseOrderLine, reserveOrderLine, reserveVipOrders, selectAllocationSupplier, setAllocationStock, setAllocationSupplierStopped, supplierOrderExposure } from './supply-model';
import type { SupplyAllocationState } from './supply-model';
import { allocationSnapshotSchema, savedRecordSchema } from './workspace-schema';
import type { SavedRecord } from './workspace-schema';
import { useWorkspace } from './workspace-context';
import './supply-dashboard.css';

interface Props {
  source: Dataset;
  state: SupplyAllocationState;
  onChange: (state: SupplyAllocationState) => void;
  saveAttempt: SavedRecord | null;
  onSaveAttempt: (record: SavedRecord | null) => void;
}
type Exposure = ReturnType<typeof supplierOrderExposure>[number];
const orderLabels = { confirmed: '受付済み', delayed: '遅延', completed: '受取完了', cancelled: '取消' };

export function SupplyAllocation({ source, state, onChange, saveAttempt, onSaveAttempt }: Props) {
  const workspace = useWorkspace();
  const scenarioLabel = workspace.mode === 'live' ? 'Rayfin 登録データ / 合成' : 'ローカル登録データ / 合成';
  const data = state.source === 'demo' ? allocationDemoData(source) : source;
  const model = state.source === 'demo' ? createOntology({ ...supplyDefinition, datasetId: data.datasetId, source: 'allocation-demo' }, data) : supplyOntology(data);
  const [history, setHistory] = useState(false);
  const [selection, setSelection] = useState<RecordSelection | null>(null);
  const [selectedLineId, setSelectedLineId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const stale = state.datasetId !== data.datasetId || state.datasetVersion !== data.version;
  const rows = supplierOrderExposure(data, state);
  const active = rows.filter(row => row.active);
  const visible = history ? rows : active;
  const selected = visible.find(row => row.line.id === selectedLineId);
  const company = data.suppliers.find(row => row.id === state.supplierId);
  const tiers = [...new Set(['VIP', ...data.customers.map(row => row.loyaltyTier)])];
  const pools = [...new Map(active.map(row => [JSON.stringify([row.order.storeId, row.product.id]), { storeId: row.order.storeId, productId: row.product.id }])).values()];
  const totals = pools.map(pool => {
    const stock = allocationStock(data, state, pool.storeId, pool.productId);
    const demand = active.filter(row => row.order.storeId === pool.storeId && row.product.id === pool.productId).reduce((total, row) => total + row.remaining, 0);
    return { ...pool, ...stock, demand, shortage: stock.available === null ? null : Math.max(0, demand - stock.available) };
  });
  const path = (row: Exposure) => [`suppliers:${state.supplierId}`, `products:${row.product.id}`, `orderLines:${row.line.id}`, `orders:${row.order.id}`, ...(row.customer ? [`customers:${row.customer.id}`] : [])];
  const scope: GraphScope = allocationGraphScope(data, state, history);
  const annotations: Record<string, OntologyNodeAnnotation> = {
    [`suppliers:${state.supplierId}`]: { note: state.stopped ? '停止（仮定）' : '通常', stopped: state.stopped },
  };
  for (const productId of scope.products) {
    annotations[`products:${productId}`] = { note: state.stopped ? '補充停止の対象' : '供給対象', affected: state.stopped };
  }
  for (const row of visible) {
    const affected = state.stopped && row.active;
    const productKey = `products:${row.product.id}`;
    annotations[productKey] = { note: state.stopped ? '補充停止の対象' : '供給対象', affected: affected || annotations[productKey]?.affected };
    annotations[`orderLines:${row.line.id}`] = { note: row.active ? `引当 ${row.allocated}/${row.line.quantity}` : orderLabels[row.order.status], affected, allocated: row.active && row.remaining === 0 };
    if (row.customer) annotations[`customers:${row.customer.id}`] = { note: row.vip ? 'VIP' : row.customer.loyaltyTier, vip: !!row.vip, affected: affected || annotations[`customers:${row.customer.id}`]?.affected };
  }
  for (const orderId of scope.orders) {
    const lines = visible.filter(row => row.order.id === orderId);
    const pending = lines.filter(row => row.active);
    const remaining = pending.reduce((total, row) => total + row.remaining, 0);
    annotations[`orders:${orderId}`] = { note: pending.length ? remaining === 0 ? '対象分引当済み' : `${state.stopped ? '停止影響 / ' : ''}未引当 ${remaining}` : orderLabels[lines[0].order.status],
      affected: state.stopped && pending.length > 0, allocated: pending.length > 0 && remaining === 0 };
  }
  const change = (next: SupplyAllocationState, notice = '') => { onChange(next); setError(''); setMessage(notice); };
  const execute = (operation: () => SupplyAllocationState, notice: string) => {
    try { change(operation(), notice); } catch (reason) { setError(reason instanceof Error ? reason.message : '処理できませんでした。'); }
  };
  const select = (next: RecordSelection | null) => {
    setSelection(next);
    const row = next && visible.find(row => path(row).includes(`${next.tableId}:${next.recordId}`));
    setSelectedLineId(row ? row.line.id : '');
  };
  const start = (demo: boolean) => {
    if (state.events.length && !window.confirm('現在のデモ引当を初期化しますか？保存済みの記録は残ります。')) return;
    execute(() => selectAllocationSupplier(demo ? createAllocationDemo(source) : createAllocationState(source), state.supplierId), demo ? `${scenarioLabel}を読み込みました。` : '取得済み受注へ戻しました。商品在庫は未確認です。');
    setSelection(null); setSelectedLineId('');
  };
  const capture = () => {
    if (stale) throw new Error('基準データが異なります。引当を初期化してください。');
    const recordedAt = new Date().toISOString();
    const payload = allocationSnapshotSchema.parse({ schemaVersion: 1, execution: 'demo', recordedAt, state,
      data: { datasetId: data.datasetId, version: data.version, asOf: data.asOf, products: data.products, stores: data.stores, customers: data.customers, orders: data.orders, orderLines: data.orderLines } });
    return savedRecordSchema.parse({ id: crypto.randomUUID(), kind: 'allocation', recordedAt, datasetVersion: data.version, payload });
  };
  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const record = saveAttempt ?? capture();
      if (new TextEncoder().encode(JSON.stringify(record.payload)).byteLength > 64000) throw new Error('引当記録が64KBを超えています。JSON出力を使用してください。');
      onSaveAttempt(record);
      await workspace.repository.saveRecord(record, new AbortController().signal);
      onSaveAttempt(null);
      setMessage(workspace.mode === 'live' ? 'デモ引当記録をSQLへ保存し、読戻しを確認しました。実在庫は更新していません。' : 'デモ引当記録をメモリーへ保存しました。ページ再読み込み後は残りません。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存できませんでした。'); }
    finally { saving.current = false; setBusy(false); }
  };
  const exportRecord = () => {
    try { const record = capture(); downloadJson(record, `maikuro-allocation-${record.id}.json`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '出力できませんでした。'); }
  };
  const vipQuantity = active.filter(row => row.vip).reduce((total, row) => total + row.remaining, 0);
  const locked = busy || !!saveAttempt;
  return <div className="supply-allocation">
    <header className="sd-heading"><div><span className="eyebrow">供給停止と受注保護</span><h1>停止・受注引当</h1></div><span className="badge">デモ引当 / 外部在庫未連携</span></header>
    <div className="sr-start"><button disabled={locked || !source.allocation} onClick={() => start(true)}><Play size={16}/>登録シナリオを読み込む</button><button disabled={locked} onClick={() => start(false)}><RotateCcw size={16}/>取得済み受注で初期化</button><span className="badge">{state.source === 'demo' ? scenarioLabel : '取得済み受注'} / {data.version}</span></div>
    {error && <p className="message error" role="alert">{error}</p>}{message && <p className="message" role="status">{message}</p>}
    {stale && <p className="message error" role="alert">基準データが変わっています。引当を初期化してください。</p>}
    <fieldset className="sa-controls" disabled={locked || stale}><legend>停止条件</legend><label>供給会社<select aria-label="停止対象の供給会社" value={state.supplierId} onChange={event => { change(selectAllocationSupplier(state, event.target.value)); setSelection(null); setSelectedLineId(''); }}>{data.suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="sa-toggle"><input type="checkbox" checked={state.stopped} onChange={event => change(setAllocationSupplierStopped(state, event.target.checked))}/><CircleStop size={17}/>供給停止を仮定</label><label className="sa-toggle"><input type="checkbox" checked={history} onChange={event => { setHistory(event.target.checked); setSelection(null); setSelectedLineId(''); }}/>完了・取消の関連履歴も表示</label></fieldset>
    <fieldset className="sa-tiers" disabled={locked}><legend>VIP とする顧客区分</legend>{tiers.map(tier => <label key={tier}><input type="checkbox" checked={state.vipTiers.includes(tier)} onChange={event => change({ ...state, vipTiers: event.target.checked ? [...state.vipTiers, tier] : state.vipTiers.filter(value => value !== tier) })}/>{tier}</label>)}</fieldset>
    <section className="sd-metrics" aria-label="受注への影響"><div className={state.stopped ? 'is-risk' : ''}><span>停止の影響対象</span><strong>{state.stopped ? new Set(active.map(row => row.order.id)).size : 0}<small>受注</small></strong><span>受取完了・取消を除外</span></div><div><span><Crown size={15}/>対象の VIP 受注</span><strong>{new Set(active.filter(row => row.vip).map(row => row.order.id)).size}<small>件</small></strong></div><div><span>対象明細の引当済み</span><strong>{active.reduce((total, row) => total + row.allocated, 0)}<small>販売単位</small></strong></div><div className="is-risk"><span>確認済み在庫不足</span><strong>{totals.reduce((total, row) => total + (row.shortage ?? 0), 0)}<small>販売単位</small></strong><span>在庫未確認 {totals.filter(row => row.onHand === null).length} 商品・店舗</span></div></section>
    <OntologyExplorer model={model} scope={scope} title="供給会社から影響受注への経路" columns={[[ 'suppliers' ], [ 'products' ], [ 'orderLines' ], [ 'orders' ], [ 'customers' ]]} recordOnly dataLabel={state.source === 'demo' ? scenarioLabel : '取得済みレコード'} annotations={annotations} pathIds={selected ? path(selected) : []} selection={selection} onSelection={select}/>
    <div className="sa-legend"><span className="sa-stopped"><CircleStop size={15}/>停止仮定・影響経路</span><span className="sa-vip"><Crown size={15}/>VIP 顧客</span><span className="sr-ok"><PackageCheck size={15}/>対象分引当済み</span><span className="sa-path"><ArrowRight size={15}/>選択経路</span></div>
    <p className="scope-note">供給会社・商品・明細・受注・顧客の登録関係に基づく影響候補です。停止は補充の制約であり、既存在庫や実績の欠品記録は変更しません。</p>
    <section className="sa-stock"><h2>商品在庫と引当余力</h2><div className="table-scroll"><table><thead><tr><th>店舗・商品</th><th>在庫（仮定）</th><th>引当済み</th><th>利用可能</th><th>未引当需要</th><th>不足</th></tr></thead><tbody>{totals.map(pool => <tr key={`${pool.storeId}:${pool.productId}`}><th>{data.stores.find(row => row.id === pool.storeId)?.name}<small>{data.products.find(row => row.id === pool.productId)?.name}</small></th><td><StockInput key={`${state.source}:${pool.storeId}:${pool.productId}:${pool.onHand}`} value={pool.onHand} label={`${pool.storeId} ${pool.productId} の在庫`} disabled={locked || stale} onApply={onHand => execute(() => setAllocationStock(data, state, pool.storeId, pool.productId, onHand), '商品在庫の仮定を更新しました。')}/></td><td>{pool.reserved}</td><td>{pool.available ?? '未確認'}</td><td>{pool.demand}</td><td className="sd-danger">{pool.shortage ?? '未確認'}</td></tr>)}</tbody></table></div>{!totals.length && <p className="empty">対象会社に依存する未完了受注はありません。</p>}</section>
    <section className="sd-ledger"><div className="section-heading"><h2>影響受注と顧客</h2><button disabled={locked || stale || vipQuantity === 0 || !active.some(row => row.vip && row.remaining > 0 && (row.stock.available ?? 0) > 0)} onClick={() => { if (window.confirm('VIPの未引当明細へ、受注日時順に利用可能在庫を引き当てます。既存の引当は維持します。実行しますか？')) execute(() => reserveVipOrders(data, state), 'VIP優先引当を反映しました。在庫不足分は未引当で残っています。'); }}><Crown size={16}/>VIP 優先引当</button></div><div className="table-scroll"><table><thead><tr><th>受注・明細</th><th>顧客</th><th>商品・店舗</th><th>状態</th><th>受注数</th><th>引当済み</th><th>未引当</th><th>供給停止の影響</th></tr></thead><tbody>{visible.map(row => <tr key={row.line.id} className={selectedLineId === row.line.id ? 'is-selected' : ''}><td><button className="sd-record-link" onClick={() => select({ tableId: 'orderLines', recordId: row.line.id })}>{row.order.id}<ArrowRight size={13}/></button><small>{row.line.id}</small></td><td>{row.customer?.displayName ?? '顧客未確認'}<small className={row.vip ? 'sa-vip' : ''}>{row.vip ? <><Crown size={13}/>VIP</> : row.vip === null ? '区分未確認' : row.customer?.loyaltyTier}</small></td><td>{row.product.name}<small>{data.stores.find(store => store.id === row.order.storeId)?.name}</small></td><td>{orderLabels[row.order.status]}</td><td>{row.line.quantity}</td><td className={row.allocated ? 'sr-ok' : ''}>{row.allocated}</td><td>{row.active ? row.remaining : '対象外'}</td><td>{!row.active ? '履歴・対象外' : !state.stopped ? '停止仮定なし' : row.remaining === 0 ? '対象分を確保済み' : row.stock.available === null ? '在庫未確認' : '在庫引当・補充確認が必要'}</td></tr>)}</tbody></table></div>{!visible.length && <p className="empty">該当受注はありません。専用デモには VIP と一般顧客の未完了受注があります。</p>}</section>
    {selected && <section className="sa-selected" aria-label="選択明細の引当"><h2>{selected.order.id} / {selected.customer?.displayName ?? '顧客未確認'}</h2><p className="sa-route">{company?.name} → {selected.product.name} → {selected.line.id} → {selected.order.id} → {selected.customer?.displayName ?? '未確認'}</p><AllocationInput key={`${selected.line.id}:${selected.allocated}:${selected.stock.available}`} row={selected} disabled={locked || stale} onReserve={quantity => execute(() => reserveOrderLine(data, state, selected.line.id, quantity), '在庫を受注明細に引き当てました（デモ）。')} onRelease={() => execute(() => releaseOrderLine(data, state, selected.line.id), '引当を解除し、利用可能在庫へ戻しました（デモ）。')}/></section>}
    <section className="sa-audit"><div className="section-heading"><h2>引当・解除の記録</h2><div className="sa-actions"><button disabled={busy || (!saveAttempt && stale)} onClick={() => void save()}><Save size={16}/>{busy ? '保存中' : saveAttempt ? '前回の保存を再確認' : 'デモ引当記録を保存'}</button><button title="引当記録をJSON出力" aria-label="引当記録をJSON出力" disabled={locked || stale} onClick={exportRecord}><Download size={16}/></button></div></div><p className="scope-note">操作中の引当はこの画面のセッション内です。保存は記録の保管のみで、実 EC・共有在庫の引当や出荷は実行しません。</p><div className="table-scroll"><table><thead><tr><th>時刻</th><th>明細</th><th>操作</th><th>数量</th></tr></thead><tbody>{state.events.slice().reverse().map(event => <tr key={event.id}><td>{new Date(event.recordedAt).toLocaleString('ja-JP')}</td><td>{event.lineId}</td><td>{event.type === 'reserve' ? '引当' : '解除'}</td><td>{event.quantity}</td></tr>)}</tbody></table></div></section>
  </div>;
}

function StockInput({ value, label, disabled, onApply }: { value: number | null; label: string; disabled: boolean; onApply: (value: number | null) => void }) {
  const [input, setInput] = useState(value === null ? '' : String(value));
  return <form className="sa-stock-input" onSubmit={event => { event.preventDefault(); onApply(input === '' ? null : Number(input)); }}><input type="number" aria-label={label} min={0} step={1} placeholder="未確認" value={input} disabled={disabled} onChange={event => setInput(event.target.value)}/><button type="submit" disabled={disabled} title="在庫を反映" aria-label={`${label}を反映`}><Check size={15}/></button></form>;
}

function AllocationInput({ row, disabled, onReserve, onRelease }: { row: Exposure; disabled: boolean; onReserve: (quantity: number) => void; onRelease: () => void }) {
  const maximum = Math.max(0, Math.min(row.remaining, row.stock.available ?? 0));
  const [quantity, setQuantity] = useState(String(maximum));
  return <form className="sr-start" onSubmit={event => { event.preventDefault(); onReserve(Number(quantity)); }}><span>受注 {row.line.quantity} / 引当 {row.allocated} / 利用可能 {row.stock.available ?? '未確認'}</span><label>引当数量<input type="number" aria-label="明細への引当数量" min={1} max={maximum} step={1} required value={quantity} disabled={disabled || !row.active || !maximum} onChange={event => setQuantity(event.target.value)}/></label><button type="submit" disabled={disabled || !row.active || !maximum}><PackageCheck size={16}/>引当を実行</button><button type="button" disabled={disabled || row.allocated === 0} onClick={onRelease}><RotateCcw size={16}/>引当を解除</button></form>;
}