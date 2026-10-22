/**
 * Measures the audit leak over full games, so its cost per uncontained request is chosen with evidence.
 *
 * Two scenarios share one seed and one scripted probe: one company leaves the finding open for the rest of the
 * game, the other has Seguridad configure the control two minutes later. The spec's criteria are:
 *   1. fixing it early costs little more than the fine;
 *   2. ignoring it to the end leaves the company in crisis, visibly losing customers.
 *
 * Run: npm run bench:audit
 */
import { applyCommand, assembleGame, createGame, step } from '../server/engine.js';
import { AUDIT_LEAK } from '../shared/auditor.js';
import type { GameState, Identity } from '../shared/types.js';

const AUDITOR: Identity = { id: 'auditor-P1', role: 'auditor', companyId: null };
const OPERATOR: Identity = { id: 'operator', role: 'operator', companyId: null };
let sequence = 0;
function send(g: GameState, who: Identity, type: string, payload: Record<string, unknown>, companyId?: number, changeId?: string) {
  const r = applyCommand(g, who, { id: `cal-${++sequence}`, type, companyId, changeId, payload });
  if (!r.ok && process.env.CAL_DEBUG) console.log('  ✗', type, r.code ?? '', r.error ?? '');
  return r;
}
const advance = (g: GameState, seconds: number) => { for (let i = 0; i < Math.round(seconds * 10); i++) step(g); };

/** Backend → Seguridad (control on the node) → QA → CTO → DevOps, the way a team would close the finding. */
function configureControl(g: GameState, nodeId: string, rules: unknown[]) {
  const c = g.companies[0];
  send(g, { id: '0-backend', role: 'backend', companyId: 0 }, 'change.submit', { graph: structuredClone(c.backend), revision: c.drafts.backend?.revision ?? 0 }, 0);
  const ch = g.changes[0], security: Identity = { id: '0-security', role: 'security', companyId: 0 };
  send(g, security, 'security.configure', { changeId: ch.id, nodeId, revision: 0, rules }, 0);
  send(g, security, 'security.submit', { changeId: ch.id, revision: 1 }, 0);
  send(g, { id: '0-qa', role: 'qa', companyId: 0 }, 'qa.execute', { changeId: ch.id, scenario: { suite: 'unit', requests: 1, stock: 100, concurrency: 1, retries: 0, duplicateIntent: false, coupons: 1, newCustomer: true, invalidInput: false, attack: 'none', interrupt: false } }, 0);
  advance(g, 2);
  send(g, { id: '0-qa', role: 'qa', companyId: 0 }, 'qa.approve', {}, 0, ch.id);
  send(g, { id: '0-cto', role: 'cto', companyId: 0 }, 'cto.authorize', {}, 0, ch.id);
  send(g, { id: '0-devops', role: 'devops', companyId: 0 }, 'deploy.start', { strategy: 'rolling' }, 0, ch.id);
  advance(g, 8);
  return ch.status;
}

function run(mode: number | null | 'sin auditoría') {
  const g = createGame(); assembleGame(g);
  send(g, OPERATOR, 'room.start', {});
  advance(g, 400);                                   // past the point where anomalous traffic begins
  const c = g.companies[0];
  if (mode !== 'sin auditoría') {
    send(g, AUDITOR, 'audit.probe', { companyId: 0, nodeId: 'backend-write', check: 'waf' });
    for (let i = 0; i < 500 && !(g.auditors?.findings.length); i++) advance(g, 0.1);
  }
  const finding = g.auditors?.findings[0];
  const opened = { reputation: c.reputation, customers: c.customers };
  if (typeof mode === 'number') { advance(g, mode); configureControl(g, 'backend-write', [{ kind: 'input' }]); }
  while (g.status === 'RUNNING') advance(g, 1);
  return {
    escenario: mode === 'sin auditoría' ? 'sin auditoría' : mode === null ? 'ignorado' : `corregido a los ${mode} s`,
    cerrado: finding ? finding.closedAt !== undefined : '—',
    'no contenidas': finding?.uncontained ?? 0,
    'perdido por la fuga': Math.round(finding?.lost ?? 0),
    'multa + fuga': Math.round((finding?.fine ?? 0) + (finding?.lost ?? 0)),
    'capital final': Math.round(c.capital),
    'reputación': `${Math.round(opened.reputation)} → ${Math.round(c.reputation)}`,
    'clientes': `${opened.customers} → ${c.customers}`,
    'fuera de juego': c.eliminated,
  };
}

console.log(`Calibración del sangrado — costPerRequest Q${AUDIT_LEAK.costPerRequest}, reputación -${AUDIT_LEAK.reputationPerRequest}/solicitud, multa Q${AUDIT_LEAK.fine}\n`);
console.table([run('sin auditoría'), run(120), run(null)]);
