import type { GameState, Identity } from '../shared/types.js';
import type { AiInput, AiProposal } from '../shared/collaboration.js';
import { collaboration, editableChange } from './collaboration.js';
import { employeeFor, stableDigest } from './discipline.js';
import { AiError, AiGateway, parseAiInput, proposalVariation } from './claude.js';
import { assertBackendEditable, workflow, workflowView } from './workflow.js';

const compactLetter=(l:import('../shared/workflow.js').ReturnLetter)=>({id:l.id,changeId:l.changeId,recipient:l.recipient,author:l.author,at:l.at,subject:l.subject.slice(0,160),description:l.description.slice(0,400),steps:l.steps.slice(0,400),observed:l.observed.slice(0,400),expected:l.expected.slice(0,400),evidenceIds:l.evidenceIds.slice(0,8),truncated:[l.subject,l.description,l.steps,l.observed,l.expected].some(t=>t.length>400)});
export function aiContext(g:GameState,actor:Identity,input:AiInput) {
  const employee=employeeFor(g,actor);
  if(actor.companyId===null||employee?.status!=='ACTIVE'||employee.role!==actor.role||employee.companyId!==actor.companyId||g.status!=='RUNNING')throw new AiError('FORBIDDEN','Operación no autorizada.');
  const c=g.companies[actor.companyId];if(c.eliminated)throw new AiError('FORBIDDEN');
  const threads=c.runtime.conversations??[];
  const thread=threads.find(t=>t.id===(input.threadId??`${actor.role}-default`)&&t.actor===actor.id&&t.role===actor.role&&t.generation===g.generation);
  const history=thread?.messages.slice(-8).map(m=>({role:m.role,text:m.text.slice(0,1200),refs:m.refs}))??[];
  if(thread&&thread.messages.length>=800)throw new AiError('AI_LIMIT','Este hilo alcanzó su límite. Abre otro hilo.');
  if(!thread&&threads.filter(t=>t.actor===actor.id).length>=8)throw new AiError('AI_LIMIT','Límite de hilos alcanzado.');
  if(input.kind==='backend.propose'){
    if(actor.role!=='backend')throw new AiError('FORBIDDEN');assertBackendEditable(c);
    return {c,graph:c.drafts.backend?.graph??c.backend,revision:c.drafts.backend?.revision??0,context:{history,letters:workflow(c).letters.filter(l=>l.recipient==='backend').slice(-3).map(compactLetter)}};
  }
  if(input.kind==='qa.interpret'||input.kind==='cto.interpret'){
    if(actor.role!==(input.kind==='qa.interpret'?'qa':'cto'))throw new AiError('FORBIDDEN');
    const ch=input.changeId?g.changes.find(ch=>ch.id===input.changeId&&ch.companyId===c.id):undefined;
    if(input.changeId&&!ch)throw new AiError('FORBIDDEN');
    if(input.kind==='qa.interpret'&&ch?.status!=='QA_PENDING')throw new AiError('STALE','Selecciona una implementación pendiente de QA.');
    const w=workflowView(c),runs=workflow(c).runs.filter(r=>!ch||r.changeId===ch.id).slice(-6).map(({report,...r})=>({...r,request:r.request.slice(0,400),result:report?{requests:report.requests,completed:report.completed,rejected:report.rejected,oversold:report.oversold,latency:report.latency,security:report.securityOutcomes,observed:report.testEvidence?.observed}:undefined}));
    return {c,graph:ch?.graph??c.backend,revision:ch?.implementation?.security?.revision??c.version,context:{companyId:c.id,generation:g.generation,role:actor.role,history,capital:c.capital,available:w.available,reserved:c.reserved,operatingBudget:c.infraBudget,infrastructure:c.infrastructure,metrics:{requests:c.requests,successes:c.successes,errors:c.errors,latency:c.latency},changes:g.changes.filter(ch=>ch.companyId===c.id).slice(0,12).map(ch=>({id:ch.id,status:ch.status,cost:ch.cost,backendVersion:ch.implementation?.backendVersion,securityRevision:ch.implementation?.security?.revision})),runs,letters:w.letters.slice(-3).map(compactLetter),decisions:w.decisions.slice(-6).map(d=>({...d,reason:d.reason.slice(0,400),evidenceIds:d.evidenceIds.slice(0,12),failedIds:d.failedIds.slice(0,12)})),investments:w.investments.slice(-8).map(o=>({...o,objective:o.objective.slice(0,400),justification:o.justification.slice(0,400)}))}};
  }
  if(actor.role!=='security')throw new AiError('FORBIDDEN','Operación no autorizada.');
  const {ch,draft}=editableChange(g,actor,input.changeId!,input.nodeId);
  return {c,graph:ch.graph,revision:draft.revision,context:{history,letters:workflow(c).letters.filter(l=>l.recipient==='security').slice(-3).map(compactLetter)}};
}
function digestFor(g:GameState,actor:Identity,input:AiInput,ctx:ReturnType<typeof aiContext>){return stableDigest({input,generation:g.generation,actor,revision:ctx.revision,graph:ctx.graph,change:input.changeId?g.changes.find(ch=>ch.id===input.changeId)?.implementation?.bundleDigest:undefined});}
export async function prepareAi(g:GameState,actor:Identity,raw:unknown,gateway:AiGateway):Promise<AiProposal> {
  const input=parseAiInput(raw),context=aiContext(g,actor,input),state=collaboration(context.c),digest=digestFor(g,actor,input,context);
  const prior=state.proposals.find(p=>p.id===input.id&&p.actor===actor.id);
  if(prior){if(prior.inputDigest!==digest)throw new AiError('ID_CONFLICT','ID de solicitud ya utilizado.');return structuredClone(prior);}
  if(state.proposals.length>=240)throw new AiError('AI_LIMIT','Límite de propuestas de la partida alcanzado.');
  if(JSON.stringify(context.context).length>48000)throw new AiError('CONTEXT_LIMIT','El contexto seleccionado excede el límite. Abre un hilo más específico.');
  const output=await gateway.generate(actor.id,input,structuredClone(context.graph),context.c.id,structuredClone(context.context));
  // Authoritative evidence is rendered by the server. Model prose is never accepted as a result.
  if(input.kind==='cto.interpret'){
    if(output.intent!=='query'&&output.intent!=='investment'&&!g.changes.some(ch=>ch.id===output.changeId&&ch.companyId===context.c.id))throw new AiError('INVALID_OUTPUT');
    output.reason=input.text;output.objective=input.text;output.justification=input.text;
  }
  return {id:input.id,actor:actor.id,companyId:context.c.id,generation:g.generation,kind:input.kind,inputDigest:digest,changeId:input.changeId,nodeId:input.nodeId,sourceText:input.kind==='security.compile'?input.text:undefined,requestText:input.text,threadId:input.threadId??`${actor.role}-default`,output:input.kind==='backend.propose'?proposalVariation(output,`${g.seed}:${g.generation}:${context.c.id}:${digest}`):output,provider:gateway.provider.name,model:gateway.provider.model,status:'PENDING',at:g.tick,draftRevision:context.revision};
}
/** Recheck after network I/O: reset, logout, expulsion and edits cannot race a reply. */
export function commitAi(g:GameState,actor:Identity,raw:unknown,proposal:AiProposal) {
  const input=parseAiInput(raw),context=aiContext(g,actor,input),digest=digestFor(g,actor,input,context);
  if(proposal.actor!==actor.id||proposal.generation!==g.generation||proposal.companyId!==actor.companyId||proposal.inputDigest!==digest)throw new AiError('STALE','La versión cambió durante la solicitud.');
  const state=collaboration(context.c),prior=state.proposals.find(p=>p.id===proposal.id&&p.actor===actor.id);
  if(prior){if(prior.inputDigest!==digest)throw new AiError('ID_CONFLICT');return prior;}
  if(state.proposals.length>=240)throw new AiError('AI_LIMIT');state.proposals.push(structuredClone(proposal));
  const threads=context.c.runtime.conversations??=[];let thread=threads.find(t=>t.id===proposal.threadId&&t.actor===actor.id&&t.role===actor.role&&t.generation===g.generation);
  if(!thread){thread={id:proposal.threadId!,actor:actor.id,role:actor.role,generation:g.generation,companyId:context.c.id,messages:[]};threads.push(thread);}
  if(!thread.messages.some(m=>m.id===`${proposal.id}-human`))thread.messages.push({id:`${proposal.id}-human`,requestId:proposal.id,role:'user',text:input.text,at:g.tick,refs:input.changeId?[input.changeId]:[]});
  thread.messages.push({id:`${proposal.id}-assistant`,requestId:proposal.id,role:'assistant',text:proposalText(g,actor,proposal),at:g.tick,refs:[proposal.id,...(input.changeId?[input.changeId]:[])]});
  return proposal;
}
export function proposalText(g:GameState,actor:Identity,p:AiProposal){
  const c=g.companies[actor.companyId!],o=p.output;
  if(p.kind==='qa.interpret')return o.scenario?`Escenario preparado: ${o.scenario.requests} solicitudes, ${o.scenario.stock} unidades, concurrencia ${o.scenario.concurrency}. Confirma para ejecutar en el laboratorio.`:`Indica la información necesaria: ${(o.missing??[]).join(', ')}.`;
  if(p.kind==='cto.interpret'){
    if(o.intent==='query'){const w=workflowView(c);return `Capital Q${c.capital.toFixed(2)}. Operación Q${c.infraBudget.toFixed(2)}. Reservado Q${c.reserved.toFixed(2)}. Disponible Q${w.available.toFixed(2)}.\n`+g.changes.filter(ch=>ch.companyId===c.id&&(!p.changeId||p.changeId===ch.id)).slice(0,12).map(ch=>`${ch.id}: ${ch.status}; costo Q${ch.cost}; ${ch.reports.length} pruebas. `+ch.reports.slice(-6).map(r=>`${r.requests} solicitudes: ${r.completed} completadas, ${r.rejected} rechazadas, ${r.oversold} sobreventas; latencia ${r.latency}ms.`).join(' ')).join('\n');}
    return o.intent==='investment'?`Orden preparada para ${o.department}: máximo Q${o.maximum}. Objetivo: ${p.requestText}. Requiere confirmación del CTO.`:`Decisión preparada: ${o.intent} · ${o.changeId}. Motivo: ${p.requestText}. Requiere confirmación del CTO.`;
  }
  return 'Borrador preparado. Revísalo antes de aceptarlo.';
}
export function visibleProposal(proposal:AiProposal){return {id:proposal.id,kind:proposal.kind,provider:proposal.provider,model:proposal.model,...(proposal.kind==='security.compile'?{executable:proposal.output.executable}:proposal.output)};}

export function beginAiAttempt(g:GameState,actor:Identity,raw:unknown){const input=parseAiInput(raw),ctx=aiContext(g,actor,input),c=ctx.c,attempts=c.runtime.aiAttempts??=[],digest=stableDigest(input);
 const prior=attempts.find(r=>r.actor===actor.id&&r.id===input.id);if(prior){if(prior.digest!==digest)throw new AiError('ID_CONFLICT');return prior;}
 if(attempts.length>=480)throw new AiError('AI_LIMIT');
 const attempt={id:input.id,actor:actor.id,role:actor.role,generation:g.generation,threadId:input.threadId??`${actor.role}-default`,digest,state:'QUEUED',at:g.tick};attempts.push(attempt);
 const threads=c.runtime.conversations??=[];let thread=threads.find(t=>t.id===attempt.threadId&&t.actor===actor.id&&t.role===actor.role&&t.generation===g.generation);
 if(!thread){thread={id:attempt.threadId,actor:actor.id,role:actor.role,generation:g.generation,companyId:c.id,messages:[]};threads.push(thread);}
 thread.messages.push({id:`${input.id}-human`,requestId:input.id,role:'user',text:input.text,at:g.tick,refs:input.changeId?[input.changeId]:[]});return attempt;
}
export function finishAiAttempt(g:GameState,actor:Identity,id:string,state:string,code?:string){const attempt=g.companies[actor.companyId!]?.runtime.aiAttempts?.find(a=>a.actor===actor.id&&a.id===id);if(attempt){attempt.state=state;attempt.finishedAt=g.tick;attempt.code=code;}}
