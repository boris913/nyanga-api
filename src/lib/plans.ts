import type { Plan } from '@prisma/client';
import type { Env } from '../env.js';

export const PLAN_LIMITS: Record<Plan, { photos: number; messagesPerDay: number; seeViewers: boolean }> = {
  STANDARD: { photos: 3, messagesPerDay: 10, seeViewers: false },
  PREMIUM: { photos: 10, messagesPerDay: Infinity, seeViewers: true },
  VIP: { photos: 15, messagesPerDay: Infinity, seeViewers: true },
};

export type Sku = 'PREMIUM' | 'VIP' | 'BUMP' | 'FEATURED_24H' | 'FEATURED_7D';

export type CatalogItem =
  | { sku: 'PREMIUM' | 'VIP'; kind: 'plan'; plan: Plan; label: string; priceXaf: number; period: string; productId: string }
  | { sku: 'BUMP' | 'FEATURED_24H' | 'FEATURED_7D'; kind: 'boost'; label: string; priceXaf: number; featuredHours: number; pinnedHours: number; productId: string };

// Les prix affichés doivent correspondre à ceux des produits Chariow.
export function buildCatalog(env: Env): CatalogItem[] {
  return [
    { sku: 'PREMIUM', kind: 'plan', plan: 'PREMIUM', label: 'Premium', priceXaf: 2500, period: '30 jours', productId: env.CHARIOW_PRODUCT_PREMIUM },
    { sku: 'VIP', kind: 'plan', plan: 'VIP', label: 'VIP', priceXaf: 7500, period: '30 jours', productId: env.CHARIOW_PRODUCT_VIP },
    { sku: 'BUMP', kind: 'boost', label: 'Remontée en tête de liste', priceXaf: 700, featuredHours: 0, pinnedHours: 24, productId: env.CHARIOW_PRODUCT_BUMP },
    { sku: 'FEATURED_24H', kind: 'boost', label: 'À la une 24 h', priceXaf: 1500, featuredHours: 24, pinnedHours: 0, productId: env.CHARIOW_PRODUCT_FEATURED_24H },
    { sku: 'FEATURED_7D', kind: 'boost', label: 'À la une 7 jours', priceXaf: 5000, featuredHours: 168, pinnedHours: 0, productId: env.CHARIOW_PRODUCT_FEATURED_7D },
  ];
}

// Table de vérité unique product_id Chariow → produit. Aucun plan déduit du nom.
export function catalogByProductId(catalog: CatalogItem[]): Record<string, CatalogItem> {
  return Object.fromEntries(catalog.filter((c) => c.productId).map((c) => [c.productId, c]));
}
