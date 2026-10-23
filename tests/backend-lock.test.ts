import test from 'node:test';
import assert from 'node:assert/strict';
import { workflow } from '../server/workflow.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { DEFAULT_TEST } from '../shared/actions.js';
import type { Change, ChangeStatus, GameState } from '../shared/types.js';
import { advanceGame, assembledGame, command, insertBlock, publishPromotion, reviewForQa } from './helpers.js';

// purchase-flow stays frozen while its change is in the cycle and frees itself once the change leaves it for good.
const start=()=>{const g=assembledGame();g.status='RUNNING';return g;};
const revision=(g:GameState)=>g.companies[0].drafts.backend?.revision??0;
const edit=(g:GameState)=>command(g,'backend','draft.save',{graph:g.companies[0].drafts.backend?.graph??g.companies[0].backend,revision:revision(g)});
function submit(g:GameState,graph=insertBlock('atomic')){const r=command(g,'backend','change.submit',{graph,revision:revision(g)});assert(r.ok,r.error);return g.changes.find(ch=>ch.id===r.refs![0])!;}
function frozen(g:GameState,ch:Change,status:ChangeStatus){assert.equal(ch.status,status);assert.equal(workflow(g.companies[0]).backendLock?.changeId,ch.id,status);assert.equal(edit(g).ok,false,status);}
/** Seguridad → QA → CTO → DevOps for one Backend change, checking the freeze at every stage it passes. */
function cycle(g:GameState,ch:Change){
 frozen(g,ch,'SECURITY_PENDING');reviewForQa(g,ch.id);frozen(g,ch,'QA_PENDING');
 assert(command(g,'qa','qa.execute',{changeId:ch.id,scenario:DEFAULT_TEST}).ok);frozen(g,ch,'QA_RUNNING');advanceGame(g,15);
 const runs=workflow(g.companies[0]).runs.filter(r=>r.changeId===ch.id&&r.report).map(r=>r.id);
 assert(command(g,'qa','qa.review',{changeId:ch.id,risks:'Acepto continuar con el alcance de estas pruebas.',evidenceIds:runs}).ok);frozen(g,ch,'CTO_PENDING');
 assert(command(g,'cto','cto.decide',{changeId:ch.id,decision:'authorize',reason:'Decido publicar.',confirmed:true}).ok);frozen(g,ch,'AUTHORIZED');
 assert(command(g,'devops','deploy.start',{strategy:'rolling'},ch.id).ok);frozen(g,ch,'DEPLOYING');
}

test('a deployed change frees Backend, and a second change runs the whole cycle and frees it again',()=>{
 const g=start(),c=g.companies[0],first=submit(g);cycle(g,first);advanceGame(g,7);
 assert.equal(first.status,'DEPLOYED');assert.equal(workflow(c).backendLock,undefined);assert(edit(g).ok);
 const second=submit(g,insertBlock('idempotency','write',60,c.backend));assert.equal(second.implementation!.backendVersion,2);cycle(g,second);advanceGame(g,7);
 assert.equal(second.status,'DEPLOYED');assert.equal(second.releasedVersion,c.version);assert.equal(workflow(c).backendLock,undefined);assert(edit(g).ok);
});

test('a publication that fails for lack of money frees Backend',()=>{
 const g=start(),c=g.companies[0],ch=submit(g);cycle(g,ch);c.capital=ch.cost-1;advanceGame(g,7);
 assert.equal(ch.status,'DEPLOY_FAILED');assert.equal(workflow(c).backendLock,undefined);assert(edit(g).ok);
});

test('a change made stale by another publication frees Backend',()=>{
 const g=start(),c=g.companies[0],ch=submit(g);reviewForQa(g,ch.id);frozen(g,ch,'QA_PENDING');
 const promotion=publishPromotion(g,{catalogId:'PROMO-01',percent:10,duration:60,demandMultiplier:2,budget:200});advanceGame(g,7);
 assert.equal(promotion.status,'DEPLOYED');assert.equal(ch.status,'STALE');assert.equal(workflow(c).backendLock,undefined);assert(edit(g).ok);
});

test('an eliminated company no longer holds a frozen change',()=>{
 const g=start(),c=g.companies[0],ch=submit(g);c.capital=0;c.bankruptTicks=30;advanceGame(g,.1);
 assert(c.eliminated);assert.equal(ch.status,'STALE');assert.equal(workflow(c).backendLock,undefined);
});

test('a reloaded game drops a lock left on a published change and keeps one on a change in review',()=>{
 const g=start(),c=g.companies[0],ch=submit(g);cycle(g,ch);advanceGame(g,7);assert.equal(ch.status,'DEPLOYED');
 // Saves written before the fix still name the published change in the lock.
 workflow(c).backendLock={featureId:'purchase-flow',changeId:ch.id,at:ch.created};
 const stale=recoverGame(serializeGame(g));assert.equal(stale.companies[0].runtime.workflow!.backendLock,undefined);
 command(stale,'operator','room.start');assert(edit(stale).ok);
 // Pre-workflow saves rebuild the lock only from a change that is still in the cycle.
 const legacy=JSON.parse(serializeGame(g));delete legacy.companies[0].runtime.workflow;assert.equal(recoverGame(JSON.stringify(legacy)).companies[0].runtime.workflow?.backendLock,undefined);
 const review=start(),pending=submit(review);reviewForQa(review,pending.id);
 assert.equal(recoverGame(serializeGame(review)).companies[0].runtime.workflow!.backendLock?.changeId,pending.id);
});
