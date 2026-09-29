import { z } from 'zod';
import development from './development.json';
import supply from './supply.json';

const nameSchema = z.string().min(1);
const valueTypeSchema = z.enum(['String', 'BigInt', 'Double', 'Boolean', 'DateTime']);
const propertySchema = z.strictObject({
  name: nameSchema, sourceColumn: nameSchema, valueType: valueTypeSchema, nullable: z.boolean(),
  unit: nameSchema.optional(), description: nameSchema.optional(),
});
const tableSchema = z.strictObject({
  id: nameSchema, entityType: nameSchema, label: nameSchema, key: nameSchema,
  displayColumn: nameSchema, description: nameSchema, properties: z.array(propertySchema).min(1),
});
const relationSchema = z.strictObject({
  id: nameSchema, name: nameSchema, source: nameSchema, target: nameSchema,
  mappingTable: nameSchema, sourceColumn: nameSchema, targetColumn: nameSchema,
});
export const ontologyDefinitionSchema = z.strictObject({
  format: z.literal('micro-coffee-ontology-v1'), modelId: nameSchema, version: nameSchema,
  datasetId: nameSchema, dataFile: nameSchema, source: nameSchema, description: nameSchema,
  tables: z.array(tableSchema).min(1), relations: z.array(relationSchema),
});

export type PropertyValueType = z.infer<typeof valueTypeSchema>;
export type OntologyDefinition = z.infer<typeof ontologyDefinitionSchema>;
export type OntologyRelation = z.infer<typeof relationSchema>;
export type OntologyProperty = Pick<z.infer<typeof propertySchema>, 'name' | 'sourceColumn' | 'valueType'>;
export type EntityRecord = Record<string, string | number | boolean | null>;
export interface OntologyTable {
  id: string; entityType: string; label: string; source: string; key: string;
  displayColumn: string; properties: OntologyProperty[]; rows: EntityRecord[];
}
export interface OntologyModel { datasetId: string; tables: OntologyTable[]; relations: OntologyRelation[] }
export interface OntologyDataIssue { table: string; row: number; column: string; message: string }

function requireUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

export function parseOntologyDefinition(input: unknown): OntologyDefinition {
  const definition = ontologyDefinitionSchema.parse(input);
  requireUnique(definition.tables.map(table => table.id), 'table id');
  requireUnique(definition.tables.map(table => table.entityType), 'entity type');
  requireUnique(definition.tables.flatMap(table => table.properties.map(property => property.name)), 'property name');
  requireUnique(definition.relations.map(relation => relation.id), 'relationship id');
  for (const table of definition.tables) {
    requireUnique(table.properties.map(property => property.sourceColumn), `${table.id} column`);
    const key = table.properties.find(property => property.sourceColumn === table.key);
    if (!key || key.nullable || !['String', 'BigInt'].includes(key.valueType)) throw new Error(`Invalid key: ${table.id}.${table.key}`);
    if (!table.properties.some(property => property.sourceColumn === table.displayColumn)) throw new Error(`Missing display column: ${table.id}`);
  }
  for (const relation of definition.relations) {
    const source = definition.tables.find(table => table.id === relation.source);
    const target = definition.tables.find(table => table.id === relation.target);
    const mapping = definition.tables.find(table => table.id === relation.mappingTable);
    const sourceColumn = mapping?.properties.find(property => property.sourceColumn === relation.sourceColumn);
    const targetColumn = mapping?.properties.find(property => property.sourceColumn === relation.targetColumn);
    if (!source || !target || !sourceColumn || !targetColumn
      || sourceColumn.valueType !== source.properties.find(property => property.sourceColumn === source.key)?.valueType
      || targetColumn.valueType !== target.properties.find(property => property.sourceColumn === target.key)?.valueType) {
      throw new Error(`Invalid relationship mapping: ${relation.id}`);
    }
  }
  return definition;
}

export const developmentDefinition = parseOntologyDefinition(development);
export const supplyDefinition = parseOntologyDefinition(supply);

export function createOntology(definition: OntologyDefinition, data: { datasetId: string }): OntologyModel {
  if (data.datasetId !== definition.datasetId) throw new Error(`Dataset mismatch: ${definition.modelId}`);
  const source = data as unknown as Record<string, unknown>;
  return { datasetId: data.datasetId, tables: definition.tables.map(table => {
    const rows = source[table.id];
    if (!Array.isArray(rows)) throw new Error(`Missing table: ${table.id}`);
    return { id: table.id, entityType: table.entityType, label: table.label, source: definition.source,
      key: table.key, displayColumn: table.displayColumn, rows: rows.map(row => ({ ...row }) as EntityRecord),
      properties: table.properties.map(({ name, sourceColumn, valueType }) => ({ name, sourceColumn, valueType })) };
  }), relations: definition.relations.map(relation => ({ ...relation })) };
}

const cellSchemas = {
  String: z.string(), BigInt: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  Double: z.number().finite(), Boolean: z.boolean(), DateTime: z.iso.datetime({ offset: true }),
};

export function validateOntologyData(definition: OntologyDefinition, input: unknown): OntologyDataIssue[] {
  const issues: OntologyDataIssue[] = [];
  const parsed = z.record(z.string(), z.unknown()).safeParse(input);
  if (!parsed.success || parsed.data.datasetId !== definition.datasetId) {
    return [{ table: '', row: -1, column: 'datasetId', message: 'Dataset mismatch or invalid object' }];
  }
  const data = parsed.data;
  const tables = new Map<string, Record<string, unknown>[]>();
  const keys = new Map<string, Set<unknown>>();
  for (const table of definition.tables) {
    const records = z.array(z.record(z.string(), z.unknown())).safeParse(data[table.id]);
    if (!records.success) {
      issues.push({ table: table.id, row: -1, column: '', message: 'Missing table or invalid rows' });
      continue;
    }
    const tableKeys = new Set<unknown>();
    tables.set(table.id, records.data);
    keys.set(table.id, tableKeys);
    records.data.forEach((record, index) => {
      for (const property of table.properties) {
        const schema = cellSchemas[property.valueType];
        if (!(property.nullable ? schema.nullable() : schema).safeParse(record[property.sourceColumn]).success) {
          issues.push({ table: table.id, row: index, column: property.sourceColumn, message: `Expected ${property.valueType}${property.nullable ? ' or null' : ''}` });
        }
      }
      const key = record[table.key];
      if (key === undefined || key === null || key === '' || tableKeys.has(key)) {
        issues.push({ table: table.id, row: index, column: table.key, message: 'Empty or duplicate key' });
      }
      tableKeys.add(key);
    });
  }
  for (const relation of definition.relations) {
    (tables.get(relation.mappingTable) ?? []).forEach((record, index) => {
      for (const [column, target] of [[relation.sourceColumn, relation.source], [relation.targetColumn, relation.target]]) {
        if (record[column] === null) continue;
        if (!keys.get(target)?.has(record[column])) issues.push({ table: relation.mappingTable, row: index, column, message: `Unresolved reference: ${target}` });
      }
    });
  }
  return issues;
}