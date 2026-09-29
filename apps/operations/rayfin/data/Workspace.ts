import { entity, role, uuid, text, decimal, int } from '@microsoft/rayfin-core';

@entity()
@role('authenticated', ['read', 'create'])
export class Origin {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text() name!: string;
  @text() region!: string;
}

@entity()
@role('authenticated', ['read', 'create'])
export class Supplier {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text() name!: string;
  @text() city!: string;
}

@entity()
@role('authenticated', ['read', 'create'])
export class Material {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text() name!: string;
  @text() originId!: string;
  @text() supplierId!: string;
  @text() specification!: string;
  @decimal() pricePerKg!: number;
}

@entity()
@role('authenticated', ['read', 'create'])
export class Facility {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text() name!: string;
}

@entity()
@role('authenticated', ['read', 'create'])
export class Product {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text() name!: string;
  @text() category!: string;
  @text() unit!: string;
  @decimal() gramsPerUnit!: number;
}

@entity()
@role('authenticated', ['read', 'create'])
export class Recipe {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text() productId!: string;
  @text() name!: string;
  @text() status!: string;
}

@entity()
@role('authenticated', ['read', 'create'])
export class RecipeLine {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text() recipeId!: string;
  @text() materialId!: string;
  @decimal() percent!: number;
}

@entity()
@role('authenticated', ['read', 'create'])
export class WorkspaceRecord {
  @uuid() id!: string;
  @text() kind!: string;
  @text() recordedAt!: string;
  @text() datasetVersion!: string;
  @text() payload!: string;
}

@entity()
@role('authenticated', ['read', 'create'], {
  policy: (claims, item) => claims.sub.eq(item.userId),
})
export class CopilotConversation {
  @uuid() id!: string;
  @text({ max: 128 }) userId!: string;
  @text({ max: 256 }) foundryConversationId!: string;
  @text({ max: 128 }) agentName!: string;
  @text({ max: 64 }) agentVersion!: string;
  @text({ max: 256 }) title!: string;
  @text({ max: 24 }) status!: string;
  @text({ max: 40 }) createdAt!: string;
}

@entity()
@role('authenticated', ['read', 'create', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.userId),
})
export class GraphSnapshot {
  @uuid() id!: string;
  @text({ max: 128 }) userId!: string;
  @text({ max: 64 }) cacheKey!: string;
  @text({ max: 128 }) graphId!: string;
  @text({ max: 40 }) retrievedAt!: string;
  @text({ max: 64 }) payloadHash!: string;
  @int({ min: 1, max: 512 }) partCount!: number;
}

@entity()
@role('authenticated', ['read', 'create', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.userId),
})
export class GraphSnapshotPart {
  @uuid() id!: string;
  @uuid() snapshotId!: string;
  @text({ max: 128 }) userId!: string;
  @int({ min: 0, max: 511 }) position!: number;
  @text({ max: 4000 }) payload!: string;
}

@entity()
@role('authenticated', ['read', 'create'], {
  policy: (claims, item) => claims.sub.eq(item.userId),
})
export class CopilotMessage {
  @uuid() id!: string;
  @uuid() conversationId!: string;
  @text({ max: 128 }) userId!: string;
  @text({ max: 16 }) role!: string;
  @text({ max: 4000 }) content!: string;
  @text({ max: 4000 }) contextJson!: string;
  @text({ max: 4000 }) referencesJson!: string;
  @text({ max: 36 }) requestMessageId!: string;
  @text({ optional: true, max: 128 }) foundryResponseId?: string;
  @int({ min: 0 }) sequence!: number;
  @text({ max: 40 }) createdAt!: string;
}

@entity()
@role('authenticated', ['read'])
export class EcOrder {
  @uuid() id!: string;
  @text({ unique: true, max: 64 }) businessId!: string;
  @text({ unique: true, max: 36 }) sourceOrderId!: string;
  @text({ max: 128 }) customerId!: string;
  @text({ max: 128 }) storeId!: string;
  @text({ max: 40 }) orderedAt!: string;
  @text({ max: 40 }) pickupAt!: string;
  @text({ optional: true, max: 40 }) fulfilledAt?: string;
  @text({ max: 20 }) status!: string;
}

@entity()
@role('authenticated', ['read'])
export class EcOrderLine {
  @uuid() id!: string;
  @text({ unique: true, max: 36 }) businessId!: string;
  @text({ max: 64 }) orderId!: string;
  @text({ max: 128 }) productId!: string;
  @int({ min: 1 }) quantity!: number;
  @int({ min: 0 }) priceExTax!: number;
  @decimal({ precision: 5, scale: 2, min: 0, max: 100 }) taxPercent!: number;
  @int({ min: 0 }) discountExTax!: number;
}

@entity()
@role('authenticated', ['read'])
export class EcProduct {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text({ max: 256 }) name!: string;
  @text({ max: 128 }) category!: string;
  @text({ max: 128 }) serving!: string;
  @int({ min: 0 }) priceExTax!: number;
  @decimal({ precision: 5, scale: 2, min: 0, max: 100 }) taxPercent!: number;
  @text({ optional: true, max: 128 }) supplierId?: string;
}

@entity()
@role('authenticated', ['read'])
export class EcCustomer {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text({ max: 256 }) displayName!: string;
  @text({ max: 32 }) loyaltyTier!: string;
  @text({ max: 128 }) source!: string;
}

@entity()
@role('authenticated', ['read'])
export class AllocationScenario {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text({ max: 64 }) version!: string;
  @text({ max: 40 }) asOf!: string;
  @text({ max: 32 }) dataOrigin!: string;
}

@entity()
@role('authenticated', ['read'])
export class AllocationCustomer {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text({ max: 128 }) scenarioId!: string;
  @text({ max: 256 }) displayName!: string;
  @text({ max: 32 }) loyaltyTier!: string;
}

@entity()
@role('authenticated', ['read'])
export class AllocationOrder {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text({ max: 128 }) scenarioId!: string;
  @text({ max: 128 }) customerId!: string;
  @text({ max: 128 }) storeId!: string;
  @text({ max: 40 }) orderedAt!: string;
  @text({ max: 40 }) pickupAt!: string;
  @text({ optional: true, max: 40 }) fulfilledAt?: string;
  @text({ max: 20 }) status!: string;
}

@entity()
@role('authenticated', ['read'])
export class AllocationOrderLine {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text({ max: 128 }) scenarioId!: string;
  @text({ max: 128 }) orderId!: string;
  @text({ max: 128 }) productId!: string;
  @int({ min: 1 }) quantity!: number;
  @int({ min: 0 }) priceExTax!: number;
  @decimal({ precision: 5, scale: 2, min: 0, max: 100 }) taxPercent!: number;
  @int({ min: 0 }) discountExTax!: number;
}

@entity()
@role('authenticated', ['read'])
export class AllocationStock {
  @uuid() id!: string;
  @text({ unique: true, max: 128 }) businessId!: string;
  @text({ max: 128 }) scenarioId!: string;
  @text({ max: 128 }) storeId!: string;
  @text({ max: 128 }) productId!: string;
  @int({ min: 0 }) onHand!: number;
}