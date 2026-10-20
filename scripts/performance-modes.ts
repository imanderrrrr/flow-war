import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {marketScenario} from './market-scenarios.js';
import {step,applyCommand} from '../server/engine.js';
import {buffer,checkpoint,clearBuffer} from '../server/observability.js';
import {serializeGame} from '../server/persistence.js';
import {createGameWriter} from '../server/storage.js';
import {reconstruct} from '../server/history.js';
import type {GameState} from '../shared/types.js';
const normalize=(g:GameState)=>{const s=JSON.parse(serializeGame(g));delete s.dvrEnabled;delete s.observability.checkpointAt;delete s.observability.sampleAt;return s;};
const digest=(g:GameState)=>createHash('sha256').update(JSON.stringify(normalize(g))).digest('hex');
const results:any[]=[];
for(const duration of [1200,1500])for(const enabled of [true,false]){
 const fixedNow=Date.now;Date.now=()=>100000;const scenario=marketScenario(duration,'A-equivalent',8);Date.now=fixedNow;const g=scenario.game;g.dvrEnabled=enabled;for(const c of g.companies)c.reputation=34;clearBuffer(g);checkpoint(g,serializeGame,true);
 const dir=mkdtempSync(join(tmpdir(),'flow-mode-compare-')),path=join(dir,'game.sqlite'),db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL;CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');const write=createGameWriter(db),cpu=process.cpuUsage(),at=performance.now(),states:any[]=[];let rssMax=0,maxPending=0,seq=0;
 const command=(type:string,payload:Record<string,unknown>,role:'devops'|'backend'='devops')=>{const r=applyCommand(g,{id:`0-${role}`,role,companyId:0},{id:`mode-${++seq}`,type,companyId:0,payload},{receivedAt:100000+Math.round(g.tick*1000)});assert(r.ok,r.error);};
 try{write(g);while(g.status==='RUNNING'){
  Date.now=()=>100000+Math.round(g.tick*1000);try{scenario.decide();}finally{Date.now=fixedNow;}
  if(g.tick===100)command('infra.stop',{service:'web'});if(g.tick===110)command('infra.recover',{service:'web'});if(g.tick===200)command('chat.send',{channel:'equipo-interno',text:'Mensaje determinista',refs:[]},'backend');if(g.tick===400)command('infra.maintenance',{mode:'ORDERS_PAUSED'});if(g.tick===410)command('infra.maintenance',{mode:'OPERATING'});
  step(g);maxPending=Math.max(maxPending,buffer(g).events.length+buffer(g).commands.length+buffer(g).points.length+buffer(g).checkpoints.length+g.companies.reduce((n,c)=>n+c.traffic.outbox.length,0));
  if(Math.round(g.tick*10)%100===0){write(g);rssMax=Math.max(rssMax,process.memoryUsage().rss);}
  if(Math.round(g.tick*10)%600===0||String(g.status)==='FINISHED')states.push({tick:g.tick,digest:digest(g)});
 }
 write(g);if(enabled)assert.equal(digest(reconstruct(db,0,duration)),digest(g));else for(const t of ['history_events','history_inputs','history_points','history_checkpoints','request_receipts','receipt_paths'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${t}`).get()!.n,0,t);
 const tables=Object.fromEntries(['history_events','history_inputs','history_points','history_checkpoints','request_receipts','receipt_paths','commands','slack_messages'].map(t=>[t,db.prepare(`SELECT count(*) AS rows FROM ${t}`).get()])),pages=db.prepare('SELECT name,sum(pgsize) AS bytes FROM dbstat GROUP BY name').all();db.exec('PRAGMA wal_checkpoint(TRUNCATE)');const elapsedMs=performance.now()-at,cpuMicros=process.cpuUsage(cpu);const result={duration,enabled,states,elapsedMs,cpuMicros,rssMax,heapUsed:process.memoryUsage().heapUsed,maxPending,sqliteBytes:statSync(path).size,tables,pages,finalDigest:digest(g),population:Object.keys(g.market.customers).length,requests:g.companies.map(c=>c.traffic.totals),crises:g.companies.map(c=>c.crisis.episode)};results.push(result);console.log(JSON.stringify({duration,enabled,elapsedMs,sqliteBytes:result.sqliteBytes,digest:result.finalDigest,maxPending}));
 }finally{Date.now=fixedNow;db.close();rmSync(dir,{recursive:true,force:true});}
}
for(const duration of [1200,1500]){const [on,off]=results.filter(r=>r.duration===duration);assert.deepEqual(off.states,on.states);assert.equal(off.finalDigest,on.finalDigest);assert.equal(off.tables.slack_messages.rows,on.tables.slack_messages.rows);assert.equal(off.maxPending,0);}
mkdirSync('docs/benchmarks/entrega-5-5',{recursive:true});writeFileSync('docs/benchmarks/entrega-5-5/dvr-determinism.json',JSON.stringify({sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hardware:{node:process.version,cpu:cpus()[0].model},normalizations:['dvrEnabled (configuration)','observability.checkpointAt (replay scheduler)','observability.sampleAt (replay scheduler)','serializeGame already omits transient receipt outbox in both modes'],rssLimitation:'Sequential runs in one Node process; retained V8 arenas make RSS unsuitable for causal comparison. Use separate-process classroom runs for RAM.',results,exact:true,exitCode:0},null,2)+'\n');
