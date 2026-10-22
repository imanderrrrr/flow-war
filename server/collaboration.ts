import { lockBackend, assertBackendEditable } from './workflow.js';
import type { Company, GameState, Change, Identity, Result } from '../shared/types.js';
import type { AiProposal, CollaborationState, CollaborationView, ProtectionRule } from '../shared/collaboration.js';
import { stableDigest, employeeFor } from './discipline.js';
import { validateParameters, object, keys, integer, oneOf, string } from './action-validation.js';

export function collaboration(c: Company): CollaborationState { return c.runtime.collaboration ??= { nextVersion: 1, reviews: {}, proposals: [] }; }
export function beginSecurityReview(g: GameState, c: Company, ch: Change) {
  assertBackendEditable(c);
  const state = collaboration(c);
  // A newer functional revision requires a new explicit decision, including unchanged blocks.
  for (const old of g.changes) if (old.id !== ch.id && old.companyId === c.id && old.implementation && !['DEPLOYED','DEPLOY_FAILED','STALE','QA_REJECTED','CTO_REJECTED'].includes(old.status)) {
    if(old.status==='DEPLOYING')throw new Error('Espera a que finalice la publicación en curso.');
  }
  for (const old of g.changes) if (old.id !== ch.id && old.companyId === c.id && old.implementation && ['SECURITY_PENDING','QA_PENDING','QA_RUNNING','CTO_PENDING','AUTHORIZED','EXPIRED'].includes(old.status)) {
    old.status = 'STALE'; c.reserved = Math.max(0, c.reserved - old.reserved); old.reserved = 0;
    old.reports.forEach(r => r.obsolete = true); delete old.testJob; delete old.qaScenario; delete old.qaLoad;
  }
  ch.implementation = { featureId: 'purchase-flow', backendVersion: state.nextVersion++, backendAuthor: ch.actorId, graphDigest: stableDigest(ch.graph) };
  const returned=c.runtime.workflow?.letters.slice().reverse().find(l=>l.recipient==='backend'&&!l.successorId);if(returned){ch.parentChangeId=returned.changeId;returned.successorId=ch.id;}
  lockBackend(c,ch,g.tick);
  ch.status = 'SECURITY_PENDING'; state.reviews[ch.id] = { revision: 0, blocks: {}, observations: [] };
  // No protection is inherited implicitly from a different functional version.
  delete ch.context!.execution!.security; ch.context!.execution!.blockPolicies = [];
}
export function rules(input: unknown): ProtectionRule[] {
  if(!Array.isArray(input)||input.length>12)throw new Error('Política inválida.');
  return input.map(value=>{ const p=object(value); const kind=oneOf(p.kind,['authenticated','owner','input','bot','origin','rate']);
    if(kind==='rate'){keys(p,['kind','limit','windowSeconds','groupBy']);return {kind,limit:integer(p.limit,1,10000),windowSeconds:integer(p.windowSeconds,1,300),groupBy:oneOf(p.groupBy,['origin','customer'])};}
    if(kind==='origin'){keys(p,['kind','origin']);const origin=string(p.origin);if(!/^sim-\d{1,3}$/.test(origin))throw new Error('Origen inválido.');return {kind,origin};}
    keys(p,['kind']);return {kind};
  });
}
export function editableChange(g: GameState, identity: Identity, changeId: string, nodeId?: string) {
  if(identity.companyId===null||identity.role!=='security'||employeeFor(g,identity)?.status!=='ACTIVE'||g.status!=='RUNNING')throw new Error('Operación no autorizada.');
  const c=g.companies[identity.companyId],ch=g.changes.find(ch=>ch.id===changeId&&ch.companyId===c.id);
  if(c.eliminated||!ch?.implementation||ch.status!=='SECURITY_PENDING'||ch.baseVersion!==c.version)throw new Error('Revisión no disponible.');
  if(nodeId&&!ch.graph.nodes.some(n=>n.id===nodeId))throw new Error('Bloque no encontrado.');
  return {c,ch,draft:collaboration(c).reviews[ch.id]};
}
export function securityCommand(g: GameState, actor: Identity, type: string, p: Record<string, unknown>): Result {
  validateParameters(type,p);
  const {c,ch,draft}=editableChange(g,actor,String(p.changeId),p.nodeId as string|undefined);
  if(type==='security.correction'){
    if(draft.observations.length>=80)throw new Error('Límite de observaciones.');
    draft.observations.push({nodeId:String(p.nodeId),text:String(p.text),author:actor.id,at:g.tick});return {ok:true,refs:[ch.id,String(p.nodeId)]};
  }
  if(p.revision!==draft.revision)throw new Error('La revisión cambió. Recarga el borrador.');
  if(type==='security.configure'){
    // Structured control editor: the stored text describes exactly the configured rules.
    const nodeId=String(p.nodeId),compiled=rules(p.rules);
    draft.blocks[nodeId]={text:describeControls(compiled),rules:compiled,executable:true,author:actor.id,structured:true};draft.revision++;
    return {ok:true,refs:[ch.id,nodeId]};
  }
  if(type==='security.save'){
    const text=String(p.text),nodeId=String(p.nodeId);
    let compiled:ProtectionRule[]=[],executable=!text.trim();
    if(p.interpretationId){
      const receipt=collaboration(c).proposals.find(r=>r.id===p.interpretationId&&r.actor===actor.id&&r.kind==='security.compile'&&r.changeId===ch.id&&r.nodeId===nodeId&&r.sourceText===text&&r.generation===g.generation&&r.draftRevision===draft.revision);
      if(!receipt)throw new Error('Interpretación no vigente para este texto y versión.');
      compiled=rules(receipt.output.rules);executable=receipt.output.executable===true;receipt.status='ACCEPTED';
    }
    draft.blocks[nodeId]={text,rules:compiled,executable,author:actor.id,...(p.interpretationId?{interpretationId:String(p.interpretationId)}:{})};draft.revision++;
    return {ok:true,refs:[ch.id,nodeId],...(!executable?{code:'UNINTERPRETED'}:{})};
  }
  const blocks=ch.graph.nodes.map(n=>({nodeId:n.id,rules:structuredClone(draft.blocks[n.id]?.rules??[])}));
  ch.implementation!.security={revision:draft.revision,author:actor.id,at:g.tick,blocks,digest:stableDigest(blocks)};
  ch.context!.execution!.blockPolicies=blocks;
  ch.implementation!.bundleDigest=stableDigest([ch.companyId,ch.implementation!.featureId,ch.implementation!.backendVersion,ch.graph,ch.context!.execution,ch.artifactRefs??[],ch.implementation!.security]);
  ch.context!.execution!.bundleDigest=ch.implementation!.bundleDigest;
  ch.status='QA_PENDING';return {ok:true,refs:[ch.id]};
}
export function describeControls(list: ProtectionRule[]): string {
  if(!list.length)return '';
  const names={authenticated:'Auth',owner:'Role Check',input:'WAF',bot:'Bot Detection'} as const;
  return list.map(r=>r.kind==='rate'?`Rate Limit ${r.limit} solicitudes / ${r.windowSeconds} s por ${r.groupBy==='origin'?'origen':'cliente'}`:r.kind==='origin'?`IP Block ${r.origin}`:names[r.kind]).join('; ');
}
export function assertBundle(ch: Change) {
  if(!ch.implementation)return; // Historical releases retain their original contract.
  const i=ch.implementation,execution=structuredClone(ch.context?.execution);if(execution)delete execution.bundleDigest;
  if(!i.security||i.graphDigest!==stableDigest(ch.context?.backend)||i.graphDigest!==stableDigest(ch.graph)||i.bundleDigest!==stableDigest([ch.companyId,i.featureId,i.backendVersion,ch.graph,execution,ch.artifactRefs??[],i.security]))throw new Error('La combinación revisada no coincide.');
}
export function collaborationView(c: Company, actor: Identity): CollaborationView|undefined {
  if(!['backend','security','qa','cto','operator'].includes(actor.role))return;
  const state=c.runtime.collaboration;if(!state)return;
  return {reviews:Object.fromEntries(Object.entries(state.reviews).map(([id,r])=>[id,{revision:r.revision,blocks:actor.role==='security'?Object.fromEntries(Object.entries(r.blocks).map(([id,b])=>[id,{text:b.text,executable:b.executable,author:b.author,rules:structuredClone(b.rules),structured:!!b.structured}])):{},observations:structuredClone(r.observations)}])),proposals:state.proposals.filter(p=>p.actor===actor.id).map(({output,inputDigest,sourceText,...p})=>p)};
}
export function proposalCommand(c: Company, actor: Identity, type: string, p: Record<string,unknown>): Result {
  const proposal=collaboration(c).proposals.find(r=>r.id===p.proposalId&&r.actor===actor.id&&r.kind!=='security.compile');
  if(!proposal||proposal.status!=='PENDING')throw new Error('Propuesta no disponible.');
  if(type==='ai.reject'){proposal.status='REJECTED';return {ok:true,refs:[proposal.id]};}
  if(proposal.kind==='backend.propose'){
    assertBackendEditable(c);
    if(actor.role!=='backend'||proposal.draftRevision!==(c.drafts.backend?.revision??0))throw new Error('El borrador cambió.');
    c.drafts.backend={graph:structuredClone(proposal.output.graph!),revision:proposal.draftRevision+1};
  }else{
    if(actor.role!=='security')throw new Error('Rol incompatible.');
    const draft=collaboration(c).reviews[proposal.changeId!];
    if(!draft||draft.revision!==proposal.draftRevision)throw new Error('El borrador cambió.');
    draft.blocks[proposal.nodeId!]={text:proposal.output.text!,rules:[],executable:false,author:actor.id};draft.revision++;
  }
  proposal.status='ACCEPTED';return {ok:true,refs:[proposal.id]};
}

/** Compatibility adapter: existing structured actions review the deployed Backend graph. */
export function bindLegacySecurity(g:GameState,c:Company,ch:Change){
 const deployed=g.changes.find(old=>old.companyId===c.id&&old.status==='DEPLOYED'&&old.implementation);
 ch.graph=structuredClone(ch.context!.backend);
 ch.implementation={featureId:'purchase-flow',backendVersion:deployed?.implementation?.backendVersion??0,backendAuthor:deployed?.implementation?.backendAuthor??'legacy',graphDigest:stableDigest(ch.graph),security:{revision:0,author:ch.actorId,at:g.tick,blocks:[],digest:stableDigest(ch.context!.execution!.security)}};
 ch.implementation.bundleDigest=stableDigest([ch.companyId,ch.implementation.featureId,ch.implementation.backendVersion,ch.graph,ch.context!.execution,ch.artifactRefs??[],ch.implementation.security]);
 ch.context!.execution!.bundleDigest=ch.implementation.bundleDigest;
}
