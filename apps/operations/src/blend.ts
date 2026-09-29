export interface BlendProject { id: string; name: string; facilityId: string }
export interface RoastingFacility { id: string; name: string; dailyCapacityGrams: number | null }
export interface GreenBean { id: string; name: string; origin: string }
export interface BeanImporter { id: string; name: string }
export interface BeanOffer {
  id: string; beanId: string; supplierId: string; importerId: string;
  costPerKgYen: number | null; roastYieldPercent: number | null;
  qualification: 'approved' | 'pending'; leadDays: number | null;
  validFrom: string; validUntil: string;
}
export interface BeanStock { id: string; facilityId: string; beanId: string; onHandGrams: number | null; asOf: string }
export interface BeanInbound { id: string; facilityId: string; beanId: string; incomingGrams: number; arrivalDate: string | null; confirmed: boolean }
export interface BeanProduct { id: string; name: string }
export interface BeanAllocation { id: string; facilityId: string; beanId: string; beanProductId: string; allocatedGrams: number }
export interface BlendDraft { id: string; projectId: string; name: string; bagGrams: number; unitPriceYen: number; packCostYen: number; productionDate: string }
export interface BlendComponent { id: string; draftId: string; offerId: string; sharePercent: number }
export interface BlendDestination { id: string; draftId: string; storeId: string; bags: number }
export interface BlendData {
  asOf: string; version: string;
  blendProjects: BlendProject[]; roastingFacilities: RoastingFacility[];
  greenBeans: GreenBean[]; beanImporters: BeanImporter[]; beanOffers: BeanOffer[];
  beanStocks: BeanStock[]; beanInbounds: BeanInbound[]; beanProducts: BeanProduct[];
  beanAllocations: BeanAllocation[]; blendDrafts: BlendDraft[];
  blendComponents: BlendComponent[]; blendDestinations: BlendDestination[];
}
export interface BlendScenario {
  draftId: string; productionDate: string; storeBags: Record<string, number>;
  components: { beanId: string; offerId: string; sharePercent: number }[];
}
export interface BeanRequirement {
  bean: GreenBean; offer: BeanOffer; sharePercent: number; roastedGrams: number;
  greenGrams: number | null; reservedGrams: number; incomingGrams: number;
  availableGrams: number | null; shortageGrams: number | null; costYen: number | null;
  allocations: BeanAllocation[]; checks: string[]; earliestArrival: string | null;
}
export interface BlendResult {
  draft: BlendDraft; facility: RoastingFacility; totalBags: number;
  roastedGrams: number; greenGrams: number | null; totalCostYen: number | null;
  unitCostYen: number | null; requirements: BeanRequirement[];
  capacityStatus: 'pass' | 'fail' | 'unknown';
  importerExposure: { importer: BeanImporter; greenGrams: number | null; supplierIds: string[]; beanIds: string[] }[];
}

export function defaultBlendScenario(data: BlendData, draftId = data.blendDrafts[0].id): BlendScenario {
  const draft = data.blendDrafts.find(row => row.id === draftId);
  if (!draft) throw new Error('配合案が見つかりません。');
  return {
    draftId, productionDate: draft.productionDate,
    storeBags: Object.fromEntries(data.blendDestinations.filter(row => row.draftId === draftId).map(row => [row.storeId, row.bags])),
    components: data.blendComponents.filter(row => row.draftId === draftId).map(row => {
      const offer = data.beanOffers.find(offer => offer.id === row.offerId);
      if (!offer) throw new Error('調達条件が見つかりません。');
      return { beanId: offer.beanId, offerId: offer.id, sharePercent: row.sharePercent };
    })
  };
}

export function analyzeBlend(data: BlendData, scenario: BlendScenario, storeIds: string[]): BlendResult {
  const draft = data.blendDrafts.find(row => row.id === scenario.draftId);
  const project = data.blendProjects.find(row => row.id === draft?.projectId);
  const facility = data.roastingFacilities.find(row => row.id === project?.facilityId);
  if (!draft || !facility) throw new Error('配合案または焙煎拠点が見つかりません。');
  const productionAt = Date.parse(`${scenario.productionDate}T00:00:00+09:00`);
  if (!Number.isFinite(productionAt) || productionAt <= Date.parse(data.asOf)) throw new Error('製造日は分析基準日より後を指定してください。');
  const destinations = Object.entries(scenario.storeBags);
  if (destinations.some(([storeId, bags]) => !storeIds.includes(storeId) || !Number.isSafeInteger(bags) || bags < 0 || bags > 100000)) throw new Error('袋数は店舗ごとに 0～100,000 の整数を指定してください。');
  const totalBags = destinations.reduce((total, [, bags]) => total + bags, 0);
  if (!totalBags) throw new Error('製造数量を 1 袋以上にしてください。');
  if (!scenario.components.length || new Set(scenario.components.map(row => row.beanId)).size !== scenario.components.length
    || scenario.components.some(row => !Number.isFinite(row.sharePercent) || row.sharePercent < 0 || row.sharePercent > 100)
    || Math.abs(scenario.components.reduce((total, row) => total + row.sharePercent, 0) - 100) > 0.000001) throw new Error('配合比率の合計を 100% にしてください。');
  const roastedGrams = totalBags * draft.bagGrams;
  const requirements = scenario.components.filter(row => row.sharePercent > 0).map(component => {
    const bean = data.greenBeans.find(row => row.id === component.beanId);
    const offer = data.beanOffers.find(row => row.id === component.offerId && row.beanId === component.beanId);
    if (!bean || !offer) throw new Error('豆と調達条件の組み合わせを確認してください。');
    const output = roastedGrams * component.sharePercent / 100;
    const greenGrams = offer.roastYieldPercent !== null && offer.roastYieldPercent > 0 && offer.roastYieldPercent <= 100 ? output * 100 / offer.roastYieldPercent : null;
    const stock = data.beanStocks.filter(row => row.beanId === bean.id && row.facilityId === facility.id && Date.parse(row.asOf) <= Date.parse(data.asOf)).sort((left, right) => Date.parse(right.asOf) - Date.parse(left.asOf))[0];
    const allocations = data.beanAllocations.filter(row => row.beanId === bean.id && row.facilityId === facility.id);
    const reservedGrams = allocations.reduce((total, row) => total + row.allocatedGrams, 0);
    const incomingGrams = data.beanInbounds.filter(row => row.beanId === bean.id && row.facilityId === facility.id && row.confirmed && row.arrivalDate !== null && Date.parse(`${row.arrivalDate}T00:00:00+09:00`) > Date.parse(data.asOf) && row.arrivalDate < scenario.productionDate).reduce((total, row) => total + row.incomingGrams, 0);
    const availableGrams = stock?.onHandGrams == null ? null : Math.max(0, stock.onHandGrams + incomingGrams - reservedGrams);
    const shortageGrams = greenGrams === null || availableGrams === null ? null : Math.max(0, greenGrams - availableGrams);
    const earliestArrival = offer.leadDays === null ? null : new Date(Date.parse(`${data.asOf.slice(0, 10)}T00:00:00Z`) + offer.leadDays * 86400000).toISOString().slice(0, 10);
    const checks: string[] = [];
    if (offer.qualification !== 'approved') checks.push('供給資格未承認');
    if (scenario.productionDate < offer.validFrom || scenario.productionDate > offer.validUntil) checks.push('見積期間外');
    if (greenGrams === null) checks.push('焙煎歩留まり未確認');
    if (availableGrams === null) checks.push('在庫未確認');
    if (shortageGrams !== null && shortageGrams > 0) checks.push(earliestArrival === null ? '追加調達の納期未確認' : earliestArrival >= scenario.productionDate ? '追加調達が製造に間に合わない見込み' : '追加発注が必要');
    const costYen = greenGrams === null || offer.costPerKgYen === null || scenario.productionDate < offer.validFrom || scenario.productionDate > offer.validUntil ? null : greenGrams * offer.costPerKgYen / 1000;
    if (offer.costPerKgYen === null) checks.push('価格未確認');
    return { bean, offer, sharePercent: component.sharePercent, roastedGrams: output, greenGrams, reservedGrams, incomingGrams, availableGrams, shortageGrams, costYen, allocations, checks, earliestArrival };
  });
  const greenGrams = requirements.some(row => row.greenGrams === null) ? null : requirements.reduce((total, row) => total + row.greenGrams!, 0);
  const totalCostYen = requirements.some(row => row.costYen === null) ? null : requirements.reduce((total, row) => total + row.costYen!, totalBags * draft.packCostYen);
  const importerExposure = [...new Set(requirements.map(row => row.offer.importerId))].map(importerId => {
    const importer = data.beanImporters.find(row => row.id === importerId);
    if (!importer) throw new Error('輸入元の参照先が見つかりません。');
    const related = requirements.filter(row => row.offer.importerId === importerId);
    return { importer, greenGrams: related.some(row => row.greenGrams === null) ? null : related.reduce((total, row) => total + row.greenGrams!, 0), supplierIds: [...new Set(related.map(row => row.offer.supplierId))], beanIds: related.map(row => row.bean.id) };
  });
  return { draft, facility, totalBags, roastedGrams, greenGrams, totalCostYen, unitCostYen: totalCostYen === null ? null : totalCostYen / totalBags, requirements, importerExposure, capacityStatus: greenGrams === null || facility.dailyCapacityGrams === null ? 'unknown' : greenGrams <= facility.dailyCapacityGrams ? 'pass' : 'fail' };
}