import { mkdir, writeFile } from 'node:fs/promises';
import { PRODUCTS } from '../src/data/products.ts';
import operations from '../../../scenarios/micro-coffee/data/operations.json';

const root = new URL('../', import.meta.url);
const storeOrder = ['STR-04', 'STR-02', 'STR-01', 'STR-03', 'STR-05', 'STR-06'];
if (new Set(PRODUCTS.map(product => product.id)).size !== PRODUCTS.length) throw new Error('Duplicate EC product IDs');
for (const analytical of operations.products) {
  const product = PRODUCTS.find(row => row.id === analytical.id);
  if (!product || product.name !== analytical.name || product.net !== analytical.priceExTax
    || Number((product.tax * 100).toFixed(2)) !== analytical.taxPercent) {
    throw new Error(`EC/Rayfin product mismatch: ${analytical.id}. Resolve the source data before generating.`);
  }
}
const catalogue = {
  datasetId: 'maikuro-ec-v1', version: '2026-09-11.1', dataOrigin: 'synthetic',
  referenceDatasetId: operations.datasetId, referenceVersion: operations.version,
  referenceAsOf: operations.asOf,
  products: PRODUCTS,
  stores: storeOrder.map(id => {
    const store = operations.stores.find(row => row.id === id);
    if (!store) throw new Error(`Missing store ${id}`);
    return store;
  }),
  suppliers: operations.suppliers,
  productLinks: PRODUCTS.map(product => {
    const match = operations.products.find(row => row.id === product.id);
    return { productId: product.id, analyticalProductId: match?.id ?? null,
      supplierId: match?.supplierId ?? null, status: match ? 'matched' : 'ec-only' };
  }),
};

const literal = (value: string | number | boolean | null): string => {
  if (value === null) return 'NULL';
  if (typeof value !== 'string') return String(value);
  if (value.includes('\0')) throw new Error('PostgreSQL text cannot contain NUL');
  return `'${value.replaceAll("'", "''")}'`;
};
const insert = (table: string, columns: string[], rows: (string | number | boolean | null)[][]) =>
  `INSERT INTO maikuro.${table} (${columns.join(', ')}) VALUES\n${rows.map(row => `(${row.map(literal).join(', ')})`).join(',\n')};\n`;
const statements = [
  'BEGIN;',
  'SET LOCAL standard_conforming_strings = on;',
  'LOCK TABLE maikuro.suppliers, maikuro.stores, maikuro.products IN SHARE ROW EXCLUSIVE MODE;',
  "DO $$ BEGIN IF EXISTS (SELECT 1 FROM maikuro.products) OR EXISTS (SELECT 1 FROM maikuro.stores) OR EXISTS (SELECT 1 FROM maikuro.suppliers) THEN RAISE EXCEPTION 'Seed requires empty maikuro master tables'; END IF; END $$;",
  insert('suppliers', ['supplier_id', 'name', 'city'], catalogue.suppliers.map(row => [row.id, row.name, row.city])),
  insert('stores', ['store_id', 'name', 'city', 'cold_equipment', 'cups_per_day'], catalogue.stores.map(row => [row.id, row.name, row.city, row.coldEquipment, row.cupsPerDay])),
  insert('products', ['product_id', 'name', 'category', 'price_ex_tax', 'tax_percent', 'volume', 'supplier_id', 'display_order', 'attributes', 'data_origin'],
    catalogue.products.map((product, index) => {
      const { id, name, category, net, tax, volume, ...attributes } = product;
      return [id, name, category, net, Number((tax * 100).toFixed(2)), volume,
        catalogue.productLinks[index].supplierId, index, JSON.stringify(attributes), 'synthetic'];
    })),
  'COMMIT;',
];

await mkdir(new URL('data/', root), { recursive: true });
await mkdir(new URL('postgres/', root), { recursive: true });
await writeFile(new URL('data/catalogue.json', root), JSON.stringify(catalogue, null, 2) + '\n', 'utf8');
await writeFile(new URL('postgres/002-seed.sql', root), statements.join('\n') + '\n', 'utf8');
console.log('Generated catalogue.json and 002-seed.sql; no database connection or write.');