import type { Company, Change, GameState, Identity, Result } from '../shared/types.js';
import type { TestScenario } from '../shared/actions.js';
import type { WorkflowState, WorkflowView, QaRun, ReturnLetter } from '../shared/workflow.js';
import { stableDigest } from './discipline.js';
import { createTestJob } from './qa.js';
import { assertBundle } from './collaboration.js';
import { returnProduct } from './product.js';

export const workflow=(c:Company):WorkflowState=>c.runtime.workflow??={letters:[],runs:[],decisions:[],investments:[]};
export const available=(c:Company)=>Math.max(0,Math.round((c.capital-c.infraBudget-c.reserved)*100)/100);
export function assertBackendEditable(c:Company) { if(c.runtime.workflow?.backendLock)throw new Error('purchase-flow bloqueada. Se requiere devolución formal de QA.'); }
export function workflowView(c:Company):WorkflowView {const s=c.runtime.workflow??{letters:[],runs:[],decisions:[],investments:[]};return {backendLock:structuredClone(s.backendLock),letters:structuredClone(s.letters),decisions:structuredClone(s.decisions),investments:structuredClone(s.investments),runs:s.runs.map(({report,...r})=>structuredClone(r)),available:available(c)};}
export function lockBackend(c:Company,ch:Change,at:number){assertBackendEditable(c);workflow(c).backendLock={featureId:'purchase-flow',changeId:ch.id,at};}
/** A delivered implementation is still in Seguridad → QA → CTO → DevOps; an expired authorization can be decided again. */
export const inCycle=(ch:Change)=>['SECURITY_PENDING','QA_PENDING','QA_RUNNING','CTO_PENDING','AUTHORIZED','DEPLOYING','EXPIRED'].includes(ch.status);
/** The freeze lasts as long as its change is in the cycle: once it is published, failed or stale, Backend edits again. */
export function releaseBackendLock(g:Pick<GameState,'changes'>,c:Company){const s=c.runtime.workflow;if(s?.backendLock&&!g.changes.some(ch=>ch.id===s.backendLock!.changeId&&ch.companyId===c.id&&inCycle(ch)))delete s.backendLock;}
export function startQa(g:GameState,c:Company,ch:Change,actor:Identity,scenario:TestScenario,request='Solicitud manual',repeat?:QaRun) {
  if(!repeat&&ch.status!=='QA_PENDING')throw new Error('QA requiere un cambio pendiente.');assertBundle(ch);
  const state=workflow(c);if(state.runs.length>=160)throw new Error('Límite de pruebas de la partida alcanzado.');
  const id=`C${c.id}-QA${state.runs.length+1}`,seed=repeat?.seed??g.seed;
  const run:QaRun={id,companyId:c.id,generation:g.generation,author:actor.id,changeId:ch.id,backendVersion:ch.implementation?.backendVersion??ch.baseVersion,securityRevision:ch.implementation?.security?.revision??0,bundleDigest:ch.implementation?.bundleDigest??stableDigest(ch.context),request,scenario:structuredClone(scenario),seed,at:g.tick,...(repeat?{repeatOf:repeat.id}:{})};
  const job=createTestJob(c,ch,scenario,seed);if(repeat&&ch.status!=='QA_PENDING')(job as any).restoreStatus=ch.status;
  ch.testJob=job;ch.status='QA_RUNNING';ch.runningSuite=scenario.suite;ch.qaRunId=id;state.runs.push(run);
}
export function completeQa(c:Company,ch:Change) {const run=c.runtime.workflow?.runs.find(r=>r.id===ch.qaRunId);if(run){run.report=structuredClone(ch.reports.at(-1)!);if(run.report.testEvidence){run.report.testEvidence.runId=run.id;run.report.testEvidence.outcomes=[];run.report.testEvidence.events=[];}if(ch.reports.at(-1)!.testEvidence)ch.reports.at(-1)!.testEvidence!.runId=run.id;
 const thread=c.runtime.conversations?.find(t=>t.actor===run.author&&t.role==='qa'&&t.generation===run.generation&&t.id===(run.threadId??'qa-default'));const r=run.report;
 if(thread)thread.messages.push({id:`${run.id}-result`,requestId:run.id,role:'assistant',text:`${run.id}: se ejecutaron ${r.requests} solicitudes con ${run.scenario.stock} unidades iniciales. ${r.completed} compras completadas, ${r.rejected} rechazadas, ${r.abandoned??0} abandonos, ${r.oversold} sobreventas, ${r.duplicates} cobros duplicados. Latencia media ${r.latency} ms. Ataques: ${r.securityOutcomes?.attempts??0} intentos, ${r.securityOutcomes?.blocked??0} bloqueados, ${r.securityOutcomes?.successful??0} exitosos. Resultado limitado a este escenario.`,at:r.tick,refs:[run.id,ch.id]});
 }delete ch.qaRunId;}
function changeFor(g:GameState,c:Company,id:unknown){const ch=g.changes.find(x=>x.id===id&&x.companyId===c.id);if(!ch)throw new Error('Cambio no encontrado.');return ch;}
function evidence(c:Company,ch:Change,ids:string[]) {return ids.map(id=>{const run=workflow(c).runs.find(r=>r.id===id&&r.changeId===ch.id&&r.report&&r.bundleDigest===(ch.implementation?.bundleDigest??stableDigest(ch.context)));if(!run)throw new Error('Evidencia ajena, incompleta o de otra versión.');return run;});}
export function workflowCommand(g:GameState,c:Company,actor:Identity,type:string,p:Record<string,unknown>):Result|undefined {
  if(!['qa.repeat','qa.return','qa.review','cto.decide','change.cancel','investment.link','investment.create','investment.transition'].includes(type))return;
  const s=workflow(c);
  if(type==='qa.repeat'){
    const run=s.runs.find(r=>r.id===p.runId&&r.report);if(!run)throw new Error('Prueba no disponible.');
    const ch=changeFor(g,c,run.changeId);if(run.bundleDigest!==(ch.implementation?.bundleDigest??stableDigest(ch.context)))throw new Error('La combinación cambió.');
    // Replays can examine an archived immutable version; they cannot approve it or reopen editing.
    if(ch.status==='QA_RUNNING'||ch.status==='DEPLOYING')throw new Error('La implementación tiene una operación en curso.');
    startQa(g,c,ch,actor,run.scenario,run.request,run);
    return {ok:true,refs:[ch.id,ch.qaRunId!]};
  }
  if(type==='qa.return'){
    const ch=changeFor(g,c,p.changeId);
    if(ch.domain==='product'){
      // Producto: the formal return frees the frozen draft for a new proposal; no Backend lock is involved.
      if(p.recipient!=='product'||['QA_RUNNING','DEPLOYING','DEPLOYED','STALE','QA_REJECTED'].includes(ch.status))throw new Error('La versión no admite devolución.');
      if(s.letters.some(l=>l.changeId===ch.id))throw new Error('La devolución ya fue registrada.');
      const runs=evidence(c,ch,p.evidenceIds as string[]);
      const letter:ReturnLetter={id:`C${c.id}-RET${s.letters.length+1}`,companyId:c.id,changeId:ch.id,backendVersion:0,securityRevision:0,recipient:'product',subject:String(p.subject),description:String(p.description),steps:String(p.steps),observed:String(p.observed),expected:String(p.expected),severity:p.severity as ReturnLetter['severity'],evidenceIds:runs.map(r=>r.id),observationRefs:[],author:actor.id,at:g.tick,generation:g.generation};
      c.reserved-=ch.reserved;ch.reserved=0;ch.status='QA_REJECTED';returnProduct(c,ch);s.letters.push(letter);return {ok:true,refs:[letter.id,ch.id]};
    }
    if(p.recipient==='product')throw new Error('Destinatario incompatible con el cambio.');
    if(!ch.implementation||['QA_RUNNING','DEPLOYING','STALE','QA_REJECTED'].includes(ch.status))throw new Error('La versión no admite devolución.');
    const runs=evidence(c,ch,p.evidenceIds as string[]);
    const review=c.runtime.collaboration?.reviews[ch.id];
    for(const ref of p.observationRefs as string[])if(!review?.observations.some((o,i)=>`${ch.id}:${i}`===ref))throw new Error('Observación no disponible.');
    const letter:ReturnLetter={id:`C${c.id}-RET${s.letters.length+1}`,companyId:c.id,changeId:ch.id,backendVersion:ch.implementation.backendVersion,securityRevision:ch.implementation.security?.revision??0,recipient:p.recipient as 'backend'|'security',subject:String(p.subject),description:String(p.description),steps:String(p.steps),observed:String(p.observed),expected:String(p.expected),severity:p.severity as ReturnLetter['severity'],evidenceIds:runs.map(r=>r.id),observationRefs:p.observationRefs as string[],author:actor.id,at:g.tick,generation:g.generation};
    if(s.letters.some(l=>l.changeId===ch.id))throw new Error('La devolución ya fue registrada.');
    if(s.backendLock&&s.backendLock.changeId!==ch.id)throw new Error('Existe otra revisión congelada.');
    if(letter.recipient==='security'&&!review)throw new Error('Revisión de protección ausente.');
    c.reserved-=ch.reserved;ch.reserved=0;
    if(letter.recipient==='backend'){
      c.drafts.backend={graph:structuredClone(ch.graph),revision:(c.drafts.backend?.revision??0)+1};delete s.backendLock;
    }else{
      if(!review)throw new Error('Revisión de protección ausente.');
      const next:Change={...structuredClone(ch),id:`CH-${String(g.changes.length+1).padStart(3,'0')}`,parentChangeId:ch.id,status:'SECURITY_PENDING',reserved:0,created:g.tick,reports:[],baseVersion:c.version};
      delete next.qaRunId;delete next.testJob;delete next.due;delete next.expires;
      next.context!.executionVersion=c.version;delete next.implementation!.bundleDigest;delete next.context!.execution!.bundleDigest;
      c.runtime.collaboration!.reviews[next.id]={...structuredClone(review),revision:review.revision+1};
      g.changes.unshift(next);letter.successorId=next.id;s.backendLock={featureId:'purchase-flow',changeId:next.id,at:g.tick};
    }
    if(ch.status!=='DEPLOYED')ch.status='QA_REJECTED';s.letters.push(letter);return {ok:true,refs:[letter.id,ch.id,...(letter.successorId?[letter.successorId]:[])]};
  }
  if(type==='qa.review'){
    const ch=changeFor(g,c,p.changeId);if(ch.status!=='QA_PENDING')throw new Error('QA requiere un cambio pendiente.');
    const runs=evidence(c,ch,p.evidenceIds as string[]);if(!runs.length)throw new Error('Selecciona evidencia terminada.');
    assertBundle(ch);s.decisions.push({id:`D${s.decisions.length+1}`,changeId:ch.id,actor:actor.id,at:g.tick,kind:'qa.approve',reason:String(p.risks),evidenceIds:runs.map(r=>r.id),failedIds:s.runs.filter(r=>r.changeId===ch.id&&r.report?.testEvidence?.passed===false).map(r=>r.id)});ch.status='CTO_PENDING';return {ok:true,refs:[ch.id]};
  }
  if(type==='cto.decide'){
    const ch=changeFor(g,c,p.changeId);if(!['CTO_PENDING','EXPIRED'].includes(ch.status))throw new Error('Falta aprobación de QA.');assertBundle(ch);
    const decision=p.decision;
    if(decision==='authorize'){
      const funded=funding(c,ch);if(funded&&ch.cost>funded.maximum)throw new Error('El costo supera el máximo de la orden.');const extra=Math.max(0,ch.cost-(funded?.reserved??0));
      if(c.capital-c.infraBudget-c.reserved<extra)throw new Error('Saldo disponible insuficiente.');
      c.reserved+=extra;ch.reserved=extra;ch.status='AUTHORIZED';ch.expires=g.tick+60;
    }else ch.status='QA_PENDING'; // Rejection and evidence requests return to QA, never unlock Backend.
    s.decisions.push({id:`D${s.decisions.length+1}`,changeId:ch.id,actor:actor.id,at:g.tick,kind:decision==='authorize'?'cto.authorize':decision==='reject'?'cto.reject':'cto.evidence',reason:String(p.reason),evidenceIds:s.runs.filter(r=>r.changeId===ch.id&&r.report).map(r=>r.id),failedIds:s.runs.filter(r=>r.changeId===ch.id&&r.report?.testEvidence?.passed===false).map(r=>r.id),cost:ch.cost});return {ok:true,refs:[ch.id]};
  }
  if(type==='change.cancel'){
    const ch=changeFor(g,c,p.changeId);if(['DEPLOYING','DEPLOYED'].includes(ch.status))throw new Error('La publicación no admite cancelación.');
    if(s.backendLock?.changeId!==ch.id)throw new Error('Entrega no vigente.');
    c.reserved-=ch.reserved;ch.reserved=0;ch.status='QA_REJECTED';delete ch.testJob;delete ch.qaScenario;delete ch.qaLoad;delete ch.qaRunId;
    // Formal QA cancellation is an audited terminal transition, not an editing back door.
    s.decisions.push({id:`D${s.decisions.length+1}`,changeId:ch.id,actor:actor.id,at:g.tick,kind:'cancel',reason:String(p.reason),evidenceIds:[],failedIds:[]});
    c.drafts.backend={graph:structuredClone(ch.graph),revision:(c.drafts.backend?.revision??0)+1};delete s.backendLock;return {ok:true,refs:[ch.id]};
  }
  if(type==='investment.link'){
    const order=s.investments.find(o=>o.id===p.orderId),ch=changeFor(g,c,p.changeId);
    if(!order||order.department!==actor.role||order.status!=='IN_PROGRESS'||order.changeId&&g.changes.some(ch=>ch.id===order.changeId&&!['QA_REJECTED','STALE'].includes(ch.status))||['AUTHORIZED','DEPLOYING','DEPLOYED'].includes(ch.status)||s.investments.some(o=>o.changeId===ch.id&&!['CANCELLED','COMPLETED'].includes(o.status)))throw new Error('Orden o implementación no disponible.');
    order.changeId=ch.id;return {ok:true,refs:[order.id,ch.id]};
  }
  if(type==='investment.create'){
    if(s.investments.length>=80)throw new Error('Límite de órdenes.');
    if(p.changeId){const ch=changeFor(g,c,p.changeId);if(['AUTHORIZED','DEPLOYING','DEPLOYED'].includes(ch.status)||s.investments.some(o=>o.changeId===ch.id&&!['CANCELLED','COMPLETED'].includes(o.status)))throw new Error('Implementación no disponible para esta inversión.');}
    const maximum=Number(p.maximum);if(available(c)<maximum)throw new Error('Saldo disponible insuficiente.');
    const order={id:`C${c.id}-INV${s.investments.length+1}`,companyId:c.id,cto:actor.id,department:p.department as 'backend'|'security',objective:String(p.objective),justification:String(p.justification),maximum,reserved:0,spent:0,status:'REQUESTED' as const,at:g.tick,expires:g.tick+300,...(p.changeId?{changeId:String(p.changeId)}:{})};s.investments.push(order);return {ok:true,refs:[order.id]};
  }
  if(type==='investment.transition'){
    const order=s.investments.find(o=>o.id===p.orderId);if(!order)throw new Error('Orden no encontrada.');
    const status=String(p.status),spent=Number(p.spent);
    if(status==='IN_PROGRESS'){
      if(actor.role!==order.department||order.status!=='AUTHORIZED')throw new Error('Orden no disponible para este departamento.');
      if(actor.role==='backend')assertBackendEditable(c);order.status='IN_PROGRESS';
    }else{
      if(actor.role!=='cto')throw new Error('Requiere confirmación del CTO.');
      if(status==='AUTHORIZED'){
        if(order.status!=='REQUESTED'||g.tick>=order.expires)throw new Error('Orden no disponible.');if(c.capital-c.infraBudget-c.reserved<order.maximum)throw new Error('Saldo disponible insuficiente.');
        c.reserved+=order.maximum;order.reserved=order.maximum;order.status='AUTHORIZED';
      }else if(status==='CANCELLED'){
        if(order.changeId&&g.changes.some(ch=>ch.id===order.changeId&&['AUTHORIZED','DEPLOYING'].includes(ch.status)))throw new Error('Solicita primero devolución o cancelación formal en QA.');
        if(['COMPLETED','CANCELLED'].includes(order.status))throw new Error('Orden cerrada.');c.reserved-=order.reserved;order.reserved=0;order.status='CANCELLED';
      }else{
        // Only a real deployment consumes an implementation investment. No arbitrary debit or bonus.
        const ch=changeFor(g,c,order.changeId);if(order.status!=='IN_PROGRESS'||ch.status!=='DEPLOYED'||spent!==0)throw new Error('Se requiere publicación real; el gasto se liquida al publicar.');
        order.status='COMPLETED';order.completedBy=actor.id;c.reserved-=order.reserved;order.reserved=0;
      }
    }
    return {ok:true,refs:[order.id]};
  }
}
export function expireInvestments(c:Company,at:number,finish=false,protectedIds:string[]=[]){for(const o of c.runtime.workflow?.investments??[])if(!['COMPLETED','CANCELLED'].includes(o.status)&&(finish||at>=o.expires&&!protectedIds.includes(o.changeId??''))){c.reserved-=o.reserved;o.reserved=0;o.status='CANCELLED';}}

export function funding(c:Company,ch:Change){return workflow(c).investments.find(o=>o.changeId===ch.id&&o.status==='IN_PROGRESS');}
export function settleInvestment(c:Company,ch:Change){const order=funding(c,ch);if(order){const used=Math.min(ch.cost,order.reserved);c.reserved-=used;order.reserved-=used;order.spent+=used;}}
