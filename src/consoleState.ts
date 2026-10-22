import type { Change } from '../shared/types';

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
