export interface Product {
  id: string; name: string; category: string; serving: string;
  priceExTax: number; taxPercent: number; supplierId: string | null;
}
export interface Store {
  id: string; name: string; city: string;
  coldEquipment: boolean | null; cupsPerDay: number | null;
}
export interface Supplier { id: string; name: string; city: string }
export interface Customer { id: string; displayName: string; loyaltyTier: string }
export interface Order {
  id: string; customerId: string; storeId: string; orderedAt: string;
  pickupAt?: string; fulfilledAt: string | null; status: 'confirmed' | 'completed' | 'cancelled' | 'delayed';
}
export interface OrderLine {
  id: string; orderId: string; productId: string; quantity: number;
  priceExTax: number; taxPercent: number; discountExTax: number;
}
export interface AllocationDataset {
  datasetId: string; version: string; asOf: string; dataOrigin: 'synthetic';
  customers: Customer[]; orders: Order[]; orderLines: OrderLine[];
  stocks: { id: string; storeId: string; productId: string; onHand: number }[];
}
export interface Review {
  id: string; lineId: string; customerId: string; revision: number;
  rating: number; text: string; publishedAt: string; analyzedAt: string | null;
  status: 'published' | 'pending' | 'withdrawn';
}
export interface ReviewTopic {
  id: string; reviewId: string; revision: number;
  topic: string; classifierVersion: string;
}
export interface ServiceFeedback {
  id: string; orderId: string; rating: number; text: string;
  dissatisfied: boolean; publishedAt: string;
}
export interface Material { id: string; name: string; unit: 'mL' | 'g' | 'each' }
export interface Offer {
  id: string; materialId: string; supplierId: string;
  pricePer100Units: number | null; validFrom: string; validUntil: string;
  qualification: 'approved' | 'pending'; sampleShipDate: string | null;
  evidenceId: string;
}
export interface Concept {
  id: string; name: string; version: string; projectId: string;
  priceExTax: number; taxPercent: number; aromaScore: number | null;
  description: string;
}
export interface RecipeLine {
  id: string; conceptId: string; materialId: string; offerId: string;
  quantity: number; yieldPercent: number;
}
export interface CurrentRecipe {
  id: string; productId: string; materialId: string; quantity: number;
}
export interface Inventory {
  id: string; storeId: string; materialId: string;
  onHand: number | null; reserved: number | null; asOf: string;
}
export interface Inbound {
  id: string; storeId: string; materialId: string; quantity: number;
  expectedAt: string | null; confirmed: boolean;
}
export interface Shipment {
  id: string; supplierId: string; storeId: string; expectedAt: string;
  arrivedAt: string | null; status: 'arrived' | 'delayed'; reason: string;
}
export interface SupplyImpact {
  id: string; shipmentId: string; lineId: string; productId: string;
  shortageAt: string; evidence: string;
}
export interface Evidence {
  id: string; kind: 'foundry' | 'work'; title: string; version: string;
  effectiveAt: string; path: string; quote: string; projectId: string;
  sourceUrl: string | null; dataOrigin: 'synthetic';
}
export interface Rule {
  id: string; name: string; kind: 'price' | 'aroma' | 'qualification' | 'quote' | 'equipment';
  threshold: number | null; evidenceId: string;
}
export interface DecisionReason {
  id: string; projectId: string; reason: string; pastEvidenceId: string;
  currentEvidenceId: string | null; change: string;
  status: 'changed' | 'unresolved' | 'unknown';
}
export interface Dataset {
  datasetId: string; version: string; asOf: string; timezone: string; dataOrigin: 'synthetic';
  allocation?: AllocationDataset;
  products: Product[]; stores: Store[]; suppliers: Supplier[]; customers: Customer[];
  orders: Order[]; orderLines: OrderLine[]; reviews: Review[];
  reviewTopics: ReviewTopic[]; serviceFeedback: ServiceFeedback[];
  materials: Material[]; offers: Offer[]; concepts: Concept[];
  recipeLines: RecipeLine[]; currentRecipes: CurrentRecipe[];
  inventory: Inventory[]; inbound: Inbound[];
  shipments: Shipment[]; supplyImpacts: SupplyImpact[];
  evidence: Evidence[]; rules: Rule[]; decisionReasons: DecisionReason[];
}
export interface ReviewFilter { productId: string; storeIds: string[]; from: string; to: string }
export interface Scenario {
  conceptId: string; start: string; end: string;
  storeQuantities: Record<string, number>;
}
export interface RuleResult { rule: Rule; status: 'pass' | 'fail' | 'unknown'; detail: string }
export interface Requirement {
  storeId: string; materialId: string; unit: Material['unit']; required: number;
  available: number | null; shortage: number | null; sharedProductIds: string[];
}
export interface ImpactResult {
  concept: Concept; cups: number; unitCost: number | null; cost: number | null;
  contribution: number | null; requirements: Requirement[]; rules: RuleResult[];
}