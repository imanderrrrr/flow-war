import type { GameState } from '../shared/types.js';
import { CRISIS_POLICY } from '../shared/crisis.js';
import { observe } from './observability.js';
export function updateCrisis(g:GameState){for(const c of g.companies){const s=c.crisis;
 if(s.lastReputation>=CRISIS_POLICY.enter&&c.reputation<CRISIS_POLICY.enter)observe(g,'crisis.threshold',c.id,{from:s.lastReputation,to:c.reputation,threshold:CRISIS_POLICY.enter});
 if(!s.active&&c.reputation<CRISIS_POLICY.enter){s.active=true;s.enteredAt=g.tick;s.exitedAt=undefined;s.episode++;observe(g,'crisis.entered',c.id,{reputation:c.reputation,episode:s.episode,policy:CRISIS_POLICY.version});}
 else if(s.active&&c.reputation>=CRISIS_POLICY.exit){s.active=false;s.exitedAt=g.tick;observe(g,'crisis.exited',c.id,{reputation:c.reputation,episode:s.episode,threshold:CRISIS_POLICY.exit});}
 s.lastReputation=c.reputation;
}}
