import type { CrisisState } from './observability.js';
export const CRISIS_POLICY = { version: 'crisis-1', enter: 35, exit: 40, paperInterval: 8, maxPapers: 18, recoverySeconds: 3 } as const;
/** Uses only persisted episode/timestamps and simulated time. No browser clock or FPS. */
export function crisisVisual(crisis: CrisisState, tick: number) {
 const elapsed=crisis.enteredAt===undefined?0:Math.max(0,(crisis.active?tick:crisis.exitedAt??tick)-crisis.enteredAt);
 const total=Math.min(CRISIS_POLICY.maxPapers,Math.floor(elapsed/CRISIS_POLICY.paperInterval));
 const recovery=crisis.active?1:Math.max(0,1-(tick-(crisis.exitedAt??-10))/CRISIS_POLICY.recoverySeconds);
 const count=crisis.active?total:Math.ceil(total*recovery);
 return { active:crisis.active, intensity:recovery, papers:Array.from({length:count},(_,i)=>({id:`${crisis.episode}-${i}`,x:(i*17+crisis.episode*7)%70,y:Math.floor(i/4)*3+(i*7)%8,rotation:((i*13+crisis.episode)%5-2)*3,variant:(i+crisis.episode)%3})) };
}
