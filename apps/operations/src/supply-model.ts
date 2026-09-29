import type { Dataset, Order, OrderLine, Shipment, SupplyImpact } from './domain';

export type SupplyPeriod = 'current' | 'all';
export type ArrivalState = 'late-arrived' | 'late-pending' | 'on-time' | 'scheduled' | 'unknown';
export interface LinkedSupplyImpact {
  impact: SupplyImpact;
  line: OrderLine;
  order: Order;
}
export interface SupplyShipment {
  shipment: Shipment;
  state: ArrivalState;
  delayHours: number | null;
  arrivedAt: string | null;
  impacts: LinkedSupplyImpact[];
}

export const arrivalLabels: Record<ArrivalState, string> = {
  'late-arrived': '遅延・到着済み', 'late-pending': '遅延・未着',
  'on-time': '定刻内に到着', scheduled: '入荷予定', unknown: '到着未確認',
};
export const isLate = (row: SupplyShipment) => row.state === 'late-arrived' || row.state === 'late-pending';
export const supplyDate = (value: string) => new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value));
export const delayLabel = (hours: number | null) => hours === null ? '時間未確認'
  : hours >= 24 && hours % 24 === 0 ? `${hours / 24} 日` : `${Number(hours.toFixed(1))} 時間`;
export const lineAmount = (line: OrderLine) => line.quantity * line.priceExTax - line.discountExTax;

export function summarizeSupply(rows: SupplyShipment[]) {
  const linked = rows.flatMap(row => row.impacts);
  const cancelled = [...new Map(linked.filter(row => row.order.status === 'cancelled').map(row => [row.line.id, row])).values()];
  return {
    lateCount: rows.filter(isLate).length,
    pendingCount: rows.filter(row => row.state === 'late-pending').length,
    impactedStoreCount: new Set(linked.map(row => row.order.storeId)).size,
    cancelled,
    cancelledAmount: cancelled.reduce((total, row) => total + lineAmount(row.line), 0),
  };
}

export function selectSupply(data: Dataset, period: SupplyPeriod = 'current'): SupplyShipment[] {
  const asOf = Date.parse(data.asOf);
  const month = (value: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone: data.timezone, year: 'numeric', month: '2-digit',
  }).format(new Date(value));
  return data.shipments.filter(shipment => period === 'all' || month(shipment.expectedAt) === month(data.asOf)).map(shipment => {
    const expected = Date.parse(shipment.expectedAt);
    const arrivedAt = shipment.arrivedAt && Date.parse(shipment.arrivedAt) <= asOf ? shipment.arrivedAt : null;
    const delayHours = Number.isFinite(expected) && (arrivedAt || shipment.status === 'delayed')
      ? Math.max(0, ((arrivedAt ? Date.parse(arrivedAt) : asOf) - expected) / 3600000) : null;
    const state: ArrivalState = arrivedAt ? (delayHours && delayHours > 0 ? 'late-arrived' : 'on-time')
      : shipment.status === 'arrived' ? 'unknown'
      : expected > asOf ? 'scheduled' : 'late-pending';
    const impacts = data.supplyImpacts.filter(impact => impact.shipmentId === shipment.id && Date.parse(impact.shortageAt) <= asOf).flatMap(impact => {
      const line = data.orderLines.find(candidate => candidate.id === impact.lineId && candidate.productId === impact.productId);
      const order = data.orders.find(candidate => candidate.id === line?.orderId && candidate.storeId === shipment.storeId);
      return line && order ? [{ impact, line, order }] : [];
    });
    return { shipment, state, delayHours, arrivedAt, impacts };
  }).sort((first, second) => Number(isLate(second)) - Number(isLate(first)) || second.shipment.expectedAt.localeCompare(first.shipment.expectedAt));
}

export interface ProductAllocationStock { storeId: string; productId: string; onHand: number | null }
export interface OrderAllocation { lineId: string; quantity: number }
export interface AllocationEvent { id: string; recordedAt: string; type: 'reserve' | 'release'; lineId: string; quantity: number }
export interface SupplyAllocationState {
  source: 'workspace' | 'demo';
  datasetId: string;
  datasetVersion: string;
  supplierId: string;
  stopped: boolean;
  stoppedSupplierIds?: string[];
  vipTiers: string[];
  stocks: ProductAllocationStock[];
  allocations: OrderAllocation[];
  events: AllocationEvent[];
}

export const canAllocateOrder = (order: Order) => (order.status === 'confirmed' || order.status === 'delayed') && !order.fulfilledAt;
export const allocatedQuantity = (state: SupplyAllocationState, lineId: string) => state.allocations.find(row => row.lineId === lineId)?.quantity ?? 0;

export function allocationStock(data: Dataset, state: SupplyAllocationState, storeId: string, productId: string) {
  const stock = state.stocks.find(row => row.storeId === storeId && row.productId === productId);
  const lineIds = new Set(data.orderLines.filter(line => line.productId === productId && data.orders.some(order => order.id === line.orderId && order.storeId === storeId)).map(line => line.id));
  const reserved = state.allocations.filter(row => lineIds.has(row.lineId)).reduce((total, row) => total + row.quantity, 0);
  return { onHand: stock?.onHand ?? null, reserved, available: stock?.onHand == null ? null : stock.onHand - reserved };
}

export function supplierOrderExposure(data: Dataset, state: SupplyAllocationState) {
  return data.orderLines.flatMap(line => {
    const product = data.products.find(row => row.id === line.productId && row.supplierId === state.supplierId);
    const order = data.orders.find(row => row.id === line.orderId);
    if (!product || !order) return [];
    const customer = data.customers.find(row => row.id === order.customerId);
    const allocated = allocatedQuantity(state, line.id);
    const active = canAllocateOrder(order);
    return [{ line, product, order, customer, active, allocated,
      remaining: active ? Math.max(0, line.quantity - allocated) : 0,
      vip: customer ? state.vipTiers.includes(customer.loyaltyTier) : null,
      stock: allocationStock(data, state, order.storeId, product.id),
    }];
  }).sort((first, second) => Number(second.active) - Number(first.active) || Number(second.vip) - Number(first.vip)
    || first.order.orderedAt.localeCompare(second.order.orderedAt) || first.line.id.localeCompare(second.line.id));
}

export function createAllocationState(data: Dataset): SupplyAllocationState {
  return { source: 'workspace', datasetId: data.datasetId, datasetVersion: data.version,
    supplierId: data.suppliers.find(row => row.id === 'SUP-02')?.id ?? data.suppliers[0]?.id ?? '',
    stopped: false, stoppedSupplierIds: [], vipTiers: ['VIP'], stocks: [], allocations: [], events: [] };
}

export function selectAllocationSupplier(state: SupplyAllocationState, supplierId: string): SupplyAllocationState {
  const stoppedSupplierIds = [...new Set([...(state.stoppedSupplierIds ?? []).filter(id => id !== state.supplierId), ...(state.stopped ? [state.supplierId] : [])])];
  return { ...state, supplierId, stoppedSupplierIds, stopped: stoppedSupplierIds.includes(supplierId) };
}

export function setAllocationSupplierStopped(state: SupplyAllocationState, stopped: boolean): SupplyAllocationState {
  const stoppedSupplierIds = (state.stoppedSupplierIds ?? []).filter(id => id !== state.supplierId);
  return { ...state, stopped, stoppedSupplierIds: stopped ? [...stoppedSupplierIds, state.supplierId] : stoppedSupplierIds };
}

export function allocationGraphScope(data: Dataset, state: SupplyAllocationState, history = false) {
  const rows = supplierOrderExposure(data, state).filter(row => history || row.active);
  return { suppliers: [state.supplierId], products: data.products.filter(row => row.supplierId === state.supplierId).map(row => row.id),
    orderLines: rows.map(row => row.line.id), orders: [...new Set(rows.map(row => row.order.id))],
    customers: [...new Set(rows.flatMap(row => row.customer ? [row.customer.id] : []))] };
}

function assertAllocationDataset(data: Dataset, state: SupplyAllocationState) {
  if (state.datasetId !== data.datasetId || state.datasetVersion !== data.version) throw new Error('基準データが変わりました。引当を初期化してください。');
}

export function setAllocationStock(data: Dataset, state: SupplyAllocationState, storeId: string, productId: string, onHand: number | null): SupplyAllocationState {
  assertAllocationDataset(data, state);
  if (!data.stores.some(row => row.id === storeId) || !data.products.some(row => row.id === productId)) throw new Error('店舗・商品を確認してください。');
  if (onHand !== null && (!Number.isSafeInteger(onHand) || onHand < 0)) throw new Error('在庫は0以上の整数で入力してください。');
  const { reserved } = allocationStock(data, state, storeId, productId);
  if ((onHand === null && reserved > 0) || (onHand !== null && onHand < reserved)) throw new Error('引当済み数量を下回る在庫には変更できません。先に引当を解除してください。');
  return { ...state, stocks: [...state.stocks.filter(row => row.storeId !== storeId || row.productId !== productId), { storeId, productId, onHand }] };
}

export function reserveOrderLine(data: Dataset, state: SupplyAllocationState, lineId: string, quantity: number): SupplyAllocationState {
  assertAllocationDataset(data, state);
  const row = supplierOrderExposure(data, state).find(candidate => candidate.line.id === lineId);
  if (!row?.active) throw new Error('この明細は引当対象ではありません。完了・取消の注文には引当できません。');
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > row.remaining) throw new Error('引当数量は未引当数量以内の正の整数にしてください。');
  if (row.stock.available === null) throw new Error('商品在庫が未確認です。在庫を入力してください。');
  if (quantity > row.stock.available) throw new Error('利用可能在庫を超える引当はできません。');
  return { ...state, allocations: [...state.allocations.filter(allocation => allocation.lineId !== lineId), { lineId, quantity: row.allocated + quantity }],
    events: [...state.events, { id: crypto.randomUUID(), recordedAt: new Date().toISOString(), type: 'reserve', lineId, quantity }] };
}

export function releaseOrderLine(data: Dataset, state: SupplyAllocationState, lineId: string): SupplyAllocationState {
  assertAllocationDataset(data, state);
  const quantity = allocatedQuantity(state, lineId);
  if (!quantity) return state;
  return { ...state, allocations: state.allocations.filter(row => row.lineId !== lineId),
    events: [...state.events, { id: crypto.randomUUID(), recordedAt: new Date().toISOString(), type: 'release', lineId, quantity }] };
}

export function reserveVipOrders(data: Dataset, state: SupplyAllocationState): SupplyAllocationState {
  assertAllocationDataset(data, state);
  let next = state;
  for (const row of supplierOrderExposure(data, state).filter(row => row.active && row.vip)) {
    const stock = allocationStock(data, next, row.order.storeId, row.product.id);
    const quantity = Math.min(row.remaining, stock.available ?? 0);
    if (quantity > 0) next = reserveOrderLine(data, next, row.line.id, quantity);
  }
  return next;
}

export function allocationDemoData(source: Dataset): Dataset {
  if (!source.allocation) throw new Error('登録済みの引当データを取得できません。データを再取得してください。');
  return { ...source, ...source.allocation, shipments: [], supplyImpacts: [], reviews: [], reviewTopics: [], serviceFeedback: [] };
}

export function createAllocationDemo(source: Dataset): SupplyAllocationState {
  const data = allocationDemoData(source);
  const state = createAllocationState(data);
  return { ...state, source: 'demo', stocks: source.allocation!.stocks.map(({ storeId, productId, onHand }) => ({ storeId, productId, onHand })) };
}