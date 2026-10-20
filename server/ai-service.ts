import type { GameState, Identity } from '../shared/types.js';
import type { AiInput, AiProposal } from '../shared/collaboration.js';
import { collaboration, editableChange } from './collaboration.js';
import { employeeFor, stableDigest } from './discipline.js';
import { AiError, AiGateway, parseAiInput, proposalVariation } from './claude.js';

export function aiContext(g:GameState,actor:Identity,input:AiInput) {
  const employee=employeeFor(g,actor);
  if(actor.companyId===null||employee?.status!=='ACTIVE'||employee.role!==actor.role||employee.companyId!==actor.companyId||g.status!=='RUNNING')throw new AiError('FORBIDDEN','Operación no autorizada.');
  const c=g.companies[actor.companyId];if(c.eliminated)throw new AiError('FORBIDDEN');
  if(input.kind==='backend.propose'){
    if(actor.role!=='backend')throw new AiError('FORBIDDEN');
    return {c,graph:c.drafts.backend?.graph??c.backend,revision:c.drafts.backend?.revision??0};
  }
  if(actor.role!=='security')throw new AiError('FORBIDDEN','Operación no autorizada.');
  const {ch,draft}=editableChange(g,actor,input.changeId!,input.nodeId);
  return {c,graph:ch.graph,revision:draft.revision};
}
export async function prepareAi(g:GameState,actor:Identity,raw:unknown,gateway:AiGateway):Promise<AiProposal> {
  const input=parseAiInput(raw),context=aiContext(g,actor,input),state=collaboration(context.c);
  const digest=stableDigest({input,generation:g.generation,actor,revision:context.revision,graph:context.graph});
  const prior=state.proposals.find(p=>p.id===input.id&&p.actor===actor.id);
  if(prior){if(prior.inputDigest!==digest)throw new AiError('ID_CONFLICT','ID de solicitud ya utilizado.');return structuredClone(prior);}
  if(state.proposals.length>=240)throw new AiError('AI_LIMIT','Límite de propuestas de la partida alcanzado.');
  const output=await gateway.generate(actor.id,input,structuredClone(context.graph));
  return {id:input.id,actor:actor.id,companyId:context.c.id,generation:g.generation,kind:input.kind,inputDigest:digest,changeId:input.changeId,nodeId:input.nodeId,sourceText:input.kind==='security.compile'?input.text:undefined,output:input.kind==='backend.propose'?proposalVariation(output,`${g.seed}:${g.generation}:${context.c.id}:${digest}`):output,provider:gateway.provider.name,model:gateway.provider.model,status:'PENDING',at:g.tick,draftRevision:context.revision};
}
/** Recheck after network I/O: reset, logout, expulsion and edits cannot race a reply. */
export function commitAi(g:GameState,actor:Identity,raw:unknown,proposal:AiProposal) {
  const input=parseAiInput(raw),context=aiContext(g,actor,input);
  const digest=stableDigest({input,generation:g.generation,actor,revision:context.revision,graph:context.graph});
  if(proposal.actor!==actor.id||proposal.generation!==g.generation||proposal.inputDigest!==digest)throw new AiError('STALE','La versión cambió durante la solicitud.');
  const state=collaboration(context.c),prior=state.proposals.find(p=>p.id===proposal.id&&p.actor===actor.id);
  if(prior){if(prior.inputDigest!==digest)throw new AiError('ID_CONFLICT');return prior;}
  if(state.proposals.length>=240)throw new AiError('AI_LIMIT');state.proposals.push(structuredClone(proposal));return proposal;
}
export function visibleProposal(proposal:AiProposal){return {id:proposal.id,kind:proposal.kind,provider:proposal.provider,model:proposal.model,...(proposal.kind==='security.compile'?{executable:proposal.output.executable}:proposal.output)};}
