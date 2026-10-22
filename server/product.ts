import type { Change, Company, GameState, Identity, Result, TrafficRequest } from '../shared/types.js';
import type { CampaignConfiguration } from '../shared/actions.js';
import { PRODUCT_CATALOG, PUBLICATION_BASE_COST, type FunnelBucket, type FunnelState, type ProductState, type ProductView } from '../shared/product.js';
import { releaseFor } from './artifacts.js';

export const productEnabled = (g: GameState) => g.productEnabled === true;
export const productState = (c: Company): ProductState => c.runtime.product ??= { drafts: [] };
const empty = (): Omit<FunnelBucket, 'start'> => ({ visits: 0, checkout: 0, purchased: 0, abandoned: 0, rejected: 0, reasons: {} });
const BUCKET_SECONDS = 10, BUCKETS = 30;

/** Funnel observed from settled legitimate traffic only; QA staging traffic never counts. */
export function recordFunnel(company: Company, request: TrafficRequest, now: number) {
  if (company.traffic.scope === 'qa' || request.trafficClass !== 'legitimate' || !request.result) return;
  const funnel: FunnelState = company.traffic.funnel ??= { bucketSeconds: BUCKET_SECONDS, buckets: [], totals: empty() };
  const start = Math.floor(now / BUCKET_SECONDS) * BUCKET_SECONDS;
  let bucket = funnel.buckets.at(-1);
  if (!bucket || bucket.start !== start) { bucket = { start, ...empty() }; funnel.buckets.push(bucket); if (funnel.buckets.length > BUCKETS) funnel.buckets.shift(); }
  const status = request.result.status, reason = request.result.reason;
  for (const target of [bucket, funnel.totals]) {
    target.visits++;
    if (request.type === 'purchase' && request.waits.some(w => w.service === 'checkout')) target.checkout++;
    if (request.type === 'purchase' && status === 'COMPLETED') target.purchased++;
    if (status === 'ABANDONED') target.abandoned++;
    if (status === 'REJECTED' || status === 'FAILED') target.rejected++;
    if (status !== 'COMPLETED') target.reasons[reason] = (target.reasons[reason] ?? 0) + 1;
  }
}
function parseConfiguration(item: typeof PRODUCT_CATALOG[number], p: Record<string, unknown>): CampaignConfiguration {
  return { percent: Number(p.percent), audience: item.audience, duration: Number(p.duration), budget: Number(p.budget), demandMultiplier: Number(p.demandMultiplier) };
}
type Event = (g: GameState, companyId: number, text: string, tone?: 'good' | 'bad' | 'neutral', category?: string) => void;
export function productCommand(g: GameState, c: Company, actor: Identity, type: string, p: Record<string, unknown>, event: Event): Result | undefined {
  if (type !== 'product.draft' && type !== 'product.submit') return;
  const state = productState(c);
  if (type === 'product.draft') {
    const item = PRODUCT_CATALOG.find(i => i.id === p.catalogId); if (!item) throw new Error('Opción no disponible en el catálogo.');
    if (state.drafts.length >= 60) throw new Error('Límite de borradores alcanzado.');
    const draft = { id: `PRD-${String(state.drafts.length + 1).padStart(3, '0')}`, catalogId: item.id, configuration: parseConfiguration(item, p), author: actor.id, at: g.tick, status: 'DRAFT' as const };
    state.drafts.push(draft); return { ok: true, refs: [draft.id] };
  }
  const draft = state.drafts.find(d => d.id === p.draftId);
  if (!draft || draft.status !== 'DRAFT') throw new Error('Borrador no disponible.');
  if (g.changes.filter(ch => ch.companyId === c.id && ch.domain === 'product' && ['QA_PENDING', 'QA_RUNNING', 'CTO_PENDING', 'AUTHORIZED', 'DEPLOYING'].includes(ch.status)).length >= 6) throw new Error('Límite de propuestas de Producto en curso.');
  const item = PRODUCT_CATALOG.find(i => i.id === draft.catalogId)!;
  // Sending to QA freezes the artifact: the change keeps its own copy of the configuration.
  const change: Change = { id: `CH-${String(g.changes.length + 1).padStart(3, '0')}`, companyId: c.id, domain: 'product', name: `${item.name} · ${draft.id}`, graph: structuredClone(c.product), status: 'QA_PENDING', cost: PUBLICATION_BASE_COST + draft.configuration.budget, reserved: 0, baseVersion: c.version, created: g.tick, reports: [], actorId: actor.id,
    context: { backend: structuredClone(c.backend), security: structuredClone(c.security), executionVersion: c.version, execution: releaseFor(c) }, product: { draftId: draft.id, catalogId: item.id, configuration: structuredClone(draft.configuration) } };
  g.changes.unshift(change); draft.status = 'SUBMITTED'; draft.changeId = change.id;
  event(g, c.id, `${change.id} (${draft.id}) enviado a QA.`, 'neutral', 'PRODUCTO');
  return { ok: true, refs: [change.id, draft.id] };
}
/** A published product change starts its promotion; the cost was charged by the deployment. */
export function activateProduct(g: GameState, c: Company, ch: Change, event: Event) {
  if (!ch.product) return;
  const configuration = ch.product.configuration, id = `C${c.id}-CAM${c.runtime.campaigns.length + 1}`;
  c.runtime.campaigns.push({ id, configuration: structuredClone(configuration), status: 'ACTIVE', createdBy: ch.actorId, createdAt: ch.created, reserved: 0, activatedAt: g.tick, endsAt: g.tick + configuration.duration, authorizedBy: 'pipeline', changeId: ch.id });
  const draft = productState(c).drafts.find(d => d.id === ch.product!.draftId); if (draft) draft.status = 'PUBLISHED';
  event(g, c.id, `${ch.product.catalogId} activa · ${configuration.duration} s.`, 'neutral', 'PRODUCTO');
}
export function returnProduct(c: Company, ch: Change) { const draft = ch.product && productState(c).drafts.find(d => d.id === ch.product!.draftId); if (draft) draft.status = 'RETURNED'; }
export function productView(g: GameState, c: Company, now: number): ProductView {
  const funnel = c.traffic.funnel ?? { bucketSeconds: BUCKET_SECONDS, buckets: [], totals: empty() };
  const windowStart = Math.floor(now / BUCKET_SECONDS) * BUCKET_SECONDS - 5 * BUCKET_SECONDS, window = empty();
  for (const b of funnel.buckets) if (b.start >= windowStart) { for (const key of ['visits', 'checkout', 'purchased', 'abandoned', 'rejected'] as const) window[key] += b[key]; for (const [r, n] of Object.entries(b.reasons)) window.reasons[r] = (window.reasons[r] ?? 0) + n; }
  let loyalty = 0, customers = 0;
  for (const customer of Object.values(g.market.customers)) if (customer.currentCompanyId === c.id) { loyalty += customer.loyalty; customers++; }
  return {
    enabled: productEnabled(g), drafts: structuredClone(productState(c).drafts),
    funnel: { windowSeconds: 6 * BUCKET_SECONDS, window, totals: structuredClone(funnel.totals), buckets: structuredClone(funnel.buckets.slice(-12)) },
    satisfaction: { served: window.visits, completed: window.visits - window.abandoned - window.rejected, sample: window.visits, loyaltyMean: customers ? Math.round(loyalty / customers * 1000) / 1000 : null, customers },
    campaigns: c.runtime.campaigns.slice(-12).map(cam => ({ id: cam.id, status: cam.status, ...cam.configuration, activatedAt: cam.activatedAt, endsAt: cam.endsAt, changeId: cam.changeId })),
    published: g.changes.filter(ch => ch.companyId === c.id && ch.domain === 'product' && ch.status === 'DEPLOYED').map(ch => ({ changeId: ch.id, draftId: ch.product?.draftId, catalogId: ch.product?.catalogId, version: ch.releasedVersion })),
  };
}
