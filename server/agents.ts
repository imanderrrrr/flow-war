import { DEFAULT_TEST, type SimulatedAction } from '../shared/actions.js';
import type { AgentInput, AgentInterpretation, AgentContext, AgentInterpreter, AgentResult } from '../shared/agents.js';
import type { GameState, Identity, Command, Result } from '../shared/types.js';
import { parseAction, object, keys, string } from './action-validation.js';
import { allowedAction } from '../shared/actions.js';
import { confirmViolation, employeeFor, stableDigest } from './discipline.js';

export class LocalFixtureInterpreter implements AgentInterpreter {
  interpret(input: AgentInput, context: Readonly<AgentContext>): AgentInterpretation {
    const base = { version: 1 as const, id: input.id, companyId: context.identity.companyId!, source: 'fixture' as const };
    switch (input.fixture) {
      case 'coupon20': return { version: 1, intent: 'PREPARE_CHANGE', action: { ...base, type: 'module.create', parameters: { name: 'Cupón de bienvenida', configuration: { kind: 'coupon', percent: 20, audience: 'new', stackable: false }, dependencies: [] } } };
      case 'restart_all': return { version: 1, intent: 'EXECUTE_ACTION', action: { ...base, type: 'infra.restart_all', parameters: { duration: 20 } } };
      case 'rate20': return { version: 1, intent: 'PREPARE_CHANGE', action: { ...base, type: 'security.prepare', parameters: { auth: true, authorization: true, waf: true, botThreshold: 80, blockedOrigins: [], rate: { limit: 20, windowSeconds: 60, groupBy: 'origin', scope: 'all', exceed: 'reject' } } } };
      case 'qa200': return { version: 1, intent: 'RUN_TEST', action: { ...base, type: 'qa.execute', parameters: { changeId: input.changeId ?? '', scenario: { ...DEFAULT_TEST, suite: 'concurrency', requests: 200, concurrency: 200, stock: 1 } } } };
      case 'information': return { version: 1, intent: 'REQUEST_INFORMATION' };
      case 'ambiguous': return { version: 1, intent: 'AMBIGUOUS' };
      case 'poem': return { version: 1, intent: 'OUT_OF_SCOPE' };
      default: return { version: 1, intent: 'UNSUPPORTED' };
    }
  }
}
function response(status: AgentResult['status'], message: string, result: Result = { ok: false }): AgentResult { return { ...result, version: 1, status, message }; }
export function parseAgentInput(raw: unknown): AgentInput {
  const p = object(raw); keys(p, ['version','id','fixture','rawText','changeId']); if (p.version !== 1) throw new Error('Contrato de agente no soportado.');
  string(p.id); if (p.fixture !== undefined) string(p.fixture); if (p.changeId !== undefined) string(p.changeId); if (p.rawText !== undefined) string(p.rawText, 2000); return structuredClone(p) as AgentInput;
}
/** Provider output has no mutation authority. Only server-confirmed action execution succeeds. */
export function executeInterpretation(g: GameState, identity: Identity | null, input: AgentInput, raw: unknown, execute: (command: Command) => Result): AgentResult {
  if (!identity) return response('UNAUTHORIZED', 'Sesión no autorizada.', { ok: false, code: 'FORBIDDEN' });
  if (employeeFor(g, identity)?.status === 'EXPELLED') return response('UNAUTHORIZED', 'Empleado expulsado. Puesto vacante.', { ok: false, code: 'EXPELLED' });
  let interpretation: AgentInterpretation;
  try {
    const p = object(raw); keys(p, ['version','intent','action']);
    if (p.version !== 1 || !['EXECUTE_ACTION','PREPARE_CHANGE','RUN_TEST','REQUEST_INFORMATION','OUT_OF_ROLE','OUT_OF_SCOPE','AMBIGUOUS','UNSUPPORTED'].includes(String(p.intent))) throw new Error('Respuesta no válida.');
    interpretation = p as AgentInterpretation;
    if (['EXECUTE_ACTION','PREPARE_CHANGE','RUN_TEST'].includes(interpretation.intent) && !interpretation.action) throw new Error('Acción requerida.');
  } catch { return response('TECHNICAL_ERROR', 'Interpretación no válida.', { ok: false, code: 'INVALID_INTERPRETATION' }); }
  if (interpretation.intent === 'AMBIGUOUS') return response('AMBIGUOUS', 'Solicitud ambigua. No se ejecutó ninguna acción.');
  if (interpretation.intent === 'UNSUPPORTED') return response('UNSUPPORTED', 'Solicitud no implementada.');
  if (interpretation.intent === 'REQUEST_INFORMATION') return response('EXECUTED', 'Información operativa disponible en el panel del rol.', { ok: true });
  if (interpretation.intent === 'OUT_OF_SCOPE') {
    // A model verdict alone never confirms discipline. Versioned exact command rule.
    const confirmed = /^(escribe (un )?poema|write (me )?(a )?poem)[.!]?$/iu.test(input.rawText?.trim() ?? '');
    const e = employeeFor(g, identity), key = `${e?.id ?? identity.id}:${input.id}`, digest = stableDigest(input);
    const prior = g.actions.receipts[key]; if (prior && prior.digest !== digest) return response('TECHNICAL_ERROR', 'ID de orden ya utilizado.', { ok: false, code: 'ID_CONFLICT' });
    if (confirmed && e && !prior) {
      confirmViolation(g, e, { id: input.id, type: 'scope.poem' }, 'OUT_OF_SCOPE');
      const result = { ok: false, code: 'OUT_OF_SCOPE' }; g.actions.receipts[key] = { digest, result };
      g.actions.audit.push({ id: `A${++g.actions.sequence}`, commandId: input.id, actorId: identity.id, companyId: identity.companyId, role: identity.role, type: 'scope.poem', at: g.tick, version: 1, ok: false, code: 'OUT_OF_SCOPE', category: 'discipline', source: 'agent', refs: [], effects: ['discipline-1:exact-poem-request'] });
    }
    return response('OUT_OF_SCOPE', 'Solicitud fuera del juego.', { ok: false, code: 'OUT_OF_SCOPE' });
  }
  let action: SimulatedAction;
  try { action = parseAction(interpretation.action); if (action.id !== input.id) throw new Error('ID de orden incompatible.'); }
  catch { return response('TECHNICAL_ERROR', 'Acción estructurada no válida.', { ok: false, code: 'INVALID_INTERPRETATION' }); }
  if (interpretation.intent === 'OUT_OF_ROLE' && allowedAction(action.type, identity.role)) return response('AMBIGUOUS', 'Clasificación no confirmada. No se ejecutó ninguna acción.');
  const result = execute({ id: action.id, type: 'action.execute', payload: { action } });
  if (!result.ok) return response(result.code === 'FORBIDDEN' ? 'OUT_OF_ROLE' : result.code === 'EXPELLED' ? 'UNAUTHORIZED' : 'TECHNICAL_ERROR', result.error ?? 'Orden no ejecutada.', result);
  const status = action.type === 'deploy.start' ? 'DEPLOY_STARTED' : action.type === 'qa.execute' || action.type === 'qa.run' ? 'EXECUTED' : action.type === 'module.create' || action.type === 'module.revise' || action.type === 'security.prepare' ? (action.type==='security.prepare'?'SENT_TO_QA':'SENT_TO_SECURITY') : action.type === 'campaign.prepare' ? 'PENDING_AUTHORIZATION' : 'EXECUTED';
  const message = status === 'SENT_TO_SECURITY' ? 'Implementación preparada. Pendiente de Seguridad.' : status === 'SENT_TO_QA' ? 'Cambio preparado. Pendiente de pruebas QA.' : status === 'PENDING_AUTHORIZATION' ? 'Campaña preparada. Pendiente de autorización.' : status === 'DEPLOY_STARTED' ? 'Despliegue iniciado.' : action.type.startsWith('infra.restart') ? 'Reinicio iniciado.' : 'Orden ejecutada.';
  return response(status, message, result);
}
export function runLocalAgent(g: GameState, identity: Identity | null, raw: unknown, execute: (command: Command) => Result): AgentResult {
  try {
    const input = parseAgentInput(raw); if (!identity) return response('UNAUTHORIZED', 'Sesión no autorizada.');
    const interpretation = new LocalFixtureInterpreter().interpret(input, { identity, tick: g.tick, generation: g.generation });
    return executeInterpretation(g, identity, input, interpretation, execute);
  } catch { return response('TECHNICAL_ERROR', 'Entrada de agente no válida.', { ok: false, code: 'INVALID_INTERPRETATION' }); }
}
