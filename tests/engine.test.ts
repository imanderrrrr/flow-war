import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame, evaluateSecurity, initialGraph, inventoryBatch, project, route, step, validateGraph } from '../server/engine.js';
import type { Graph, Identity, Role, GameState } from '../shared/types.js';
const identity=(role:Role|'operator',companyId:number|null=0):Identity=>({id:`${companyId}-${role}`,role,companyId});
let sequence=0;
const command=(g:GameState,role:Role|'operator',type:string,payload:Record<string,unknown>={},changeId?:string,companyId=0)=>applyCommand(g,identity(role,role==='operator'?null:companyId),{id:`test-${++sequence}`,type,companyId,payload,changeId});
function insert(graph:Graph,type:string,before:string):Graph {
  const g=structuredClone(graph),target=g.nodes.find(n=>n.type===before)!,edge=g.edges.find(e=>e.target===target.id)!;
  g.nodes.push({id:`node-${type}`,type,position:{x:200,y:300},data:{label:type,value:2}});
  g.edges=g.edges.filter(e=>e.id!==edge.id);g.edges.push({id:`${type}-in`,source:edge.source,target:`node-${type}`},{id:`${type}-out`,source:`node-${type}`,target:target.id});return g;
}
test('five companies begin with equal market and independent state',()=>{const g=createGame();assert.equal(g.companies.length,5);for(const c of g.companies){assert.equal(c.customers,1000);assert.equal(c.capital,10000);}g.companies[0].backend.nodes.pop();assert.equal(g.companies[1].backend.nodes.length,5);});
test('permissions reject cross-role and cross-company commands',()=>{const g=createGame();g.status='RUNNING';const before=structuredClone(g);assert.equal(command(g,'backend','deploy.start').code,'FORBIDDEN');assert.equal(applyCommand(g,identity('qa',1),{id:'x',type:'qa.run',companyId:0}).code,'FORBIDDEN');assert.deepEqual(g.companies,before.companies);assert.equal(g.actions.employees['0-backend'].violations.length,1);});
test('disconnected pieces have no runtime effect',()=>{const g=initialGraph('security');g.nodes.push({id:'unused-auth',type:'auth',position:{x:0,y:0},data:{label:'Auth'}});assert.equal(evaluateSecurity(g,'forged'),true);assert.equal(route(g).length,2);});
test('security order and connection change actual request outcome',()=>{const proper=insert(insert(initialGraph('security'),'auth','exit'),'role','exit');const reversed=insert(insert(initialGraph('security'),'role','exit'),'auth','exit');assert.equal(evaluateSecurity(proper,'valid'),true);assert.equal(evaluateSecurity(proper,'forged'),false);assert.equal(evaluateSecurity(reversed,'valid'),false);});
test('inventory fixture exposes a race and respects atomic writes',()=>{const plain=initialGraph('backend');assert.equal(inventoryBatch(plain,40,20).oversold,20);const atomic=insert(plain,'atomic','write');assert.equal(inventoryBatch(atomic,40,20).oversold,0);assert.equal(inventoryBatch(atomic,40,20).completed,20);const late=insert(plain,'atomic','payment');assert.equal(inventoryBatch(late,40,20).oversold,20);});
test('graph compiler rejects cycles and missing execution paths',()=>{const g=initialGraph('backend');g.edges.push({id:'cycle',source:'backend-payment',target:'backend-entry'});assert.throws(()=>validateGraph(g,'backend'));const partial=initialGraph('security');partial.edges=[];assert.throws(()=>validateGraph(partial,'security'));});
test('incomplete drafts can be saved but cannot be submitted to QA',()=>{const g=createGame();g.status='RUNNING';const graph=initialGraph('backend');graph.edges=[];assert.equal(command(g,'backend','draft.save',{graph,revision:0}).ok,true);assert.equal(command(g,'backend','change.submit',{graph,revision:1}).ok,false);assert.equal(g.changes.length,0);});
test('pipeline freezes artifact and requires QA, CTO and DevOps',()=>{
  const g=createGame();g.status='RUNNING';const graph=insert(initialGraph('backend'),'atomic','write');
  assert.equal(command(g,'backend','change.submit',{graph,revision:0}).ok,true);const ch=g.changes[0];
  graph.nodes[0].data.label='modified locally';assert.notEqual(ch.graph.nodes[0].data.label,'modified locally');assert.equal(ch.status,'QA_PENDING');assert.equal(g.companies[0].version,1);
  assert.equal(command(g,'qa','qa.approve',{},ch.id).ok,false);assert.equal(command(g,'devops','deploy.start',{strategy:'rolling'},ch.id).ok,false);
  assert.equal(command(g,'qa','qa.run',{suite:'Concurrencia'},ch.id).ok,true);for(let i=0;i<41;i++)step(g);
  assert.equal(ch.reports[0].oversold,0);assert.equal(command(g,'qa','qa.approve',{},ch.id).ok,true);
  assert.equal(command(g,'cto','cto.authorize',{},ch.id).ok,true);assert.equal(g.companies[0].reserved,ch.cost);
  assert.equal(command(g,'devops','deploy.start',{strategy:'rolling'},ch.id).ok,true);for(let i=0;i<61;i++)step(g);
  assert.equal(ch.status,'DEPLOYED');assert.equal(g.companies[0].version,2);assert.equal(g.companies[0].deployments,1);assert.equal(g.companies[0].reserved,0);
  const capital=g.companies[0].capital;assert.equal(command(g,'devops','deploy.start',{strategy:'rolling'},ch.id).ok,false);assert.equal(g.companies[0].capital,capital);
});
test('QA runs in isolation and never applies a graph to production',()=>{const g=createGame();g.status='RUNNING';command(g,'security','change.submit',{graph:initialGraph('security'),revision:0});const ch=g.changes[0];command(g,'qa','qa.run',{suite:'Seguridad'},ch.id);for(let i=0;i<41;i++)step(g);assert.ok(ch.reports[0].breaches>0);assert.equal(g.companies[0].breaches,0);assert.equal(g.companies[0].version,1);});
test('expired authorization releases reserved funds',()=>{const g=createGame();g.status='RUNNING';command(g,'backend','change.submit',{graph:initialGraph('backend'),revision:0});const ch=g.changes[0];ch.status='CTO_PENDING';command(g,'cto','cto.authorize',{},ch.id);for(let i=0;i<601;i++)step(g);assert.equal(ch.status,'EXPIRED');assert.equal(g.companies[0].reserved,0);});
test('public and private projections do not leak other roles drafts or changes',()=>{const g=createGame();g.status='RUNNING';command(g,'backend','change.submit',{graph:initialGraph('backend'),revision:0});const pub=project(g,null),other=project(g,identity('qa',1));assert.equal(pub.changes.length,0);assert.equal(other.changes.length,0);assert.equal('backend' in pub.companies[0],false);assert.equal('drafts' in pub.companies[0],false);assert.equal(project(g,identity('qa')).privateCompany?.drafts.backend,undefined);});
test('market migrates progressively while preserving population',()=>{const g=createGame();g.status='RUNNING';g.companies[0].pressure=200;for(let i=0;i<1000;i++)step(g);assert.ok(g.companies[0].customers<1000);assert.equal(g.companies.reduce((sum,c)=>sum+c.customers,0)+g.unserved,5000);assert.ok(g.companies.some(c=>c.migratedIn>0));});
test('identical seed and sequence reproduce all outcomes',()=>{const a=createGame(),b=createGame();a.status=b.status='RUNNING';for(let i=0;i<2000;i++){step(a);step(b);}assert.deepEqual(a,b);});
test('pause freezes jobs, costs and time',()=>{const g=createGame();g.status='PAUSED';const before=structuredClone(g);for(let i=0;i<100;i++)step(g);assert.deepEqual(g,before);});
test('simultaneous eliminations preserve population in unserved pool',()=>{const g=createGame();g.status='RUNNING';for(const c of g.companies){c.capital=-1;c.infraBudget=0;c.bankruptTicks=30;}step(g);assert.equal(g.status,'FINISHED');assert.equal(g.unserved,5000);assert.equal(g.companies.reduce((sum,c)=>sum+c.customers,0),0);});
