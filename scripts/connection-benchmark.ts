import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import { createGame } from '../server/engine.js';
import { admitTraffic } from '../server/traffic.js';
import { createGameWriter } from '../server/storage.js';
import type { Identity, Result, Snapshot } from '../shared/types.js';

const directory = await mkdtemp(join(tmpdir(), 'flow-war-connections-'));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as {port:number}).port; await new Promise<void>(resolve=>probe.close(()=>resolve()));
const base = `http://127.0.0.1:${port}`, sockets: Socket[] = [];
const game = createGame(); game.status='RUNNING'; game.tick=800;
for(const company of game.companies){company.traffic.lastTick=800;company.traffic.initialIssued=true;for(let i=0;i<80;i++)admitTraffic(company,800,i%3?'browse':'purchase');}
const db = new DatabaseSync(join(directory,'game.sqlite'));db.exec('CREATE TABLE commands (identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');createGameWriter(db)(game);db.close();
const child = spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_PORT:String(port),FLOW_DATA_DIR:directory},stdio:'ignore'});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let snapshots=0,maxSnapshotBytes=0,last:Snapshot|undefined;
try {
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(base+'/api/health')).ok;}catch{}if(ready)break;await delay(50);}if(!ready)throw new Error('Server not ready');
  const {credentials}=JSON.parse(await readFile(join(directory,'access.json'),'utf8')) as {credentials:{code:string;identity:Identity}[]};
  let operator:Socket|undefined;
  const chosen=credentials.filter(c=>c.identity.role!=='product');
  for(const credential of [...chosen,undefined]) {
    let cookie='';if(credential){const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:credential.code})});if(!response.ok)throw new Error('Login failed');cookie=response.headers.get('set-cookie')!.split(';')[0];}
    const socket=io(base,{forceNew:true,autoConnect:false,transports:['websocket'],extraHeaders:{Cookie:cookie}});sockets.push(socket);
    socket.on('snapshot',(snapshot:Snapshot)=>{snapshots++;maxSnapshotBytes=Math.max(maxSnapshotBytes,Buffer.byteLength(JSON.stringify(snapshot)));if(credential?.identity.role==='operator')last=snapshot;});
    const connected=new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});socket.connect();await connected;
    if(credential?.identity.role==='operator')operator=socket;
  }
  const command=(type:string,payload?:Record<string,unknown>)=>new Promise<Result>((resolve,reject)=>operator!.timeout(5000).emit('command',{id:crypto.randomUUID(),type,payload},(error:Error|null,result:Result)=>error?reject(error):result.ok?resolve(result):reject(new Error(result.error))));
  await command('room.start');await command('room.speed',{speed:20});
  const latencies:number[]=[];const before=performance.now();
  for(let sample=0;sample<30;sample++){const at=performance.now();await command('room.speed',{speed:20});latencies.push(performance.now()-at);await delay(200);}
  await command('room.pause');latencies.sort((a,b)=>a-b);
  const result={connections:sockets.length,snapshots,maxSnapshotBytes,wallSeconds:(performance.now()-before)/1000,ackP95ms:latencies[Math.floor(latencies.length*.95)],ackMaxMs:latencies.at(-1),finalTick:last?.tick,
    companies:last?.companies.map(c=>({id:c.id,generated:c.traffic.totals.generated,pending:c.traffic.totals.generated-c.traffic.totals.completed-c.traffic.totals.rejected-c.traffic.totals.abandoned-c.traffic.totals.failed,queue:c.queue,legitimateAbandoned:c.traffic.legitimate.abandoned}))};
  await mkdir(resolve('artifacts'),{recursive:true});await writeFile(resolve('artifacts/connection-benchmark.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
  for(const socket of sockets)socket.disconnect();
  if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
  await rm(directory,{recursive:true,force:true});
}
