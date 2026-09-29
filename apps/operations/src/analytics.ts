import type { Dataset, ImpactResult, Requirement, ReviewFilter, RuleResult, Scenario } from './domain';

export const jpy = (value: number | null) => value === null ? '確認不能' : `${Math.round(value).toLocaleString('ja-JP')} 円`;
export const inclusivePrice = (price: number, tax: number) => price + Math.floor(price * tax / 100);
export const jstStart = (date: string) => `${date}T00:00:00+09:00`;
export const jstEnd = (date: string) => `${date}T23:59:59.999+09:00`;

export function selectReviews(data: Dataset, filter: ReviewFilter) {
  const latest = new Map<string, Dataset['reviews'][number]>();
  for (const review of data.reviews) {
    if (Date.parse(review.publishedAt) > Date.parse(data.asOf)) continue;
    const previous = latest.get(review.lineId);
    if (!previous || review.revision > previous.revision) latest.set(review.lineId, review);
  }
  return [...latest.values()].filter(review => {
    const line = data.orderLines.find(row => row.id === review.lineId);
    const order = data.orders.find(row => row.id === line?.orderId);
    return review.status === 'published' && review.analyzedAt !== null
      && Date.parse(review.analyzedAt) <= Date.parse(data.asOf)
      && order?.status === 'completed' && order.customerId === review.customerId
      && order.fulfilledAt !== null && Date.parse(order.fulfilledAt) <= Date.parse(review.publishedAt)
      && line?.productId === filter.productId && filter.storeIds.includes(order.storeId)
      && Date.parse(review.publishedAt) >= Date.parse(jstStart(filter.from))
      && Date.parse(review.publishedAt) <= Date.parse(jstEnd(filter.to));
  }).map(review => {
    const line = data.orderLines.find(row => row.id === review.lineId)!;
    const order = data.orders.find(row => row.id === line.orderId)!;
    const topics = [...new Set(data.reviewTopics.filter(row => row.reviewId === review.id && row.revision === review.revision).map(row => row.topic))];
    return { ...review, storeId: order.storeId, productId: line.productId, orderId: order.id, topics };
  });
}

export function analyzeConcept(data: Dataset, scenario: Scenario): ImpactResult {
  const concept = data.concepts.find(row => row.id === scenario.conceptId);
  if (!concept) throw new Error('候補が見つかりません。');
  const start = Date.parse(jstStart(scenario.start));
  const end = Date.parse(jstEnd(scenario.end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= Date.parse(data.asOf) || end < start) {
    throw new Error('展開期間は分析基準日時より後の有効な期間を指定してください。');
  }
  const quantities = Object.entries(scenario.storeQuantities).filter(([, count]) => count > 0);
  if (!quantities.length || Object.entries(scenario.storeQuantities).some(([id, count]) =>
    !data.stores.some(store => store.id === id) || !Number.isSafeInteger(count) || count < 0 || count > 100000)) {
    throw new Error('店舗と期間全体の想定杯数を確認してください。');
  }
  const recipe = data.recipeLines.filter(row => row.conceptId === concept.id);
  if (!recipe.length) throw new Error('配合が未登録です。');
  const cups = quantities.reduce((total, [, count]) => total + count, 0);
  let unitCost: number | null = 0;
  const requirements: Requirement[] = [];
  const offers = recipe.map(line => data.offers.find(offer => offer.id === line.offerId && offer.materialId === line.materialId));
  for (const line of recipe) {
    const material = data.materials.find(row => row.id === line.materialId);
    if (!material || line.quantity < 0 || line.yieldPercent <= 0 || line.yieldPercent > 100) throw new Error('原料または歩留まりが不正です。');
    const offer = data.offers.find(row => row.id === line.offerId && row.materialId === line.materialId);
    const inputPerCup = line.quantity * 100 / line.yieldPercent;
    if (offer?.pricePer100Units === null || !offer || unitCost === null) unitCost = null;
    else unitCost += inputPerCup * offer.pricePer100Units / 100;
    for (const [storeId, quantity] of quantities) {
      const stock = data.inventory.filter(row => row.storeId === storeId && row.materialId === material.id
        && Date.parse(row.asOf) <= Date.parse(data.asOf)).sort((left, right) => Date.parse(right.asOf) - Date.parse(left.asOf))[0];
      const inbound = data.inbound.filter(row => row.storeId === storeId && row.materialId === material.id
        && row.confirmed && row.expectedAt !== null && Date.parse(row.expectedAt) > Date.parse(data.asOf)
        && Date.parse(row.expectedAt) <= start).reduce((total, row) => total + row.quantity, 0);
      const available = stock?.onHand == null || stock.reserved == null ? null : Math.max(0, stock.onHand - stock.reserved + inbound);
      const required = inputPerCup * quantity;
      const existing = requirements.find(row => row.storeId === storeId && row.materialId === material.id);
      if (existing) {
        existing.required += required;
        existing.shortage = available === null ? null : Math.max(0, existing.required - available);
      } else requirements.push({ storeId, materialId: material.id, unit: material.unit, required, available,
        shortage: available === null ? null : Math.max(0, required - available),
        sharedProductIds: [...new Set(data.currentRecipes.filter(row => row.materialId === material.id).map(row => row.productId))] });
    }
  }
  const days = Math.floor((end - start) / 86400000) + 1;
  const rules: RuleResult[] = data.rules.map(rule => {
    if (rule.kind === 'price') return { rule, status: rule.threshold === null ? 'unknown' : inclusivePrice(concept.priceExTax, concept.taxPercent) <= rule.threshold ? 'pass' : 'fail', detail: `税込 ${jpy(inclusivePrice(concept.priceExTax, concept.taxPercent))} / 上限 ${jpy(rule.threshold)}` };
    if (rule.kind === 'aroma') return { rule, status: concept.aromaScore === null || rule.threshold === null ? 'unknown' : concept.aromaScore >= rule.threshold ? 'pass' : 'fail', detail: concept.aromaScore === null ? '官能評価は未実施です。' : `${concept.aromaScore} / 5` };
    if (rule.kind === 'qualification') return { rule, status: offers.every(offer => offer?.qualification === 'approved') ? 'pass' : 'unknown', detail: offers.every(offer => offer?.qualification === 'approved') ? '配合で参照する供給資格は登録済みです。' : '候補原料の供給資格は未確認です。' };
    if (rule.kind === 'quote') {
      const known = offers.every(offer => offer && offer.pricePer100Units !== null);
      const valid = known && offers.every(offer => offer && Date.parse(jstStart(offer.validFrom)) <= start && Date.parse(jstEnd(offer.validUntil)) >= end);
      return { rule, status: !known ? 'unknown' : valid ? 'pass' : 'fail', detail: valid ? '想定期間全体を価格条件の有効期間が包含します。' : '費用未入手または価格条件の期限外です。' };
    }
    const stores = quantities.map(([id, count]) => ({ store: data.stores.find(row => row.id === id)!, count }));
    const fail = stores.some(({ store, count }) => store.coldEquipment === false || (store.cupsPerDay !== null && count > store.cupsPerDay * days));
    const unknown = stores.some(({ store }) => store.coldEquipment === null || store.cupsPerDay === null);
    return { rule, status: fail ? 'fail' : unknown ? 'unknown' : 'pass', detail: '期間内に均等製造する仮定で設備・追加製造枠を比較します。繁忙時間帯は別途確認が必要です。' };
  });
  return { concept, cups, unitCost, cost: unitCost === null ? null : unitCost * cups,
    contribution: unitCost === null ? null : concept.priceExTax - unitCost, requirements, rules };
}