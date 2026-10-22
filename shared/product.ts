import type { CampaignConfiguration } from './actions.js';

/** Parameter ranges are the existing campaign contract (Entrega 4A). */
export const PROMOTION_PARAMETERS = {
  percent: { label: 'Descuento', min: 0, max: 70, unit: '%' },
  duration: { label: 'Duración', min: 10, max: 300, unit: 's' },
  demandMultiplier: { label: 'Multiplicador de llegadas', min: 1, max: 4, unit: '×' },
  budget: { label: 'Presupuesto de la promoción', min: 1, max: 2000, unit: 'Q' },
} as const;
/** Effects implemented by the engine. Listed identically for every option; no ranking, score or forecast. */
export const PROMOTION_EFFECTS = [
  'Durante la duración, las llegadas de los clientes propios se multiplican por el multiplicador indicado. No se crean clientes nuevos.',
  'El descuento se aplica al precio de cada compra del público indicado. Cada unidad conserva el costo de mercadería de Q42.',
  'Costo de publicación: Q100 más el presupuesto, cobrado una vez al completar el despliegue.',
  'La demanda adicional usa la misma infraestructura, colas e inventario de la empresa.',
];
export type CatalogItem = { id: string; name: string; audience: 'all' | 'new'; parameters: typeof PROMOTION_PARAMETERS; effects: string[] };
/** Neutral catalog sorted by identifier. Only options with effects defined by the engine are offered. */
export const PRODUCT_CATALOG: CatalogItem[] = [
  { id: 'PROMO-01', name: 'Promoción para todos los clientes', audience: 'all', parameters: PROMOTION_PARAMETERS, effects: PROMOTION_EFFECTS },
  { id: 'PROMO-02', name: 'Promoción para clientes nuevos', audience: 'new', parameters: PROMOTION_PARAMETERS, effects: PROMOTION_EFFECTS },
];
export const PUBLICATION_BASE_COST = 100;
export type ProductDraft = { id: string; catalogId: string; configuration: CampaignConfiguration; author: string; at: number; status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'PUBLISHED' | 'DISCARDED'; changeId?: string };
export type ProductState = { drafts: ProductDraft[] };
export type FunnelBucket = { start: number; visits: number; checkout: number; purchased: number; abandoned: number; rejected: number; reasons: Record<string, number> };
export type FunnelState = { bucketSeconds: number; buckets: FunnelBucket[]; totals: Omit<FunnelBucket, 'start'> };
export type ProductView = {
  enabled: boolean; drafts: ProductDraft[];
  funnel: { windowSeconds: number; window: Omit<FunnelBucket, 'start'>; totals: Omit<FunnelBucket, 'start'>; buckets: FunnelBucket[] };
  satisfaction: { served: number; completed: number; sample: number; loyaltyMean: number | null; customers: number };
  campaigns: { id: string; status: string; percent: number; audience: string; duration: number; demandMultiplier: number; budget: number; activatedAt?: number; endsAt?: number; changeId?: string }[];
  published: { changeId: string; draftId?: string; catalogId?: string; version?: number }[];
};
