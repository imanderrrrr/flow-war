import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,statSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,cpus} from 'node:os';
import {join} from 'node:path';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {createGame,applyCommand,step} from '../server/engine.js';
import {createGameWriter} from '../server/storage.js';
import {historyAccess,reconstruct} from '../server/history.js';
import {trafficReceipt} from '../server/traffic.js';
import {marketSample} from './market-scenarios.js';
const dir=mkdtempSync(join(tmpdir(),'flow-audit-base-')),path=join(dir,'game.sqlite'),db=new DatabaseSync(path);
db.exec('PRAGMA journal_mode=WAL;CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT)');
const write=createGameWriter(db),g=createGame(1200),op={id:'operator',role:'operator',companyId:null} as const;
const run=(type:string)=>applyCommand(g,op,{id:crypto.randomUUID(),type});
const ticks:number[]=[],saves:number[]=[];write(g);run('room.start');
for(let i=0;i<1200;i++){const t=performance.now();step(g);ticks.push(performance.now()-t);if(i%100===0){const t=performance.now();write(g);saves.push(performance.now()-t);}}
const economy=marketSample(g);write(g);const receipt=Object.values(g.companies[0].traffic.requests)[0];
const exposed=Object.keys(trafficReceipt(receipt)).filter(k=>['trafficClass','attackKind','securityAllowed','breach'].includes(k));
run('room.reset');write(g);let accessible=true;try{historyAccess(db,0,op);}catch{accessible=false;}
const loop=monitorEventLoopDelay({resolution:10});loop.enable();await new Promise(r=>setTimeout(r,30));
const seeks:number[]=[];const before=performance.now();const heartbeat=new Promise<number>(r=>setTimeout(()=>r(performance.now()-before),10));
for(let i=0;i<4;i++){const t=performance.now();reconstruct(db,0,119.9);seeks.push(performance.now()-t);}
const blockedTimerMs=await heartbeat;await new Promise(r=>setTimeout(r,30));loop.disable();
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];
const pages=Object.fromEntries(tables.map(t=>[t.name,db.prepare('SELECT coalesce(sum(pgsize),0) AS bytes FROM dbstat WHERE name=?').get(t.name)]));
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const pct=(v:number[])=>{const a=[...v].sort((a,b)=>a-b);return Object.fromEntries([.5,.95,.99].map(p=>['p'+p*100,a[Math.floor((a.length-1)*p)]]));};
writeFileSync(`docs/benchmarks/audit-fixes/${process.env.FLOW_AUDIT_LABEL==='after'?'after':'baseline'}.json`,JSON.stringify({referenceCommit:'c86d32058f0fd1741e27e6397f6124a1f1a4b62b',label:process.env.FLOW_AUDIT_LABEL??'baseline',hardware:{node:process.version,cpu:cpus()[0]?.model},H1:{previousStatus:'RUNNING',lastTick:120,accessible},H2:{exposed},H3:{concurrent:1,sequentialQueries:4,seeks,blockedTimerMs,eventLoopMaxMs:loop.max/1e6},H4:{sqliteBytes:statSync(path).size,pages,freePages:db.prepare('PRAGMA freelist_count').get()},tick:pct(ticks),persist:pct(saves),heapMiB:process.memoryUsage().heapUsed/1024**2,economy},null,2));
db.close();rmSync(dir,{recursive:true,force:true});
