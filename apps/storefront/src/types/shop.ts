export type DataMode = 'sample' | 'postgres';

export interface Store {
  id: string;
  name: string;
  city: string;
  coldEquipment: boolean | null;
  cupsPerDay: number | null;
}

export interface ShopCatalogue {
  products: Product[];
  stores: Store[];
}

export interface Product {
  id: string;
  name: string;
  english: string;
  category: 'beans' | 'cold' | 'coffee' | 'tea' | 'other';
  net: number;
  tax: number;
  volume: string;
  sweet: number | null;
  bitter: number | null;
  aroma: number | null;
  note: string;
  description: string;
  ingredients: string;
  badge: string;
  image: string;
  packLabel?: string;
  packTone?: string;
  origin?: string;
  roast?: string;
  process?: string;
  acidity?: number;
  body?: number;
  brew?: string;
  vessel?: string;
  tone?: string;
}