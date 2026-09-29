import { z } from 'zod';
import catalogue from '../../data/catalogue.json';
import type { Product, ShopCatalogue } from '../types/shop';

const categorySchema = z.enum(['beans', 'cold', 'coffee', 'tea', 'other']);
const text = z.string().max(8000).refine(value => !/[<>"&]/.test(value));
const identifier = z.string().regex(/^[A-Za-z0-9_-]+$/).max(100);
const cssClass = z.string().regex(/^[a-z0-9-]*$/).max(80);
const rating = z.number().int().min(0).max(5);
const productSchema = z.object({
  id: identifier, name: text.min(1), english: text, category: categorySchema,
  net: z.number().int().min(0).max(100000000), tax: z.number().min(0).max(1),
  volume: text, sweet: rating.nullable(), bitter: rating.nullable(), aroma: rating.nullable(),
  note: text, description: text, ingredients: text, badge: text,
  image: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]),
  packLabel: text.optional(), packTone: cssClass.optional(), origin: text.optional(),
  roast: text.optional(), process: text.optional(), acidity: rating.optional(),
  body: rating.optional(), brew: text.default(''), vessel: cssClass.optional(), tone: cssClass.optional(),
});
const catalogueSchema = z.object({
  products: z.array(productSchema).min(1).max(1000),
  stores: z.array(z.object({
    id: identifier, name: text.min(1), city: text,
    coldEquipment: z.boolean().nullable(), cupsPerDay: z.number().int().nonnegative().nullable(),
  })).min(1).max(1000),
}).refine(value =>
  new Set(value.products.map(product => product.id)).size === value.products.length &&
  new Set(value.stores.map(store => store.id)).size === value.stores.length &&
  new Set(value.stores.map(store => store.name)).size === value.stores.length,
);

export const SAMPLE_CATALOGUE: ShopCatalogue = catalogueSchema.parse(catalogue);
export const PRODUCTS: Product[] = SAMPLE_CATALOGUE.products;
export const STORES = SAMPLE_CATALOGUE.stores;

export async function fetchPostgresCatalogue(signal: AbortSignal): Promise<ShopCatalogue> {
  const response = await fetch('/api/catalogue', { signal, cache: 'no-store' });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const failure = z.object({ detail: z.string().max(300) }).safeParse(body);
    throw new Error(failure.success ? failure.data.detail : 'PostgreSQL の読み込みに失敗しました。');
  }
  const result = catalogueSchema.safeExtend({ source: z.literal('postgres') }).safeParse(await response.json());
  if (!result.success) throw new Error('PostgreSQL の商品・店舗データを確認してください。');
  return result.data;
}