export type DevelopmentView = 'beverage' | 'blend';
export interface SharedScenario { recipeId: string; bags: number }
export interface DevelopmentMaterial { id: string; name: string; specification: string }
export interface DevelopmentProduct { id: string; name: string; unit: string }
export interface DevelopmentRecipe { id: string; productId: string; name: string }
export interface DevelopmentRecipeLine { id: string; recipeId: string; materialId: string; gramsPerUnit: number }
export interface DevelopmentPlan { id: string; productId: string; recipeId: string; units: number; facilityId: string }
export interface DevelopmentReservation { id: string; planId: string; materialId: string; grams: number }
export interface DevelopmentStock { id: string; facilityId: string; materialId: string; grams: number }
export interface DevelopmentVoice { id: string; productId: string; text: string; source: string }
export interface SharedDevelopmentData {
  id: string; version: string; asOf: string; facilityId: string; facilityName: string;
  materials: DevelopmentMaterial[]; products: DevelopmentProduct[];
  recipes: DevelopmentRecipe[]; recipeLines: DevelopmentRecipeLine[];
  plans: DevelopmentPlan[]; reservations: DevelopmentReservation[];
  stocks: DevelopmentStock[]; voices: DevelopmentVoice[];
}

export const developmentData: SharedDevelopmentData = {
  id: 'maikuro-development-v2', version: '2026-09-11.1', asOf: '2026-07-08T18:00:00+09:00',
  facilityId: 'V2-CENTRAL', facilityName: '中央製造拠点',
  materials: [
    { id: 'ROASTED-CO', name: 'コロンビア豆', specification: '焙煎済み / 共通規格 CO-01' },
    { id: 'ROASTED-BR', name: 'ブラジル豆', specification: '焙煎済み / 規格 BR-01' },
  ],
  products: [
    { id: 'V2-LATTE', name: '甘さひかえめラテ', unit: '杯' },
    { id: 'V2-BLEND', name: 'オリジナルブレンド', unit: '袋' },
  ],
  recipes: [
    { id: 'LATTE-01', productId: 'V2-LATTE', name: '飲料案' },
    { id: 'BLEND-01', productId: 'V2-BLEND', name: '案 A' },
    { id: 'BLEND-02', productId: 'V2-BLEND', name: '案 B' },
  ],
  recipeLines: [
    { id: 'LINE-LATTE-CO', recipeId: 'LATTE-01', materialId: 'ROASTED-CO', gramsPerUnit: 20 },
    { id: 'LINE-A-CO', recipeId: 'BLEND-01', materialId: 'ROASTED-CO', gramsPerUnit: 100 },
    { id: 'LINE-A-BR', recipeId: 'BLEND-01', materialId: 'ROASTED-BR', gramsPerUnit: 100 },
    { id: 'LINE-B-CO', recipeId: 'BLEND-02', materialId: 'ROASTED-CO', gramsPerUnit: 150 },
    { id: 'LINE-B-BR', recipeId: 'BLEND-02', materialId: 'ROASTED-BR', gramsPerUnit: 50 },
  ],
  plans: [{ id: 'PLAN-LATTE', productId: 'V2-LATTE', recipeId: 'LATTE-01', units: 500, facilityId: 'V2-CENTRAL' }],
  reservations: [{ id: 'RESERVE-LATTE-CO', planId: 'PLAN-LATTE', materialId: 'ROASTED-CO', grams: 10000 }],
  stocks: [
    { id: 'STOCK-CO', facilityId: 'V2-CENTRAL', materialId: 'ROASTED-CO', grams: 20000 },
    { id: 'STOCK-BR', facilityId: 'V2-CENTRAL', materialId: 'ROASTED-BR', grams: 30000 },
  ],
  voices: [{ id: 'VOICE-LATTE', productId: 'V2-LATTE', text: '甘さ控えめのラテも選べるとうれしいです。', source: 'デモ用の顧客の声' }],
};

export const initialSharedScenario: SharedScenario = { recipeId: 'BLEND-01', bags: 100 };
export interface SharedRequirement {
  material: DevelopmentMaterial; stock: DevelopmentStock; reservedGrams: number;
  availableGrams: number; requiredGrams: number; shortageGrams: number; sharePercent: number;
  reservations: DevelopmentReservation[];
}
export interface SharedDevelopmentResult {
  recipe: DevelopmentRecipe; requirements: SharedRequirement[];
  colombia: SharedRequirement; totalGrams: number; shortageGrams: number;
}

export function calculateSharedDevelopment(scenario: SharedScenario, data = developmentData): SharedDevelopmentResult {
  if (!Number.isSafeInteger(scenario.bags) || scenario.bags < 1 || scenario.bags > 1000) {
    throw new Error('袋数は 1～1,000 の整数で指定してください。');
  }
  const recipe = data.recipes.find(row => row.id === scenario.recipeId && row.productId === 'V2-BLEND');
  if (!recipe) throw new Error('配合案が見つかりません。');
  const lines = data.recipeLines.filter(row => row.recipeId === recipe.id);
  const gramsPerBag = lines.reduce((total, line) => total + line.gramsPerUnit, 0);
  if (gramsPerBag !== 200) throw new Error('配合は 1 袋 200 g で登録してください。');
  const requirements = lines.map(line => {
    const material = data.materials.find(row => row.id === line.materialId);
    const stock = data.stocks.find(row => row.materialId === line.materialId && row.facilityId === data.facilityId);
    if (!material || !stock) throw new Error('豆または在庫が未登録です。');
    const reservations = data.reservations.filter(row => row.materialId === material.id
      && data.plans.some(plan => plan.id === row.planId && plan.facilityId === stock.facilityId));
    const reservedGrams = reservations.reduce((total, row) => total + row.grams, 0);
    const availableGrams = Math.max(0, stock.grams - reservedGrams);
    const requiredGrams = line.gramsPerUnit * scenario.bags;
    return { material, stock, reservations, reservedGrams, availableGrams, requiredGrams,
      shortageGrams: Math.max(0, requiredGrams - availableGrams), sharePercent: line.gramsPerUnit / gramsPerBag * 100 };
  });
  const colombia = requirements.find(row => row.material.id === 'ROASTED-CO');
  if (!colombia) throw new Error('共通のコロンビア豆が見つかりません。');
  return { recipe, requirements, colombia, totalGrams: gramsPerBag * scenario.bags,
    shortageGrams: requirements.reduce((total, row) => total + row.shortageGrams, 0) };
}

export const formatKg = (grams: number) => (grams / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 2 });