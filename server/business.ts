import type { Company, GameState, Identity, Result } from '../shared/types.js';
import type { CampaignConfiguration } from '../shared/actions.js';
import { validateParameters } from './action-validation.js';

export function businessCommand(g: GameState, c: Company, actor: Identity, type: string, p: Record<string, unknown>): Result {
  validateParameters(type, p);
  if (type === 'product.propose') {
    if (c.runtime.proposals.length >= 40) throw new Error('Límite de propuestas alcanzado.');
    const id = `C${c.id}-P${c.runtime.proposals.length + 1}`;
    c.runtime.proposals.push({ id, name: String(p.name), description: String(p.description), at: g.tick }); return { ok: true, refs: [id] };
  }
  if (type === 'campaign.prepare') {
    if (c.runtime.campaigns.length >= 40) throw new Error('Límite de campañas alcanzado.');
    const id = `C${c.id}-CAM${c.runtime.campaigns.length + 1}`;
    c.runtime.campaigns.push({ id, configuration: structuredClone(p) as CampaignConfiguration, status: 'PROPOSED', createdBy: actor.id, createdAt: g.tick, reserved: 0 }); return { ok: true, refs: [id] };
  }
  const campaign = c.runtime.campaigns.find(cam => cam.id === p.campaignId);
  if (!campaign) throw new Error('Campaña no encontrada.');
  if (type === 'campaign.authorize') {
    if (campaign.status !== 'PROPOSED') throw new Error('Estado de campaña inválido.');
    const amount = campaign.configuration.budget;
    if (c.capital - c.infraBudget - c.reserved < amount) throw new Error('Saldo disponible insuficiente.');
    campaign.reserved = amount; c.reserved += amount; campaign.status = 'AUTHORIZED'; campaign.expires = g.tick + 120; campaign.authorizedBy = actor.id;
  } else if (type === 'campaign.reject') {
    if (campaign.status !== 'PROPOSED') throw new Error('Estado de campaña inválido.'); campaign.status = 'REJECTED';
  } else if (type === 'campaign.activate') {
    if (campaign.status !== 'AUTHORIZED' || g.tick > campaign.expires!) throw new Error('Falta autorización vigente de CTO.');
    if (c.runtime.campaigns.some(cam => cam.status === 'ACTIVE')) throw new Error('Ya existe una campaña activa.');
    if (c.capital < c.infraBudget + c.reserved) throw new Error('Reserva financiera sin fondos.');
    c.capital -= campaign.reserved; c.reserved -= campaign.reserved; campaign.reserved = 0;
    campaign.status = 'ACTIVE'; campaign.activatedAt = g.tick; campaign.endsAt = g.tick + campaign.configuration.duration;
  }
  return { ok: true, refs: [campaign.id] };
}
export function advanceCampaigns(c: Company, now: number) {
  for (const cam of c.runtime.campaigns) {
    if (cam.status === 'ACTIVE' && (now >= cam.endsAt! || c.eliminated)) cam.status = 'COMPLETED';
    if (cam.status === 'AUTHORIZED' && (now > cam.expires! || c.eliminated || c.capital < c.infraBudget + c.reserved)) { c.reserved = Math.max(0, c.reserved - cam.reserved); cam.reserved = 0; cam.status = 'EXPIRED'; }
  }
}
export function activeCampaign(c: Company, now: number) { return c.runtime.campaigns.find(cam => cam.status === 'ACTIVE' && now < cam.endsAt!); }
