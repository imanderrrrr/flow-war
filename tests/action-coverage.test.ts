import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame, project } from '../server/engine.js';
import { admitTraffic, advanceTraffic } from '../server/traffic.js';
import { admitSecurity } from '../server/security.js';
import { DEFAULT_TEST } from '../shared/actions.js';
import { command, advanceGame, insertBlock , reviewForQa } from './helpers.js';
import { defectFixture } from './defect-fixtures.js';
import { createConcurrencyRun, advanceConcurrency } from '../server/requests.js';
import { recoverGame, serializeGame } from '../server/persistence.js';

const cases = [
  ['backend','module.create',{name:'x',configuration:{kind:'inventory',minimum:1},dependencies:[]},'infra.restart_all',{duration:10}],
  ['security','security.prepare',{auth:true,authorization:true,waf:true,botThreshold:80,blockedOrigins:[],rate:null},'module.create',{name:'x',configuration:{kind:'inventory',minimum:1},dependencies:[]}],
  ['qa','qa.execute',{},'module.create',{name:'x',configuration:{kind:'inventory',minimum:1},dependencies:[]}],
  ['cto','cto.budget',{amount:1000},'deploy.start',{strategy:'rolling'}],
  ['devops','infra.restart_all',{duration:10},'cto.budget',{amount:1000}],
  ['product','product.draft',{catalogId:'PROMO-02',percent:15,duration:120,budget:250,demandMultiplier:2},'campaign.authorize',{campaignId:'x'}],
] as const;
for (const [role,allowed,params,denied,other] of cases) {
  test(`4A role ${role} executes its supported operation through the common catalog`, () => {
    const g=createGame();g.status='RUNNING';if(role==='product')g.productEnabled=true;
    if(role==='qa') {command(g,'backend','module.create',{name:'QA',configuration:{kind:'inventory',minimum:1},dependencies:[]});reviewForQa(g);assert.equal(command(g,role,allowed,{changeId:g.changes[0].id,scenario:DEFAULT_TEST}).ok,true);}
    else assert.equal(command(g,role,allowed,{...params}).ok,true);
    assert.equal(g.actions.employees[`0-${role}`].violations.length,0);
  });
  test(`4A role ${role} cannot perform the exclusive operation ${denied}`, () => {
    const g=createGame();g.status='RUNNING';const before=structuredClone(g.companies);
    assert.equal(command(g,role,denied,{...other}).code,'FORBIDDEN');assert.deepEqual(g.companies,before);assert.equal(g.actions.employees[`0-${role}`].violations.length,1);
  });
}
test('4A real 20/minute per-origin limiter tracks windows, isolates origins and preserves counters on recovery', () => {
  const g=createGame();g.status='RUNNING';command(g,'security','security.prepare',{auth:false,authorization:false,waf:false,botThreshold:0,blockedOrigins:[],rate:{limit:20,windowSeconds:60,groupBy:'origin',scope:'all',exceed:'reject'}});
  const c=g.companies[0],release=g.changes[0].context!.execution!;c.runtime.releases[1]=release;
  for(let i=0;i<20;i++)assert.equal(admitSecurity(c,release,'valid',i,10,'sim-1',`qa-${i}`,'purchase'),true);
  assert.equal(admitSecurity(c,release,'valid',20,11,'sim-1','qa-20','purchase'),false);
  assert.equal(admitSecurity(c,release,'valid',20,11,'sim-2','qa-20','purchase'),true);
  const restored=recoverGame(serializeGame(g)),other=restored.companies[0];assert.equal(admitSecurity(other,other.runtime.releases[1],'valid',21,12,'sim-1','qa-21','purchase'),false);
  assert.equal(admitSecurity(other,other.runtime.releases[1],'valid',22,60,'sim-1','qa-22','purchase'),true);
});
test('4A harmful security parameters reject real legitimate traffic only after authorized publication', () => {
  const g=createGame();g.status='RUNNING';command(g,'security','security.prepare',{auth:false,authorization:true,waf:false,botThreshold:0,blockedOrigins:['sim-0'],rate:{limit:1,windowSeconds:60,groupBy:'origin',scope:'all',exceed:'reject'}});
  const ch=g.changes[0],c=g.companies[0];const r=admitTraffic(c,0,'purchase');assert.equal(r.securityAllowed,true);
  command(g,'qa','qa.run',{suite:'Unitarias'},ch.id);advanceGame(g,1);command(g,'qa','qa.approve',{},ch.id);command(g,'cto','cto.authorize',{},ch.id);command(g,'devops','deploy.start',{strategy:'rolling'},ch.id);advanceGame(g,7);
  assert.equal(ch.status,'DEPLOYED');assert.equal(admitSecurity(c,c.runtime.releases[c.version],'valid',0,g.tick,'sim-0','qa','purchase'),false);
});
test('4A T14 newly published modules cannot change a request admitted on the previous release', () => {
  const g=defectFixture('coupon','D02'),ch=g.changes[0],c=g.companies[0];
  const previous=admitTraffic(c,0,'purchase');command(g,'qa','qa.execute',{changeId:ch.id,scenario:DEFAULT_TEST});advanceGame(g,1);command(g,'qa','qa.approve',{},ch.id);command(g,'cto','cto.authorize',{},ch.id);command(g,'devops','deploy.start',{strategy:'rolling'},ch.id);advanceGame(g,7);
  const current=admitTraffic(c,g.tick,'purchase');current.newCustomer=true;current.couponCount=1;advanceGame(g,4);
  assert.equal(previous.executionVersion,1);assert.equal(previous.result?.revenue,45);assert.equal(current.executionVersion,2);assert.equal(current.result?.revenue,36);
});
test('4A D06 activates under declared load and actually delays a module, without appearing at low load', () => {
  const g=defectFixture('coupon','D06');
  const busy=createConcurrencyRun('busy',g.changes[0].context!,0),quiet=createConcurrencyRun('quiet',g.changes[0].context!,0);busy.requests.forEach(r=>r.loadDepth=40);
  for(let i=1;i<=150;i++){advanceConcurrency(busy,i/10);advanceConcurrency(quiet,i/10);}
  assert.ok(busy.requests[0].result!.at>=quiet.requests[0].result!.at+1.5);assert.ok(busy.requests[0].effectCodes?.includes('D06'));assert.ok(!quiet.requests[0].effectCodes?.includes('D06'));
});
test('4A a graph cannot forge another company module reference or bypass artifact validation', () => {
  const g=createGame();g.status='RUNNING';const graph=insertBlock('module','payment');graph.nodes.find(n=>n.type==='module')!.data.module={id:'C1-M1',version:1};
  assert.equal(command(g,'backend','change.submit',{graph,revision:0}).ok,false);assert.equal(g.changes.length,0);assert.equal(g.companies[0].drafts.backend,undefined);
});
test('4A public, foreign, own-role and teacher projections omit frozen bundles and all internal defect state', () => {
  const g=defectFixture('coupon','D02');for(const identity of [null,{id:'0-backend',role:'backend' as const,companyId:0},{id:'1-qa',role:'qa' as const,companyId:1},{id:'operator',role:'operator' as const,companyId:null}]) {
    const view=project(g,identity),serialized=JSON.stringify(view);for(const key of ['defects','effectCodes','rateBuckets','operationsState','releases'])assert.ok(!serialized.includes(`"${key}"`));
    if(identity?.companyId===1)assert.equal(view.operations!.modules.length,0);
  }
});
test('4A schema4 migration preserves 5000 clients and old request semantics; schema5 recovery freezes graph and bundles once', () => {
  const g=createGame();g.status='RUNNING';const r=admitTraffic(g.companies[0],0,'purchase');const legacy=JSON.parse(serializeGame(g));legacy.schema=4;delete legacy.actions;
  for(const c of legacy.companies) {for(const req of Object.values(c.traffic.requests) as any[]) {delete req.execution;delete req.executor;}delete c.runtime;delete c.infrastructure;}
  const restored=recoverGame(JSON.stringify(legacy));assert.equal(restored.schema,6);assert.equal(Object.keys(restored.market.customers).length,5000);assert.equal(restored.companies[0].traffic.requests[r.id].executor,'requests-1');
  assert.equal(Object.keys(restored.actions.employees).length,30);command(restored,'operator','room.start');advanceGame(restored,4);assert.equal(restored.companies[0].traffic.requests[r.id]?.result?.revenue??restored.companies[0].traffic.totals.revenue,45);
});
test('4A a duplicate forbidden structured order stays counted once across a durable snapshot', () => {
  const g=createGame();g.status='RUNNING';const identity={id:'0-backend',role:'backend' as const,companyId:0},action={version:1,id:'denial',companyId:0,type:'infra.restart_all',parameters:{duration:10},source:'agent'};
  const cmd={id:'transport-a',type:'action.execute',payload:{action}};assert.equal(applyCommand(g,identity,cmd).code,'FORBIDDEN');const restored=recoverGame(serializeGame(g));assert.equal(applyCommand(restored,identity,{...cmd,id:'transport-b'}).code,'FORBIDDEN');assert.equal(restored.actions.employees[identity.id].violations.length,1);
});
