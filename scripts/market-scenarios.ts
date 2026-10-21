import { applyCommand, createGame, initialGraph } from '../server/engine.js';
import type { GameState, Graph, Role } from '../shared/types.js';

export const MARKET_STRATEGIES = ['A-equivalent', 'B-deficient', 'C-receiver', 'D-domino', 'E-recovery', 'F-elimination', 'G-multiple', 'H-empty'] as const;
export type MarketStrategy = typeof MARKET_STRATEGIES[number];
function insert(graph: Graph, type: string, before: string, value = 1) {
  const target = graph.nodes.find(node => node.type === before)!, edge = graph.edges.find(edge => edge.target === target.id)!, id = `bench-${type}`;
  graph.nodes.push({ id, type, position: { x: 0, y: 0 }, data: { label: type, value } });
  graph.edges = graph.edges.filter(item => item.id !== edge.id); graph.edges.push({ id: `${id}-a`, source: edge.source, target: id }, { id: `${id}-b`, source: id, target: target.id }); return graph;
}
/** All production decisions pass the real role/pipeline authorization. No market transfers injected. */
export function marketScenario(duration = 1200, strategy: MarketStrategy = 'D-domino', seed = 7357, migrations = true) {
  const game = createGame(duration, seed); let sequence = 0;
  if (!migrations) { game.market.config.hazardPerSecond = 0; game.market.config.reentryPerSecond = 0; }
  const command = (role: Role | 'operator', type: string, companyId: number, payload: Record<string, unknown> = {}, changeId?: string) => {
    const result = applyCommand(game, { id: `bench-${role}-${companyId}`, role, companyId: role === 'operator' ? null : companyId }, { id: `market-${++sequence}`, type, companyId, payload, changeId });
    if (!result.ok) throw new Error(`${strategy} ${game.tick} ${companyId} ${type}: ${result.error}`);
  };
  command('operator', 'room.start', 0);
  function scale(companyId: number, servers: number, funded = true) {
    if (funded) for (let index = 0; index < 6; index++) command('cto', 'cto.budget', companyId, { amount: 1000 });
    while (game.companies[companyId].servers < servers) command('devops', 'infra.scale', companyId, { delta: 1 });
    command('devops', 'infra.balancer', companyId, { enabled: true });
  }
  const decide = () => {
    for (const company of game.companies) {
      if (company.eliminated) continue;
      const id = company.id, change = game.changes.find(change => change.companyId === id);
      if (game.tick === 10) {
        command('backend', 'change.submit', id, { graph: insert(initialGraph('backend'), 'atomic', 'write'), revision: 0 });
        command('security','security.submit',id,{changeId:game.changes[0].id,revision:0});
        command('qa', 'qa.run', id, { suite: 'Concurrencia' }, game.changes[0].id);
      }
      if (game.tick === 15 || game.tick === 28) {
        command('qa', 'qa.approve', id, {}, change?.id); command('cto', 'cto.authorize', id, {}, change?.id); command('devops', 'deploy.start', id, { strategy: 'rolling' }, change?.id);
      }
      if (game.tick === 23) {
        let graph = initialGraph('security'); graph = insert(graph, 'auth', 'exit'); graph = insert(graph, 'waf', 'exit'); graph = insert(graph, 'bot', 'exit', 100);
        command('security', 'security.prepare', id, {auth:true,authorization:false,waf:true,botThreshold:100,blockedOrigins:[],rate:null}); command('qa', 'qa.run', id, { suite: 'Seguridad' }, game.changes[0].id);
      }
      if (strategy === 'D-domino' && id === 0 && game.tick === 450) {
        const locked=company.runtime.workflow?.backendLock;if(locked)command('qa','qa.return',id,{changeId:locked.changeId,recipient:'backend',subject:'Revisión de operación',description:'QA solicita una revisión de la implementación.',steps:'Repetir las pruebas ya registradas.',observed:'La evidencia permanece en el cambio original.',expected:'Validar la siguiente revisión.',severity:'medium',evidenceIds:[],observationRefs:[]});
        command('backend', 'change.submit', id, { graph: insert(initialGraph('backend'), 'atomic', 'write'), revision: company.drafts.backend?.revision??1 });
        command('security','security.submit',id,{changeId:game.changes[0].id,revision:0});
        command('qa', 'qa.run', id, { suite: 'Concurrencia' }, game.changes[0].id);
      }
      if (strategy === 'D-domino' && id === 0 && game.tick === 455) {
        command('qa', 'qa.approve', id, {}, change?.id); command('cto', 'cto.authorize', id, {}, change?.id); command('devops', 'deploy.start', id, { strategy: 'restart' }, change?.id);
      }
      if (game.tick === 40) {
        const unfunded = strategy === 'H-empty' || (strategy === 'G-multiple' && id < 3) || (strategy === 'F-elimination' && id === 0);
        const deficient = ['B-deficient', 'C-receiver', 'D-domino', 'E-recovery'].includes(strategy) && id === 0;
        const receiver = (strategy === 'C-receiver' || strategy === 'D-domino') && id === 1;
        if (!deficient) scale(id, receiver ? strategy === 'C-receiver' ? 4 : 5 : 8, !unfunded);
      }
      if (strategy === 'E-recovery' && game.tick === 650 && id === 0) scale(id, 8);
    }
  };
  return { game, decide };
}
export function marketSample(game: GameState) {
  return { tick: game.tick, status: game.status, population: Object.keys(game.market.customers).length, unserved: game.unserved, transfers: game.market.totals.migrations,
    companies: game.companies.map(c => ({ id: c.id, customers: c.customers, share: c.customers / 50, pressure: c.pressure, reputation: c.reputation, utilization: c.utilization, queue: c.queue, latencyMs: c.latency, arrived: c.traffic.legitimate.generated, abandoned: c.traffic.legitimate.abandoned, rejected: c.traffic.legitimate.rejected, migratedIn: c.migratedIn, migratedOut: c.migratedOut, servers: c.servers, webRate: c.traffic.services.web.rate, eliminated: c.eliminated, capital: c.capital, revenue: c.revenue })) };
}
