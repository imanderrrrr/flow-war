import { observe } from './observability.js';
import type { Company, GameState, MarketConfig, MarketCustomer, MarketState, PurchaseRequest, TrafficRequest } from '../shared/types.js';
import { isPlanReason } from '../shared/plan.js';

export const MARKET_CONFIG: MarketConfig = {
  version: 'market-3.0', population: 5000, hazardPerSecond: .002, cooldownSeconds: 90, reentryPerSecond: .003,
  successGain: { browse: .08, query: .08, purchase: .12 }, failureLoss: { browse: .08, query: .10, purchase: .18 },
  severeLoss: .28, slowLoss: .04, satisfactoryLatencyMs: { browse: 1000, query: 2000, purchase: 3000 }, minimumAttractiveness: .18,
};
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const poolKey = (owner: number | null) => owner === null ? 'unserved' : String(owner);
/** Stateless counter PRNG. A cohort has the same stream in each origin's rotated frame. */
export function marketRandom(seed: number, cohort: number, epoch: number, salt = 0) {
  let value = (seed ^ Math.imul(cohort + 1, 0x9e3779b1) ^ Math.imul(epoch + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d); value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

export function createMarket(companies: Company[], generation: number, tick = 0, imported = false, unserved = 0): MarketState {
  const counts = companies.map(company => company.customers);
  if (counts.some(count => !Number.isInteger(count) || count < 0) || !Number.isInteger(unserved) || unserved < 0 || counts.reduce((a, b) => a + b, unserved) !== 5000) throw new Error('Población histórica inválida: se requieren 5000 clientes contabilizados.');
  const market: MarketState = { config: structuredClone(MARKET_CONFIG), customers: {}, members: { unserved: [] }, selection: {}, pendingIds: [], sequence: 0, lastDecisionTick: Math.floor(tick), totals: { migrations: 0, exits: 0, returns: 0, experiences: 0 }, ...(imported ? { importedAt: tick } : {}) };
  let ordinal = 0;
  for (const owner of [...companies, null]) {
    const companyId = owner?.id ?? null, key = poolKey(companyId), count = owner?.customers ?? unserved;
    const members: string[] = market.members[key] = [];
    if (companyId !== null) market.selection[companyId] = 0;
    for (let index = 0; index < count; index++) {
      const id = `g${generation}-U${String(ordinal++).padStart(4, '0')}`, color = owner?.color ?? '#9aa8bb';
      market.customers[id] = { id, cohort: index, originCompanyId: imported ? null : companyId, currentCompanyId: companyId, imported,
        loyalty: imported ? 0 : 1, visualColor: color, transitionFromColor: color, successfulVisits: 0, failedVisits: 0, abandonedRequests: 0,
        dissatisfaction: 0, consecutiveFailures: 0, activeRequests: 0, history: [], experiences: {} };
      members.push(id);
    }
  }
  return market;
}

type Binding = { market: MarketState; slots: Map<string, number> };
const bindings = new WeakMap<Company, Binding>();
const gameBindings = new WeakMap<GameState, Binding>();
/** Runtime references/index positions are never serialized. Pools/order/cursors are serialized. */
export function bindMarket(game: GameState) {
  let binding = gameBindings.get(game);
  if (binding?.market === game.market && game.companies.every(company => bindings.get(company) === binding)) return binding;
  binding = { market: game.market, slots: new Map() };
  for (const members of Object.values(game.market.members)) members.forEach((id, index) => binding!.slots.set(id, index));
  gameBindings.set(game, binding);
  for (const company of game.companies) bindings.set(company, binding);
  return binding;
}

export function selectCustomer(company: Company): MarketCustomer | undefined {
  const binding = bindings.get(company);
  if (!binding) throw new Error('Empresa sin población vinculada.');
  const market = binding.market, members = market.members[company.id];
  if (company.eliminated || !members.length) return undefined;
  // A pending departure cannot acquire fresh work and starve its deferred transfer.
  for (let index = 0; index < members.length; index++) {
    const cursor = market.selection[company.id]++;
    const customer = market.customers[members[cursor % members.length]];
    if (!customer.pendingMigration) return customer;
  }
  return undefined;
}
export function attachCustomer(company: Company, request: PurchaseRequest, customer: MarketCustomer) {
  if (bindings.get(company)?.market.customers[customer.id] !== customer) throw new Error('Cliente persistente desconocido.');
  if (company.eliminated || customer.currentCompanyId !== company.id || customer.pendingMigration) throw new Error('Admisión para un propietario inválido.');
  request.customerId = customer.id; request.customerSource = 'market'; request.customerColor = customer.visualColor; customer.activeRequests++;
}
export function customerColor(company: Company, request: PurchaseRequest) {
  if (request.customerSource !== 'market') return request.customerColor ?? company.color;
  return bindings.get(company)?.market.customers[request.customerId ?? '']?.visualColor ?? request.customerColor ?? company.color;
}

/** Linear-light sRGB interpolation, quantized once on the server after an experience. */
export function blendCustomerColor(from: string, to: string, loyalty: number) {
  if (loyalty <= 0) return from; if (loyalty >= 1) return to;
  const decode = (n: number) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
  const encode = (n: number) => n <= .0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - .055;
  return '#' + [1, 3, 5].map(index => {
    const a = decode(parseInt(from.slice(index, index + 2), 16) / 255), b = decode(parseInt(to.slice(index, index + 2), 16) / 255);
    return Math.round(clamp(encode(a + (b - a) * loyalty)) * 255).toString(16).padStart(2, '0');
  }).join('');
}

/** Called exactly once under the request's existing accounting guard. No money effects. */
export function recordCustomerExperience(company: Company, request: PurchaseRequest, type: TrafficRequest['type'], latencyMs: number) {
  if (request.customerSource !== 'market') return;
  const binding = bindings.get(company);
  if (!binding) return; // A detached, isolated copy cannot modify production.
  const customer = binding.market.customers[request.customerId!], config = binding.market.config, result = request.result!;
  if (!customer || customer.currentCompanyId !== company.id || customer.activeRequests <= 0) throw new Error('Experiencia de cliente inconsistente.');
  customer.activeRequests--;
  // A company still in montaje is not answerable for a service nobody asked it to build yet: the
  // lost sale and the complaint stand, the customer's loyalty, patience and allegiance do not move.
  if (company.assembly?.active && isPlanReason(result.reason)) return;
  // Administrative finish/cancellation is observed as no service, never as a fabricated visit.
  if (result.reason === 'ROOM_FINISHED' || result.reason === 'ROOM_INTERRUPTED' || result.reason === 'COMPANY_ELIMINATED') return;
  const experience = customer.experiences[company.id] ??= { successes: 0, failures: 0 };
  const success = result.status === 'COMPLETED' && request.oversold === 0;
  if (success) { customer.successfulVisits++; customer.lastSuccessfulVisitTick = result.at; experience.successes++; }
  else { customer.failedVisits++; customer.lastFailedVisitTick = result.at; experience.failures++; }
  if (result.status === 'ABANDONED') customer.abandonedRequests++;
  if (success && latencyMs <= config.satisfactoryLatencyMs[type]) {
    customer.loyalty = round(clamp(customer.loyalty + config.successGain[type]));
    customer.dissatisfaction = Math.max(0, customer.dissatisfaction - 2); customer.consecutiveFailures = 0;
  } else {
    const severe = request.oversold > 0 || (request.committed > 0 && !request.paid);
    const loss = severe ? config.severeLoss : success ? config.slowLoss : config.failureLoss[type];
    customer.loyalty = round(clamp(customer.loyalty - loss));
    customer.dissatisfaction = Math.min(20, customer.dissatisfaction + (severe ? 8 : success ? 1 : type === 'purchase' ? 4 : 2));
    customer.consecutiveFailures++;
  }
  customer.visualColor = blendCustomerColor(customer.transitionFromColor, company.color, customer.loyalty);
  binding.market.totals.experiences++;
}

export function migrationProbability(pressure: number, customer: MarketCustomer, config = MARKET_CONFIG, dt = 1) {
  const vulnerability = .35 + .65 * (1 - customer.loyalty) + customer.dissatisfaction / 10 + Math.min(5, customer.consecutiveFailures) * .1;
  const hazard = config.hazardPerSecond * Math.max(0, pressure) / 100 * vulnerability;
  return -Math.expm1(-hazard * Math.max(0, dt));
}
export function attractiveness(company: Company) {
  if (company.eliminated) return 0;
  const observed = company.traffic.metrics;
  const available = company.infraBudget > 0 && company.capital > 0 && company.servers > 0 ? 1 - observed.unavailable : 0;
  return (.08 + .55 * company.reputation / 100 + .2 * available + .17 * (1 - observed.errorRate)) / (1 + .35 * Math.max(0, company.utilization - .8));
}
function chooseDestination(game: GameState, customer: MarketCustomer, scores: Map<number, number>, epoch: number) {
  const owner = customer.currentCompanyId, current = owner === null || game.companies[owner].eliminated ? 0 : scores.get(owner)!;
  const reference = customer.originCompanyId ?? owner ?? 0;
  // Cyclic ordering and shared cohorts make ties equivariant to company index rotation.
  const candidates = game.companies.filter(company => !company.eliminated && company.id !== owner).map(company => {
    const relative = (company.id - reference + 5) % 5;
    const preference = (marketRandom(game.seed, customer.cohort, relative, 41) - .5) * .16;
    const memory = customer.experiences[company.id];
    const experience = memory ? .08 * (memory.successes - memory.failures) / (memory.successes + memory.failures + 1) : 0;
    const recent = customer.previousCompanyId === company.id && game.tick - (customer.lastMigrationTick ?? 0) < 240 ? .12 : 0;
    const score = Math.max(0, scores.get(company.id)! + preference + experience - recent);
    const weight = score < game.market.config.minimumAttractiveness ? 0 : score * Math.max(0, score - current + .12);
    return { id: company.id as number | null, weight, relative };
  }).sort((a, b) => a.relative - b.relative);
  // Outside option has real weight; there is no receiver-capacity quota.
  candidates.push({ id: null, weight: owner === null ? 0 : .03 + Math.max(0, .65 - current) * .8, relative: 5 });
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (!total) return null;
  let draw = marketRandom(game.seed, customer.cohort, epoch, 17) * total;
  for (const candidate of candidates) { draw -= candidate.weight; if (draw < 0) return candidate.id; }
  return null;
}

export function requestMigration(game: GameState, customerId: string, targetCompanyId: number | null, reason: string) {
  bindMarket(game);
  const customer = game.market.customers[customerId];
  if (!customer || customer.pendingMigration || targetCompanyId === customer.currentCompanyId) return false;
  const eliminatedOwner = customer.currentCompanyId !== null && game.companies[customer.currentCompanyId].eliminated;
  if (!eliminatedOwner && game.tick - (customer.lastMigrationTick ?? -Infinity) < game.market.config.cooldownSeconds) return false;
  if (targetCompanyId !== null && (!game.companies[targetCompanyId] || game.companies[targetCompanyId].eliminated)) return false;
  customer.pendingMigration = { targetCompanyId, reason, requestedAt: game.tick }; game.market.pendingIds.push(customer.id);
  return true;
}
export function flushMigrations(game: GameState) {
  const { slots } = bindMarket(game), market = game.market;
  type Transfer = { customer: MarketCustomer; from: number | null; to: number | null; reason: string };
  const ready: Transfer[] = [];
  market.pendingIds = market.pendingIds.filter(id => {
    const customer = market.customers[id], pending = customer.pendingMigration;
    if (!pending) return false;
    if (customer.activeRequests) return true;
    const from = customer.currentCompanyId;
    const to = pending.targetCompanyId !== null && game.companies[pending.targetCompanyId].eliminated ? null : pending.targetCompanyId;
    delete customer.pendingMigration;
    if (from !== to) ready.push({ customer, from, to, reason: pending.reason });
    return false;
  });
  if (!ready.length) return;
  // Source removals and destination insertions use each pool's cyclic frame.
  // A global birth-ID order would change future round-robin visits by company ID.
  const order = (owner: number | null) => (a: Transfer, b: Transfer) => {
    const relativeOrigin = (customer: MarketCustomer) => ((customer.originCompanyId ?? owner ?? 0) - (owner ?? 0) + 5) % 5;
    return a.customer.cohort - b.customer.cohort || relativeOrigin(a.customer) - relativeOrigin(b.customer) || a.customer.id.localeCompare(b.customer.id);
  };
  for (const owner of [...game.companies.map(company => company.id), null]) {
    const pool = market.members[poolKey(owner)];
    for (const { customer } of ready.filter(item => item.from === owner).sort(order(owner))) {
      const position = slots.get(customer.id)!, last = pool.pop()!;
      if (position < pool.length) { pool[position] = last; slots.set(last, position); }
      slots.delete(customer.id);
    }
  }
  for (const owner of [...game.companies.map(company => company.id), null]) {
    const pool = market.members[poolKey(owner)];
    for (const { customer } of ready.filter(item => item.to === owner).sort(order(owner))) { slots.set(customer.id, pool.length); pool.push(customer.id); }
  }
  for (const { customer, from, to, reason } of ready) {
    customer.previousCompanyId = from; customer.currentCompanyId = to; customer.lastMigrationTick = game.tick;
    customer.transitionFromColor = customer.visualColor; customer.loyalty = 0; customer.consecutiveFailures = 0;
    customer.dissatisfaction = round(customer.dissatisfaction * .5);
    const migration = { id: `g${game.generation}-M${++market.sequence}`, from, to, at: game.tick, reason, color: customer.visualColor };
    customer.history.push(migration);
    market.totals.migrations++; if (to === null) market.totals.exits++; if (from === null) market.totals.returns++;
    if (from !== null) game.companies[from].migratedOut++;
    if (to !== null) game.companies[to].migratedIn++;
    game.migrations.push({ ...migration, count: 1, customerId: customer.id });
    observe(game, 'customer.migrated', from, { ...migration, customerId: customer.id }, [migration.id, customer.id]);
  }
  for (const company of game.companies) company.customers = market.members[company.id].length;
  game.unserved = market.members.unserved.length;
  game.migrations = game.migrations.filter(migration => game.tick - migration.at < 20).slice(-30);
}

export function advanceMarket(game: GameState) {
  bindMarket(game); flushMigrations(game);
  const market = game.market, epoch = Math.floor(game.tick), dt = epoch - market.lastDecisionTick;
  if (dt <= 0) return;
  market.lastDecisionTick = epoch;
  const scores = new Map(game.companies.map(company => [company.id, attractiveness(company)]));
  // One bounded population pass/second. Proposals all read the same pre-transfer state.
  for (const customer of Object.values(market.customers)) {
    if (customer.pendingMigration || game.tick - (customer.lastMigrationTick ?? -Infinity) < market.config.cooldownSeconds) continue;
    const owner = customer.currentCompanyId;
    const chance = owner === null ? -Math.expm1(-market.config.reentryPerSecond * dt) : migrationProbability(game.companies[owner].pressure, customer, market.config, dt);
    if (marketRandom(game.seed, customer.cohort, epoch, 7) >= chance) continue;
    const target = chooseDestination(game, customer, scores, epoch);
    if (target !== owner) requestMigration(game, customer.id, target, owner === null ? 'RETURN' : 'DISSATISFACTION');
  }
  const before = market.totals.migrations;
  flushMigrations(game); assertMarket(game);
  const moved = market.totals.migrations - before;
  if (moved && epoch % 10 === 0) {
    game.events.unshift({ id: ++game.eventSeq, at: game.tick, companyId: null, text: `${moved} transferencias de clientes confirmadas.`, tone: 'neutral', category: 'MERCADO' });
    game.events.length = Math.min(60, game.events.length);
  }
}
export function evacuateEliminated(game: GameState) {
  const scores = new Map(game.companies.map(company => [company.id, attractiveness(company)]));
  for (const company of game.companies.filter(company => company.eliminated && company.customers)) {
    for (const id of [...game.market.members[company.id]]) {
      const customer = game.market.customers[id];
      const target = chooseDestination(game, customer, scores, Math.floor(game.tick));
      if (customer.pendingMigration) customer.pendingMigration = { targetCompanyId: target, reason: 'ELIMINATION', requestedAt: game.tick };
      else requestMigration(game, id, target, 'ELIMINATION');
    }
  }
  flushMigrations(game); assertMarket(game);
}

export function assertMarket(game: GameState) {
  const market = game.market, seen = new Set<string>(), pending = new Set(market.pendingIds);
  if (pending.size !== market.pendingIds.length) throw new Error('Migración pendiente duplicada.');
  const active = new Map<string, number>();
  for (const company of game.companies) for (const request of [...Object.values(company.traffic.requests), ...(company.concurrency.run?.requests ?? [])]) {
    if (request.customerSource !== 'market') continue;
    const customer = market.customers[request.customerId!];
    if (!customer) throw new Error('Solicitud sin cliente persistente.');
    if (!request.accounted) {
      if (customer.currentCompanyId !== company.id) throw new Error('Solicitud activa fuera de su propietario.');
      active.set(customer.id, (active.get(customer.id) ?? 0) + 1);
    }
  }
  if (Object.keys(market.customers).length !== 5000) throw new Error('Población individual distinta de 5000.');
  for (const [key, members] of Object.entries(market.members)) {
    const owner = key === 'unserved' ? null : Number(key);
    if (owner !== null && !game.companies[owner]) throw new Error('Propietario desconocido.');
    for (const id of members) {
      const customer = market.customers[id];
      if (seen.has(id) || !customer || customer.id !== id || customer.currentCompanyId !== owner || customer.activeRequests < 0) throw new Error('Propiedad exclusiva de cliente inválida.');
      if (customer.activeRequests !== (active.get(id) ?? 0)) throw new Error('Referencias activas de cliente inválidas.');
      if (!!customer.pendingMigration !== pending.has(id)) throw new Error('Índice de migraciones pendientes inválido.');
      if (customer.loyalty < 0 || customer.loyalty > 1 || !/^#[0-9a-f]{6}$/i.test(customer.visualColor) || !/^#[0-9a-f]{6}$/i.test(customer.transitionFromColor)) throw new Error('Fidelidad inválida.');
      if (customer.originCompanyId !== null && !game.companies[customer.originCompanyId]) throw new Error('Origen desconocido.');
      seen.add(id);
    }
    if ((owner === null ? game.unserved : game.companies[owner].customers) !== members.length) throw new Error('Agregado de clientes no coincide con población.');
    if (owner !== null && game.companies[owner].eliminated && members.length) throw new Error('Empresa eliminada conserva clientes.');
  }
  if ([...pending].some(id => !seen.has(id))) throw new Error('Migración de cliente desconocido.');
  if (seen.size !== 5000 || game.companies.reduce((sum, company) => sum + company.customers, game.unserved) !== 5000) throw new Error('Conservación de población inválida.');
}

/** Legacy requests retain their original visitor string and frozen route, not invented history. */
export function importLegacyMarket(game: GameState) {
  game.market = createMarket(game.companies, game.generation, game.tick, true, game.unserved);
  game.market.legacyAggregateMigrations = structuredClone(game.migrations);
  game.migrations = []; // Aggregate history remains explicitly separate from observed individual events.
  for (const company of game.companies) {
    for (const request of [...Object.values(company.traffic.requests), ...(company.concurrency.run?.requests ?? [])]) {
      if ('trafficClass' in request && request.trafficClass === 'malicious') continue;
      request.customerSource = 'legacy';
    }
  }
  bindMarket(game);
}
