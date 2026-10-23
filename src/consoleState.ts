import type { Change, ChangeStatus, Report } from '../shared/types';

/**
 * Small rules the role consoles share. Pure on purpose, like src/planBoard.ts: the consoles read the
 * live store, which opens a socket on import, so node:test exercises the rules here instead.
 */

/** A change whose next step is the CTO's decision: QA approved it, or its authorization lapsed. */
export const awaitsCto = (change?: Pick<Change, 'status'>) => change?.status === 'CTO_PENDING' || change?.status === 'EXPIRED';

export type Strategy = 'rolling' | 'restart';
/** A deploy strategy is chosen for one change (or one rollback authorization), never for the console. */
export type StrategyChoice = { changeId: string; strategy: Strategy } | null;
/** The strategy DevOps chose for this change, or none: a choice never carries over to the next one. */
export function strategyFor(choice: StrategyChoice, changeId: string | undefined): Strategy | '' {
  return choice && changeId && choice.changeId === changeId ? choice.strategy : '';
}

/** A command a console sends: the engine reads `changeId` at the top for the historical QA and CTO actions. */
export type ConsoleCommand = { type: string; changeId?: string; payload: Record<string, unknown> };

/**
 * What each QA suite simulates, shown next to its button. Concurrencia and Carga name no numbers: a change
 * without modules or controls still runs their historical fixtures, smaller than the staging case
 * (server/engine.ts qa.run), and the sentence holds for both.
 */
export const SUITE_INFO: Record<string, string> = {
  Concurrencia: 'Varios clientes compran a la vez la última unidad.',
  Regresión: 'Compras simultáneas con pagos repetidos y cupones.',
  Carga: 'Muchas compras a la vez, para ver colas y tiempos.',
  Seguridad: 'Solicitudes con datos inyectados.',
  Integración: 'Una compra con dos cupones.',
  Unitarias: 'Una compra simple.',
};

/** Tests that finished since the lab last looked are attached on their own; one the student unchecked stays so. */
export function attachFinished(state: { selected: string[]; known: string[] }, finished: string[]) {
  const fresh = finished.filter(id => !state.known.includes(id));
  return fresh.length ? { selected: [...state.selected, ...fresh], known: [...state.known, ...fresh] } : state;
}

export const QA_NO_COMMENT = 'Aprobado por QA sin comentario escrito.';
type Reviewable = { id: string; status: ChangeStatus; reports: Pick<Report, 'obsolete'>[] };
/**
 * APROBAR: the marked tests with the comment, which is optional. With nothing to mark — only a historical
 * report, which can never be marked — the change goes with its reports. Tests to mark and none marked is
 * not an approval yet: the student unchecked them on purpose.
 */
export function qaApproval(change: Reviewable, markable: string[], selected: string[], comment: string): ConsoleCommand | null {
  if (change.status !== 'QA_PENDING') return null;
  const risks = comment.trim();
  if (selected.length) return { type: 'qa.review', payload: { changeId: change.id, risks: risks || QA_NO_COMMENT, evidenceIds: selected } };
  if (markable.length || !change.reports.some(r => !r.obsolete)) return null;
  return { type: 'qa.approve', changeId: change.id, payload: risks ? { risks } : {} };
}

/** One test as a return letter quotes it: what was run and what came out, both measured by the engine. */
export type EvidenceLine = { scenario: string; observed: string };
export const reportLine = (r: Pick<Report, 'completed' | 'rejected' | 'oversold' | 'duplicates' | 'breaches'>) =>
  `${r.completed} completadas · ${r.rejected} rechazadas · ${r.oversold} sobreventas · ${r.duplicates} cobros duplicados · ${r.breaches} accesos indebidos`;
type Returnable = { id: string; status: ChangeStatus; domain: string; implementation?: unknown };
/**
 * DEVOLVER: the student writes what failed and what they expected; the steps and the observation are the
 * tests the letter attaches. A plan change has no letter, it is rejected like before.
 */
export function qaReturn(change: Returnable, recipient: 'backend' | 'security', failed: string, expected: string, evidence: EvidenceLine[], selected: string[]): ConsoleCommand | null {
  if (change.status !== 'QA_PENDING') return null;
  if (!change.implementation && change.domain !== 'product') return { type: 'qa.reject', changeId: change.id, payload: {} };
  const description = failed.trim(), wanted = expected.trim();
  if (!description || !wanted) return null;
  return { type: 'qa.return', payload: {
    changeId: change.id, recipient: change.domain === 'product' ? 'product' : recipient, subject: description.slice(0, 120), description,
    steps: evidence.map(e => e.scenario).join(' · ') || 'Revisión sin prueba adjunta.', observed: evidence.map(e => e.observed).join(' · ') || 'Sin prueba adjunta.',
    expected: wanted, severity: 'medium', evidenceIds: selected, observationRefs: [],
  } };
}

export type CtoChoice = 'authorize' | 'evidence' | 'reject';
/** Written when the CTO decides without a reason: what was decided, never why. */
export const CTO_DEFAULT_REASON: Record<CtoChoice, string> = { authorize: 'Autorizado por el CTO.', evidence: 'El CTO pide más pruebas.', reject: 'Rechazado por el CTO.' };
/** One tap is the confirmation: the button names the decision and, for AUTORIZAR, its cost. */
export function ctoDecision(changeId: string, decision: CtoChoice, reason: string): ConsoleCommand {
  return { type: 'cto.decide', payload: { changeId, decision, reason: reason.trim() || CTO_DEFAULT_REASON[decision], confirmed: true } };
}

type RunFacts = { id: string; request: string; seed: number; scenario: { requests: number; stock: number; concurrency: number } };
type ReportFacts = Pick<Report, 'suite' | 'obsolete' | 'completed' | 'rejected' | 'oversold' | 'duplicates' | 'breaches'> & { testEvidence?: { runId?: string } };
/** The tests a return letter quotes: the marked ones, or the historical reports when none can be marked. */
export function evidenceLines(runs: RunFacts[], reports: ReportFacts[], selected: string[]): EvidenceLine[] {
  if (selected.length) return selected.flatMap(id => {
    const run = runs.find(r => r.id === id), report = reports.find(r => r.testEvidence?.runId === id);
    return run && report ? [{ scenario: `${run.id} · ${run.request} · ${run.scenario.requests} solicitudes · stock ${run.scenario.stock} · ${run.scenario.concurrency} a la vez · semilla ${run.seed}`, observed: reportLine(report) }] : [];
  });
  return reports.filter(r => !r.obsolete && !r.testEvidence?.runId).map(r => ({ scenario: `${r.suite} (prueba histórica)`, observed: reportLine(r) }));
}
