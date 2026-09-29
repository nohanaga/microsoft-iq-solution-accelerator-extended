import type { DataMode, Product } from '../types/shop';

export function mountShop(products?: Product[], dataMode?: DataMode, initialStore?: string): () => void;