import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { applyCommand, assembleGame, project, step } from '../server/engine.js';
import { assertMarket } from '../server/market.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { createGameWriter } from '../server/storage.js';
import { serviceRates } from '../server/traffic.js';
import { DEFAULT_TEST } from '../shared/actions.js';
import type { Role, Command } from '../shared/types.js';
import { marketScenario, marketSample } from './market-scenarios.js';
import { generateDefects } from '../server/defects.js';
import { prepareArtifact } from '../server/artifacts.js';
import { createGame } from '../server/engine.js';

const strategies = ['A-equivalent','B-restart','C-insufficient','D-exhaustive','E-campaign','F-expulsion','G-migration','H-recovery'] as const;
type Strategy = typeof strategies[number];
const config = { kind: 'coupon' as const, percent: 20, audience: 'all' as const, stackable: false };
function seedForCoupon() {
  for (let seed=1;seed<=500;seed++) {
    const g=createGame(1500,seed); assembleGame(g); prepareArtifact(g,g.companies[0],{id:'0-backend',role:'backend',companyId:0},'module.create',{name:'Coupon',configuration:config,dependencies:[]});
    if (generateDefects(seed,g.companies[0].runtime.modules['C0-M1'][0]).some(d=>d.code==='D02')) return seed;
  }
  throw new Error('No D02 seed.');
}
const seed=seedForCoupon();
const percentile=(values:number[],p:number)=>{const sorted=[...values].sort((a,b)=>a-b);return +(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0).toFixed(3);};
function run(duration:number,strategy:Strategy,control=false) {
  const baseline=marketScenario(duration,strategy==='B-restart'?'B-deficient':'A-equivalent',seed);
  let game=baseline.game, sequence=0, recovered=false, repeatCommand:Command|undefined;
  const directory=mkdtempSync(join(tmpdir(),'flow-war-actions-')),db=new DatabaseSync(join(directory,'game.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');
  const writer=createGameWriter(db),ticks:number[]=[],saves:number[]=[],samples:unknown[]=[],causes:unknown[]=[];
  const peak={heapMB:0,queue:0,serializedKB:0,snapshotKB:0,retainedRequests:0};
  let receipts=0,checks=0, restartAbandons=0;
  const save=()=>{receipts+=game.companies.reduce((s,c)=>s+c.traffic.outbox.length,0);const at=performance.now();writer(game);saves.push(performance.now()-at);};
  const command=(role:Role|'operator',type:string,payload:Record<string,unknown>={},companyId=0,changeId?:string,expected=true,id?:string)=>{
    const cmd:Command={id:id??`actions-${++sequence}`,type,companyId,changeId,payload};
    const result=applyCommand(game,{id:role==='operator'?'operator':`${companyId}-${role}`,role,companyId:role==='operator'?null:companyId},cmd);
    assert.equal(result.ok,expected,`${strategy} t${game.tick}: ${type}: ${result.error}`);
    causes.push({at:game.tick,actor:role,companyId,command:cmd,result,capital:game.companies[companyId].capital,revenue:game.companies[companyId].revenue,webRate:serviceRates(game.companies[companyId]).web});save();return cmd;
  };
  const sample=()=>structuredClone({ ...marketSample(game), modules:game.companies.map(c=>Object.values(c.runtime.modules).flat().length), tests:game.changes.map(ch=>({id:ch.id,status:ch.status,reports:ch.reports.map(r=>({suite:r.suite,requests:r.requests,passed:r.testEvidence?.passed,observed:r.testEvidence?.observed}))})), infrastructure:game.companies.map(c=>c.infrastructure), defectActivations:game.companies.map(c=>c.traffic.operations?.counters.activations??{}), employees:Object.values(game.actions.employees).map(e=>({id:e.id,status:e.status,violations:e.violations.filter(v=>!v.reversed).length})) });
  const start=performance.now();
  try {
    while(game.status==='RUNNING') {
      if(!recovered)baseline.decide();
      if(strategy==='G-migration'&&game.tick===40)for(let i=0;i<3;i++)command('devops','infra.scale',{delta:-1},1);
      if(game.tick===100&&['A-equivalent','C-insufficient','D-exhaustive','G-migration'].includes(strategy)&&!control) {
        for(const c of game.companies.filter(c=>strategy==='A-equivalent'||c.id===0)) {
          command('backend','module.create',{name:'Cupón',configuration:strategy==='A-equivalent'?{...config,percent:2}:config,dependencies:[]},c.id);
          const ch=game.changes[0];command('qa','qa.execute',{changeId:ch.id,scenario:{...DEFAULT_TEST,newCustomer:true,suite:strategy==='D-exhaustive'?'integration':'unit',coupons:strategy==='D-exhaustive'?2:1}},c.id);
        }
      }
      if(game.tick===105&&['A-equivalent','C-insufficient','D-exhaustive','G-migration'].includes(strategy)&&!control) {
        for(const c of game.companies.filter(c=>strategy==='A-equivalent'||c.id===0)) {
          const ch=game.changes.find(ch=>ch.companyId===c.id&&ch.artifactRefs)!;
          assert.equal(ch.reports[0].testEvidence?.passed,strategy!=='D-exhaustive');
          if(strategy==='D-exhaustive')command('qa','qa.reject',{},c.id,ch.id);
          else {command('qa','qa.approve',{},c.id,ch.id);command('cto','cto.authorize',{},c.id,ch.id);command('devops','deploy.start',{strategy:'rolling'},c.id,ch.id);}
        }
      }
      if(strategy==='B-restart'&&game.tick===duration*.65) { restartAbandons=game.companies[0].traffic.legitimate.abandoned;command('devops','infra.restart_all',{duration:20});assert.equal(serviceRates(game.companies[0]).web,0); }
      if(strategy==='E-campaign'&&game.tick===duration*.7)command('product','campaign.prepare',{percent:5,audience:'all',duration:120,budget:250,demandMultiplier:4});
      if(strategy==='E-campaign'&&game.tick===duration*.7+1) { const id=game.companies[0].runtime.campaigns[0].id;command('cto','campaign.authorize',{campaignId:id});const revenue=game.companies[0].revenue;command('product','campaign.activate',{campaignId:id});assert.equal(game.companies[0].revenue,revenue); }
      if((strategy==='F-expulsion'&&game.tick===100)||(strategy==='H-recovery'&&game.tick===395)) {
        for(let i=0;i<5;i++)command(strategy==='F-expulsion'?'devops':'product','cto.budget',{amount:1000},0,undefined,false,`violation-${i}`);
        assert.equal(game.companies[0].eliminated,false);
        if(strategy==='F-expulsion')command('devops','infra.restart_all',{duration:10},0,undefined,false);
      }
      if(strategy==='H-recovery'&&game.tick===390) {
        command('backend','module.create',{name:'Trabajo pendiente',configuration:config,dependencies:[]});
        command('qa','qa.execute',{changeId:game.changes[0].id,scenario:{...DEFAULT_TEST,requests:500,concurrency:1,stock:1000}});
      }
      if(strategy==='H-recovery'&&game.tick===400&&!recovered) {
        repeatCommand=command('devops','infra.restart_all',{duration:20},0,undefined,true,'persisted-restart');
        const before=serializeGame(game);game=recoverGame(before);assert.equal(game.status,'PAUSED');assert.equal(game.actions.employees['0-product'].status,'EXPELLED');
        const capital=game.companies[0].capital;const result=applyCommand(game,{id:'0-devops',role:'devops',companyId:0},repeatCommand);assert.equal(result.ok,true);assert.equal(game.companies[0].capital,capital);
        command('operator','room.start');recovered=true;
      }
      const at=performance.now();step(game);ticks.push(performance.now()-at);
      for(const c of game.companies) { const t=c.traffic.totals,pending=Object.values(c.traffic.requests).filter(r=>!r.result).length;assert.equal(t.generated,t.completed+t.rejected+t.abandoned+t.failed+pending);assert.ok(Math.abs(c.revenue-(t.revenue+c.concurrency.totals.revenue))<.01);peak.retainedRequests=Math.max(peak.retainedRequests,Object.keys(c.traffic.requests).length); }
      if(Number.isInteger(game.tick)) {assertMarket(game);checks++;}
      peak.queue=Math.max(peak.queue,...game.companies.map(c=>c.queue));
      if(Math.round(game.tick*10)%100===0)save();
      if(Math.round(game.tick*10)%300===0) { samples.push(sample());peak.heapMB=Math.max(peak.heapMB,process.memoryUsage().heapUsed/1024**2);peak.serializedKB=Math.max(peak.serializedKB,Buffer.byteLength(serializeGame(game))/1024);peak.snapshotKB=Math.max(peak.snapshotKB,Buffer.byteLength(JSON.stringify(project(game,{id:'0-qa',role:'qa',companyId:0})))/1024); }
    }
    save();assert.equal(game.tick,duration);assertMarket(game);
    if(strategy==='A-equivalent')assert.equal(new Set(game.companies.map(c=>JSON.stringify([c.customers,c.capital,c.revenue,c.pressure]))).size,1);
    if(strategy==='B-restart')assert.ok(game.companies[0].traffic.legitimate.abandoned>restartAbandons);
    if(strategy==='C-insufficient'||strategy==='G-migration'&&!control)assert.ok((game.companies[0].traffic.operations?.counters.activations.D02??0)>0);
    if(strategy==='D-exhaustive')assert.equal(game.changes.find(ch=>ch.artifactRefs)?.status,'QA_REJECTED');
    if(strategy==='F-expulsion')assert.equal(game.actions.employees['0-devops'].status,'EXPELLED');
    if(strategy==='H-recovery') { assert.equal(game.actions.employees['0-product'].status,'EXPELLED');assert.equal(game.changes.find(ch=>ch.artifactRefs)?.reports.length,1); }
    assert.equal((db.prepare('SELECT count(*) AS n FROM request_receipts').get() as {n:number}).n,receipts);
    const restored=recoverGame(serializeGame(game));assert.deepEqual(restored.market,game.market);assert.deepEqual(restored.actions,JSON.parse(JSON.stringify(game.actions)));
    const result={strategy,control,duration,seed,recovered,finalTick:game.tick,wallSeconds:+((performance.now()-start)/1000).toFixed(3),tickP95ms:percentile(ticks,.95),tickMaxMs:percentile(ticks,1),saveP95ms:percentile(saves,.95),saveCadenceSeconds:10,peak,checks,receipts,final:sample(),samples,causes};
    console.log(JSON.stringify({strategy,control,duration,seed,finalTick:game.tick,tickP95ms:result.tickP95ms,saveP95ms:result.saveP95ms,wallSeconds:result.wallSeconds}));return result;
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
}
const filter=process.env.FLOW_ACTION_BENCH;
const results=[1200,1500].flatMap(d=>strategies.filter(s=>!filter||s===filter).map(s=>run(d,s)));
const controls=(!filter||filter==='G-migration')?[1200,1500].map(d=>run(d,'G-migration',true)):[];
for(const result of results.filter(r=>r.strategy==='G-migration')) {const control=controls.find(c=>c.duration===result.duration)!;assert.ok(result.final.companies[0].migratedOut>control.final.companies[0].migratedOut);assert.ok(result.final.companies[1].arrived>control.final.companies[1].arrived);}
const files=['server/engine.ts','server/requests.ts','server/traffic.ts','server/qa.ts','server/discipline.ts','server/artifacts.ts','server/defects.ts','server/agents.ts','server/persistence.ts','server/security.ts','server/infrastructure.ts','server/blocks.ts','server/business.ts','server/action-validation.ts','server/storage.ts','server/market.ts','server/scenarios.ts','server/load.ts','shared/types.ts','shared/simulation.ts','shared/agents.ts','shared/blocks.ts','shared/actions.ts','scripts/actions-benchmark.ts'];
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/actions-benchmark-4a.json',JSON.stringify({version:'actions-1-defects-1',base:'b3996dfd1650aefcc85b4b4ce95042b8cfb2b185',sourceFiles:files,sourceDigest:createHash('sha256').update(files.map(f=>f+'\n'+readFileSync(f,'utf8')).join('\n')).digest('hex'),hardware:{node:process.version,cpu:cpus()[0]?.model},results,controls},null,2));
