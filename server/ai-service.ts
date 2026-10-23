import type { GameState, Identity } from '../shared/types.js';
import type { AiInput, AiProposal, ProtectionRule } from '../shared/collaboration.js';
import { collaboration, editableChange } from './collaboration.js';
import { employeeFor, stableDigest } from './discipline.js';
import { AiError, AiGateway, parseAiInput } from './claude.js';
import { workflow } from './workflow.js';
import { groundNumber, mentionsId, normalize, GroundingError } from './grounding.js';
import { screenInstruction } from './scope.js';

const compactLetter=(l:import('../shared/workflow.js').ReturnLetter)=>({id:l.id,changeId:l.changeId,recipient:l.recipient,author:l.author,at:l.at,subject:l.subject.slice(0,160),description:l.description.slice(0,400),steps:l.steps.slice(0,400),observed:l.observed.slice(0,400),expected:l.expected.slice(0,400),evidenceIds:l.evidenceIds.slice(0,8),truncated:[l.subject,l.description,l.steps,l.observed,l.expected].some(t=>t.length>400)});
/** security.compile: interprets the protection text the Security student wrote for one delivered block. */
export function aiContext(g:GameState,actor:Identity,input:AiInput) {
  const employee=employeeFor(g,actor);
  if(actor.companyId===null||employee?.status!=='ACTIVE'||employee.role!==actor.role||employee.companyId!==actor.companyId||g.status!=='RUNNING')throw new AiError('FORBIDDEN','Operación no autorizada.');
  const c=g.companies[actor.companyId];if(c.eliminated)throw new AiError('FORBIDDEN');
  if(actor.role!=='security'||input.kind!=='security.compile')throw new AiError('FORBIDDEN','Operación no autorizada.');
  const {ch,draft}=editableChange(g,actor,input.changeId!,input.nodeId);
  return {c,graph:ch.graph,revision:draft.revision,context:{letters:workflow(c).letters.filter(l=>l.recipient==='security').slice(-3).map(compactLetter)}};
}
function digestFor(g:GameState,actor:Identity,input:AiInput,ctx:ReturnType<typeof aiContext>){return stableDigest({input,generation:g.generation,actor,revision:ctx.revision,graph:ctx.graph,change:input.changeId?g.changes.find(ch=>ch.id===input.changeId)?.implementation?.bundleDigest:undefined});}
/** Words that state each control without a number; a compiled rule of that kind needs one of them in the text. */
const RULE_WORDS:Record<'authenticated'|'owner'|'input'|'bot',RegExp>={
  authenticated:/\b(auth\w*|autentic\w*|sesion\w*|login|logue\w*|credencial\w*|identific\w*|usuarios? registrados?)\b/,
  owner:/\b(propi\w*|duen\w*|pertenec\w*|role check|rol|roles|suy[oa]s?|ajen[oa]s?|titular\w*)\b/,
  input:/\b(inyecc\w*|inyect\w*|malicios\w*|entradas?|waf|sanitiz\w*|caracter\w*|scripts?|sql|datos invalidos)\b/,
  bot:/\b(bots?|automatiz\w*|robots?|automatic\w*)\b/,
};
/** Every compiled rule must be written in the student's protection text: its control, and its thresholds and origins. */
export function rulesGrounded(rules:ProtectionRule[],text:string){
  const source=[normalize(text)];
  try{for(const r of rules){if(r.kind==='rate'){groundNumber('limit',r.limit,source);groundNumber('window',r.windowSeconds,source,'seconds');}else if(r.kind==='origin'){if(!mentionsId(r.origin,source))return false;}else if(!RULE_WORDS[r.kind].test(source[0]))return false;}return true;}
  catch(e){if(e instanceof GroundingError)return false;throw e;}
}
export async function prepareAi(g:GameState,actor:Identity,raw:unknown,gateway:AiGateway):Promise<AiProposal> {
  const input=parseAiInput(raw),context=aiContext(g,actor,input),state=collaboration(context.c),digest=digestFor(g,actor,input,context);
  const prior=state.proposals.find(p=>p.id===input.id&&p.actor===actor.id);
  if(prior){if(prior.inputDigest!==digest)throw new AiError('ID_CONFLICT','ID de solicitud ya utilizado.');return structuredClone(prior);}
  if(state.proposals.length>=240)throw new AiError('AI_LIMIT','Límite de interpretaciones de la partida alcanzado.');
  if(JSON.stringify(context.context).length>48000)throw new AiError('CONTEXT_LIMIT','El contexto seleccionado excede el límite.');
  const output=await gateway.generate(actor.id,input,structuredClone(context.graph),context.c.id,structuredClone(context.context));
  // Out of scope (another company, a change of rules, an unrelated request) or ungrounded: nothing compiles.
  if(output.rules?.length&&(screenInstruction(g,context.c.id,[input.text])||!rulesGrounded(output.rules,input.text))){output.rules=[];output.executable=false;}
  return {id:input.id,actor:actor.id,companyId:context.c.id,generation:g.generation,kind:input.kind,inputDigest:digest,changeId:input.changeId,nodeId:input.nodeId,sourceText:input.text,requestText:input.text,threadId:input.threadId??`${actor.role}-default`,output,provider:gateway.provider.name,model:gateway.provider.model,status:'PENDING',at:g.tick,draftRevision:context.revision};
}
/** Recheck after network I/O: reset, logout, expulsion and edits cannot race a reply. */
export function commitAi(g:GameState,actor:Identity,raw:unknown,proposal:AiProposal) {
  const input=parseAiInput(raw),context=aiContext(g,actor,input),digest=digestFor(g,actor,input,context);
  if(proposal.actor!==actor.id||proposal.generation!==g.generation||proposal.companyId!==actor.companyId||proposal.inputDigest!==digest)throw new AiError('STALE','La versión cambió durante la solicitud.');
  const state=collaboration(context.c),prior=state.proposals.find(p=>p.id===proposal.id&&p.actor===actor.id);
  if(prior){if(prior.inputDigest!==digest)throw new AiError('ID_CONFLICT');return prior;}
  if(state.proposals.length>=240)throw new AiError('AI_LIMIT');state.proposals.push(structuredClone(proposal));
  return proposal;
}
export function proposalText(_g:GameState,_actor:Identity,p:AiProposal){return p.output.executable?'Interpretación registrada. Guárdala para aplicarla al bloque.':'El texto no contiene reglas ejecutables reconocidas.';}
export function visibleProposal(proposal:AiProposal){return {id:proposal.id,kind:proposal.kind,provider:proposal.provider,model:proposal.model,executable:proposal.output.executable};}

export function beginAiAttempt(g:GameState,actor:Identity,raw:unknown){const input=parseAiInput(raw),ctx=aiContext(g,actor,input),c=ctx.c,attempts=c.runtime.aiAttempts??=[],digest=stableDigest(input);
 const prior=attempts.find(r=>r.actor===actor.id&&r.id===input.id);if(prior){if(prior.digest!==digest)throw new AiError('ID_CONFLICT');return prior;}
 if(attempts.length>=480)throw new AiError('AI_LIMIT');
 const attempt={id:input.id,actor:actor.id,role:actor.role,generation:g.generation,threadId:input.threadId??`${actor.role}-default`,digest,state:'QUEUED',at:g.tick};attempts.push(attempt);return attempt;
}
export function finishAiAttempt(g:GameState,actor:Identity,id:string,state:string,code?:string){const attempt=g.companies[actor.companyId!]?.runtime.aiAttempts?.find(a=>a.actor===actor.id&&a.id===id);if(attempt){attempt.state=state;attempt.finishedAt=g.tick;attempt.code=code;}}
