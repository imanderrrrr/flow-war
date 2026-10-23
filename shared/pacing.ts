/**
 * The calm start: a deterministic schedule on the engine's intensity, tied to the game tick. It invents no
 * economic formula: it scales the sources the engine already has (customer demand, anomalous traffic, the
 * LAST-UNIT bursts, the external auditor's pruebas de control and the losses a mistake causes) by phase.
 *
 * Defaults are the teacher's numbers for a 25-minute game, in seconds of game time:
 *   minutes 0–15  calm  — light demand, no concurrency bursts, no anomalous traffic, no auditor tests,
 *                         and a mistake costs a quarter of its usual pressure, reputation and elimination clock;
 *   minutes 15–18 ramp  — demand, anomalous traffic and losses climb linearly to their full value;
 *   minute 18 on  full  — the engine exactly as it was before this schedule existed.
 * To change the schedule, edit CALM_START. Each new game freezes a copy into its state (GameState.pacing), so a
 * recorded game always replays with the schedule it was played with; a game without one runs the old schedule.
 */
export type Pacing = {
  version: 1;
  /** Seconds of game time the calm phase lasts. */
  calmUntil: number;
  /** Second at which full pressure starts; the ramp runs from calmUntil to here. */
  rampUntil: number;
  /** Multiplier on the existing customer-demand curve during the calm phase. */
  calmDemand: number;
  /** Multiplier on the pressure, reputation and elimination-clock losses during the calm phase. */
  calmPenalty: number;
  /** Practice copies (server/tutorial.ts) never leave the calm phase but allow pruebas de control. */
  auditsInCalm?: true;
};

export const CALM_START: Pacing = { version: 1, calmUntil: 15 * 60, rampUntil: 18 * 60, calmDemand: .5, calmPenalty: .25 };

export type PacingPhase = 'calm' | 'ramp' | 'full';
export type Intensity = {
  phase: PacingPhase;
  /** Factor on customer demand. */
  demand: number;
  /** Factor on anomalous traffic; 0 means none is generated. */
  anomalous: number;
  /** Factor on what a mistake costs: pressure, reputation and the elimination clock. */
  penalty: number;
  /** LAST-UNIT bursts may start. */
  bursts: boolean;
  /** External auditors may launch pruebas de control. */
  audits: boolean;
};

/** Without a schedule the engine runs as before: every factor is exactly 1, so no result changes. */
export const FULL: Intensity = { phase: 'full', demand: 1, anomalous: 1, penalty: 1, bursts: true, audits: true };

export function intensity(pacing: Pacing | undefined, at: number): Intensity {
  if (!pacing || at >= pacing.rampUntil) return FULL;
  if (at < pacing.calmUntil) return { phase: 'calm', demand: pacing.calmDemand, anomalous: 0, penalty: pacing.calmPenalty, bursts: false, audits: !!pacing.auditsInCalm };
  const k = (at - pacing.calmUntil) / (pacing.rampUntil - pacing.calmUntil);
  return { phase: 'ramp', demand: pacing.calmDemand + (1 - pacing.calmDemand) * k, anomalous: k, penalty: pacing.calmPenalty + (1 - pacing.calmPenalty) * k, bursts: true, audits: true };
}

/** Student-facing names of the phases, shown next to the clock. */
export const PHASE_LABELS: Record<PacingPhase, string> = { calm: 'FASE TRANQUILA', ramp: 'LA DEMANDA SUBE', full: 'PRESIÓN COMPLETA' };

/**
 * A short on-screen notice when the game starts and around each phase change. It states what the schedule does,
 * never what a team should decide. `countdownTo` is the second the announced change happens, for a live count.
 */
export type PhaseNotice = { key: string; title: string; text: string; until: number; countdownTo?: number };
/** Seconds of game time each notice stays on screen. */
export const NOTICE_SECONDS = { start: 40, warning: 60, change: 20 } as const;
const minutes = (seconds: number) => Math.round(seconds / 60);
const percent = (factor: number) => `${Math.round(factor * 100)} %`;
export function phaseNotice(pacing: Pacing | undefined, at: number): PhaseNotice | undefined {
  if (!pacing) return undefined;
  const { calmUntil, rampUntil } = pacing, ramp = minutes(rampUntil - calmUntil);
  const notices: (PhaseNotice & { from: number })[] = [
    { key: 'start', from: 0, until: NOTICE_SECONDS.start, title: `FASE TRANQUILA · ${minutes(calmUntil)} MIN`,
      text: `Durante los primeros ${minutes(calmUntil)} minutos la demanda es el ${percent(pacing.calmDemand)} de la normal, no hay tráfico anómalo simulado ni ráfagas de última unidad, los auditores no pueden lanzar pruebas de control y un error cuesta el ${percent(pacing.calmPenalty)} de lo normal.` },
    { key: 'calm-ends', from: calmUntil - NOTICE_SECONDS.warning, until: calmUntil, countdownTo: calmUntil, title: 'TERMINA LA FASE TRANQUILA',
      text: `Después la demanda sube durante ${ramp} minutos y empiezan las ráfagas de última unidad, el tráfico anómalo simulado y las pruebas de control de los auditores.` },
    { key: 'ramp', from: calmUntil, until: calmUntil + NOTICE_SECONDS.change, title: PHASE_LABELS.ramp,
      text: `Durante ${ramp} minutos la demanda, el tráfico anómalo simulado y el costo de los errores suben de a poco hasta su valor normal.` },
    { key: 'full-soon', from: rampUntil - NOTICE_SECONDS.warning, until: rampUntil, countdownTo: rampUntil, title: 'LLEGA LA PRESIÓN COMPLETA',
      text: 'Después la demanda, el tráfico anómalo simulado y el costo de los errores quedan en su valor normal hasta el final.' },
    { key: 'full', from: rampUntil, until: rampUntil + NOTICE_SECONDS.change, title: PHASE_LABELS.full,
      text: 'La demanda, el tráfico anómalo simulado y el costo de los errores están en su valor normal hasta el final de la partida.' },
  ];
  const notice = notices.find(n => at >= n.from && at < n.until);
  if (!notice) return undefined;
  const { from: _from, ...visible } = notice;
  return visible;
}

/** What the clock shows: the phase now and when the next one starts, plus the notice of the moment, if any. */
export type PhaseView = { phase: PacingPhase; label: string; nextAt?: number; notice?: PhaseNotice };
export function phaseView(pacing: Pacing | undefined, at: number): PhaseView | undefined {
  if (!pacing) return undefined;
  const { phase } = intensity(pacing, at), notice = phaseNotice(pacing, at);
  return { phase, label: PHASE_LABELS[phase], ...(phase === 'calm' ? { nextAt: pacing.calmUntil } : phase === 'ramp' ? { nextAt: pacing.rampUntil } : {}), ...(notice ? { notice } : {}) };
}
