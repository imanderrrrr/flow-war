import type {Company,GameState} from '../shared/types.js';
import type {ServiceMode} from '../shared/observability.js';
import {observe} from './observability.js';
export const MAINTENANCE_POLICY={version:'admission-1',inFlight:'drain',eliminationSeconds:180} as const;
export function admissionReason(c:Company,type:'browse'|'query'|'purchase'){
 if(c.serviceMode?.mode==='FULL_MAINTENANCE')return 'MAINTENANCE' as const;
 if(c.serviceMode?.mode==='ORDERS_PAUSED'&&type==='purchase')return 'ORDERS_PAUSED' as const;
}
export function setMaintenance(g:GameState,c:Company,mode:ServiceMode,actor:string){
 if(mode===c.serviceMode.mode)return;
 const from=c.serviceMode.mode;c.serviceMode={mode,since:g.tick};
 observe(g,'maintenance.changed',c.id,{from,to:mode,actor,policy:MAINTENANCE_POLICY.version},[actor]);
}
