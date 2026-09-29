import type { BlendDataset, BlendScenario } from './blend-workbench-model';
import { materializeBlend, scenarioComponents } from './blend-workbench-model';
import type { Dataset } from './domain';
import { createOntology, developmentDefinition, supplyDefinition } from '../v3/ontology/model';
import type { OntologyModel } from '../v3/ontology/model';
export type { PropertyValueType, EntityRecord, OntologyProperty, OntologyTable, OntologyRelation, OntologyModel } from '../v3/ontology/model';
export interface RecordSelection { tableId: string; recordId?: string }
export interface GraphScope { [tableId: string]: string[] }
export type GraphDomain = 'development' | 'supply';
export interface GraphTableInfo { id: string; entityType: string; label: string; keyProperty: string; displayProperty: string }
export interface GraphRelationInfo { name: string; sourceEntityType: string; targetEntityType: string }

const graphTableCache = new Map<GraphDomain, GraphTableInfo[]>();
const graphRelationCache = new Map<GraphDomain, GraphRelationInfo[]>();

/** Fabric GraphModel が返す entityType とプロパティ名だけを取り出す。行データは含めない。 */
export function graphTables(domain: GraphDomain): GraphTableInfo[] {
  const cached = graphTableCache.get(domain);
  if (cached) return cached;
  const definition = domain === 'development' ? developmentDefinition : supplyDefinition;
  const tables = definition.tables.map(table => {
    const keyProperty = table.properties.find(property => property.sourceColumn === table.key)?.name;
    const displayProperty = table.properties.find(property => property.sourceColumn === table.displayColumn)?.name;
    if (!keyProperty || !displayProperty) throw new Error(`Graph プロパティが構成されていません: ${table.id}`);
    return { id: table.id, entityType: table.entityType, label: table.label, keyProperty, displayProperty };
  });
  graphTableCache.set(domain, tables);
  return tables;
}

/** 関係型の宣言された向き。GraphModel は無向辺を持たないため、無向問い合わせの結果をこれで向け直す。 */
export function graphRelations(domain: GraphDomain): GraphRelationInfo[] {
  const cached = graphRelationCache.get(domain);
  if (cached) return cached;
  const definition = domain === 'development' ? developmentDefinition : supplyDefinition;
  const entityTypeOf = new Map(definition.tables.map(table => [table.id, table.entityType]));
  const relations = definition.relations.map(relation => ({
    name: relation.name,
    sourceEntityType: entityTypeOf.get(relation.source) ?? relation.source,
    targetEntityType: entityTypeOf.get(relation.target) ?? relation.target,
  }));
  graphRelationCache.set(domain, relations);
  return relations;
}

export function developmentOntology(data: BlendDataset): OntologyModel {
  return createOntology(developmentDefinition, data);
}

export function blendGraphScope(scenario: BlendScenario, includeStock: boolean, data = materializeBlend(scenario)): GraphScope {
  const recipeId = scenario.custom ? `DRAFT-${scenario.productId}` : scenario.recipeId;
  const materialIds = scenarioComponents(scenario, data).map(row => row.materialId);
  const materials = data.materials.filter(row => materialIds.includes(row.id));
  return {
    products: [scenario.productId], recipes: [recipeId], recipeLines: data.recipeLines.filter(row => row.recipeId === recipeId).map(row => row.id),
    materials: materialIds, origins: [...new Set(materials.map(row => row.originId))],
    ...(includeStock ? { stocks: data.stocks.filter(row => materialIds.includes(row.materialId) && row.facilityId === scenario.facilityId).map(row => row.id),
      suppliers: [...new Set(materials.map(row => row.supplierId))] } : {}),
  };
}

export function supplyOntology(data: Dataset): OntologyModel {
  return createOntology(supplyDefinition, data);
}

export function ontologyElements(model: OntologyModel, scope: GraphScope | undefined, structure: boolean) {
  const nodes = model.tables.flatMap(sourceTable => {
    if (structure) return [{ data: { id: sourceTable.id, tableId: sourceTable.id, label: `${sourceTable.label}\n${sourceTable.entityType}`, recordId: '' } }];
    const rows = sourceTable.rows.filter(row => !scope || scope[sourceTable.id]?.includes(String(row[sourceTable.key])));
    if (scope?.[sourceTable.id]) rows.sort((first, second) => scope[sourceTable.id].indexOf(String(first[sourceTable.key])) - scope[sourceTable.id].indexOf(String(second[sourceTable.key])));
    return rows.map(row => ({ data: {
      id: `${sourceTable.id}:${row[sourceTable.key]}`, tableId: sourceTable.id, recordId: String(row[sourceTable.key]),
      label: `${sourceTable.label}\n${sourceTable.id === 'recipeLines' ? `${row.percent}%` : String(row[sourceTable.displayColumn])}${row.status === 'draft' ? '\n下書き' : ''}`,
    } }));
  });
  const nodeIds = new Set(nodes.map(node => node.data.id));
  const edges = model.relations.flatMap(link => {
    if (structure) return [{ data: { id: link.id, source: link.source, target: link.target, label: link.name } }];
    const mapping = model.tables.find(sourceTable => sourceTable.id === link.mappingTable);
    return (mapping?.rows ?? []).flatMap(row => {
      const sourceId = `${link.source}:${row[link.sourceColumn]}`;
      const targetId = `${link.target}:${row[link.targetColumn]}`;
      return nodeIds.has(sourceId) && nodeIds.has(targetId) ? [{ data: { id: `${link.id}:${row[mapping!.key]}`, source: sourceId, target: targetId, label: link.name } }] : [];
    });
  });
  return { nodes, edges };
}
