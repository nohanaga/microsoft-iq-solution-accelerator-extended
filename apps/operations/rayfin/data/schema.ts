import type { Origin, Supplier, Material, Facility, Product, Recipe, RecipeLine, WorkspaceRecord, CopilotConversation, CopilotMessage, GraphSnapshot, GraphSnapshotPart, EcOrder, EcOrderLine, EcProduct, EcCustomer, AllocationScenario, AllocationCustomer, AllocationOrder, AllocationOrderLine, AllocationStock } from './Workspace.js';

export type Schema = { Origin: Origin; Supplier: Supplier; Material: Material; Facility: Facility;
	Product: Product; Recipe: Recipe; RecipeLine: RecipeLine; WorkspaceRecord: WorkspaceRecord;
	CopilotConversation: CopilotConversation; CopilotMessage: CopilotMessage;
	GraphSnapshot: GraphSnapshot; GraphSnapshotPart: GraphSnapshotPart;
	EcOrder: EcOrder; EcOrderLine: EcOrderLine; EcProduct: EcProduct; EcCustomer: EcCustomer;
	AllocationScenario: AllocationScenario; AllocationCustomer: AllocationCustomer; AllocationOrder: AllocationOrder;
	AllocationOrderLine: AllocationOrderLine; AllocationStock: AllocationStock };