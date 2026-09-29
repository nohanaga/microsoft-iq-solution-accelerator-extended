import source from '../v3/data/development.json';

export type DevelopmentView = 'beverage' | 'blend';
export interface BlendOrigin { id: string; name: string; region: string }
export interface BlendSupplier { id: string; name: string; city: string }
export interface BlendMaterial { id: string; name: string; originId: string; supplierId: string; specification: string; pricePerKg: number }
export interface BlendFacility { id: string; name: string }
export interface BlendProduct { id: string; name: string; category: DevelopmentView; unit: string; gramsPerUnit: number }
export interface BlendRecipe { id: string; productId: string; name: string; status: string }
export interface BlendRecipeLine { id: string; recipeId: string; materialId: string; percent: number }
export interface BlendPlan { id: string; productId: string; recipeId: string; facilityId: string; units: number; status: string }
export interface BlendReservation { id: string; planId: string; materialId: string; grams: number }
export interface BlendStock { id: string; materialId: string; facilityId: string; grams: number | null }
export interface BlendDataset {
  datasetId: string; version: string; asOf: string; dataOrigin: string;
  origins: BlendOrigin[]; suppliers: BlendSupplier[]; materials: BlendMaterial[]; facilities: BlendFacility[];
  products: BlendProduct[]; recipes: BlendRecipe[]; recipeLines: BlendRecipeLine[];
  plans: BlendPlan[]; reservations: BlendReservation[]; stocks: BlendStock[];
}
export interface BlendComponent { materialId: string; percent: number }
export interface BlendScenario {
  productId: string; recipeId: string; units: number; facilityId: string;
  custom: BlendComponent[] | null;
}
export interface BlendRequirement {
  material: BlendMaterial; percent: number; requiredGrams: number; reservedGrams: number;
  stockGrams: number | null; availableGrams: number | null; shortageGrams: number | null;
}
export interface BlendCalculation {
  product: BlendProduct; recipe: BlendRecipe; requirements: BlendRequirement[];
  totalGrams: number; costPerUnit: number; totalCost: number; shortageGrams: number; unknownCount: number;
}
export const workbenchData = source as BlendDataset;
export const formatKg = (grams: number) => (grams / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
export function initialBlendScenario(view: DevelopmentView, data = workbenchData): BlendScenario {
  const product = data.products.find(row => row.category === view);
  const recipe = data.recipes.find(row => row.productId === product?.id);
  const facility = data.facilities[0];
  if (!product || !recipe || !facility) throw new Error('商品・配合・製造拠点が未登録です。');
  return { productId: product.id, recipeId: recipe.id,
    units: view === 'beverage' ? 500 : 100, facilityId: facility.id, custom: null };
}
export function scenarioComponents(scenario: BlendScenario, data = workbenchData): BlendComponent[] {
  return scenario.custom ?? data.recipeLines.filter(row => row.recipeId === scenario.recipeId).map(row => ({ materialId: row.materialId, percent: row.percent }));
}
export function materializeBlend(scenario: BlendScenario, data = workbenchData): BlendDataset {
  const recipeId = scenario.custom ? `DRAFT-${scenario.productId}` : scenario.recipeId;
  return { ...data,
    recipes: scenario.custom ? [...data.recipes, { id: recipeId, productId: scenario.productId, name: 'カスタム', status: 'draft' }] : data.recipes,
    recipeLines: scenario.custom ? [...data.recipeLines, ...scenario.custom.map(row => ({ ...row, id: `${recipeId}-${row.materialId}`, recipeId }))] : data.recipeLines,
    plans: [...data.plans, { id: `DRAFT-PLAN-${scenario.productId}`, productId: scenario.productId, recipeId, facilityId: scenario.facilityId, units: scenario.units, status: 'draft' }],
  };
}
export function calculateBlend(scenario: BlendScenario, data = workbenchData): BlendCalculation {
  const product = data.products.find(row => row.id === scenario.productId);
  if (!product) throw new Error('商品を選択してください。');
  if (!Number.isSafeInteger(scenario.units) || scenario.units < 1 || scenario.units > 10000) throw new Error('製造数は 1～10,000 の整数で指定してください。');
  const registered = data.recipes.find(row => row.id === scenario.recipeId && row.productId === product.id);
  if (!registered) throw new Error('商品の配合を選択してください。');
  if (!data.facilities.some(row => row.id === scenario.facilityId)) throw new Error('製造拠点を選択してください。');
  const components = scenarioComponents(scenario, data);
  if (!components.length || components.some(row => !Number.isFinite(row.percent) || row.percent <= 0 || row.percent > 100)) throw new Error('各豆の比率を 0 より大きく、100% 以下にしてください。');
  if (new Set(components.map(row => row.materialId)).size !== components.length) throw new Error('同じ豆は一つの配合明細にまとめてください。');
  const totalPercent = components.reduce((total, row) => total + row.percent, 0);
  if (Math.abs(totalPercent - 100) > .001) throw new Error(`配合の合計を 100% にしてください。現在 ${Number(totalPercent.toFixed(2))}% です。`);
  const requirements = components.map(component => {
    const material = data.materials.find(row => row.id === component.materialId);
    if (!material) throw new Error('登録された豆を選択してください。');
    const stocks = data.stocks.filter(row => row.materialId === material.id && row.facilityId === scenario.facilityId);
    const stockGrams = !stocks.length || stocks.some(row => row.grams === null) ? null : stocks.reduce((total, row) => total + row.grams!, 0);
    const reservedGrams = data.reservations.filter(row => row.materialId === material.id && data.plans.some(plan => plan.id === row.planId && plan.facilityId === scenario.facilityId && plan.status === 'confirmed')).reduce((total, row) => total + row.grams, 0);
    const availableGrams = stockGrams === null ? null : Math.max(0, stockGrams - reservedGrams);
    const requiredGrams = product.gramsPerUnit * component.percent / 100 * scenario.units;
    return { material, percent: component.percent, stockGrams, reservedGrams, availableGrams, requiredGrams,
      shortageGrams: availableGrams === null ? null : Math.max(0, requiredGrams - availableGrams) };
  });
  const totalCost = requirements.reduce((total, row) => total + row.requiredGrams / 1000 * row.material.pricePerKg, 0);
  return { product, recipe: scenario.custom ? { id: `DRAFT-${product.id}`, productId: product.id, name: 'カスタム', status: 'draft' } : registered,
    requirements, totalGrams: product.gramsPerUnit * scenario.units, totalCost, costPerUnit: totalCost / scenario.units,
    shortageGrams: requirements.reduce((total, row) => total + (row.shortageGrams ?? 0), 0), unknownCount: requirements.filter(row => row.shortageGrams === null).length };
}