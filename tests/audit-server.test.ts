import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {io,type Socket} from '../shared/live-client.js';
import {createGame,step} from '../server/engine.js';
import {admitTraffic} from '../server/traffic.js';
import {createGameWriter} from '../server/storage.js';
import {command} from './helpers.js';
import type {Command,Result} from '../shared/types.js';
const restricted=['trafficClass','attackKind','securityAllowed','breach','effectCodes','defectLoss','contractPrice','execution','releaseOnInterrupt'];
function noInternal(value:any){if(!value||typeof value!=='object')return;for(const key of Object.keys(value)){assert(!restricted.includes(key),`restricted key ${key}`);noInternal(value[key]);}}
test('H1/H2 real sessions enforce private projections, durable reset deduplication and honest failed acknowledgments',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-audit-server-')),path=join(dir,'game.sqlite'),port=27000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
 const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL;CREATE TABLE commands(identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');const write=createGameWriter(db),g=createGame(1200);command(g,'operator','room.start');
 const malicious=admitTraffic(g.companies[0],0,'purchase','malicious','injection'),foreign=admitTraffic(g.companies[1],0,'purchase');for(let i=0;i<100;i++)step(g);command(g,'operator','room.pause');write(g);
 let child=spawnServer();const sockets:Socket[]=[];
 function spawnServer(){return spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port)},stdio:'ignore'});}
 async function ready(){for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('server unavailable');}
 try{await ready();const {credentials}=JSON.parse(readFileSync(join(dir,'access.json'),'utf8'));
 const login=async(role:string,companyId:number|null)=>{const credential=credentials.find((c:any)=>c.identity.role===role&&c.identity.companyId===companyId);const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:credential.code})});const cookie=r.headers.get('set-cookie')!.split(';')[0];return{cookie,socket:await connect(cookie)};};
 const connect=async(cookie:string)=>{const socket=io(base,{forceNew:true,transports:['websocket'],extraHeaders:{Cookie:cookie}});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;};
 const student=await login('backend',0),teacher=await login('operator',null);
 const send=(socket:Socket,c:Command)=>new Promise<Result>((resolve,reject)=>socket.timeout(5000).emit('command',c,(err:Error|null,r:Result)=>err?reject(err):resolve(r)));
 const get=(url:string,cookie=student.cookie)=>fetch(base+url,{headers:{Cookie:cookie}});
 assert.equal((await fetch(base+'/api/requests/'+malicious.id)).status,403);assert.equal((await get('/api/requests/'+foreign.id)).status,404);
 for(const row of db.prepare('SELECT id FROM request_receipts WHERE companyId=0').all() as {id:string}[]){const r=await get('/api/requests/'+row.id);assert(r.ok);noInternal(await r.json());}
 const own=await(await get('/api/requests/'+malicious.id)).json();noInternal(own);assert.equal(own.id,malicious.id);
 const original=await(await get('/api/requests/'+malicious.id,teacher.cookie)).json();assert.equal(original.trafficClass,'malicious');assert.equal(original.attackKind,'injection');assert('securityAllowed' in original);
 const snapshot=await(await get('/api/snapshot')).json();noInternal(snapshot);assert(!JSON.stringify(snapshot).includes('"kind":"attack"'));assert(!('malicious' in snapshot.companies[0].traffic));assert(!('fraudRate' in snapshot.companies[0].traffic.metrics));assert(!('breaches' in snapshot.companies[0]));assert(!('breaches' in snapshot.privateCompany));
 const socketSnapshot=new Promise<any>(resolve=>student.socket.once('snapshot',resolve));await send(teacher.socket,{id:'speed',type:'room.speed',payload:{speed:5}});noInternal(await socketSnapshot);
 assert.equal((await send(student.socket,{id:'denied-reset',type:'room.reset'})).ok,false);
 db.exec("CREATE TRIGGER fail_admin_reset BEFORE INSERT ON history_games WHEN NEW.generation=1 BEGIN SELECT RAISE(ABORT,'disk injection'); END;");
 const reset:Command={id:'stable-reset',type:'room.reset',payload:{duration:1200}};assert.equal((await send(teacher.socket,reset)).ok,false);const afterFailed=await(await get('/api/snapshot',teacher.cookie)).json();assert.equal(afterFailed.generation,0);assert.equal(afterFailed.tick,10);assert.equal(db.prepare("SELECT count(*) AS n FROM commands WHERE id='stable-reset'").get()!.n,0);
 db.exec('DROP TRIGGER fail_admin_reset');assert((await send(teacher.socket,reset)).ok);assert((await send(teacher.socket,reset)).ok);
 const games=await(await get('/api/dvr/games')).json();assert.equal(games[0].status,'ABORTED');const end=await get('/api/dvr/0?companyId=0&at=10');assert.equal(end.status,200);noInternal(await end.json());assert.equal((await get('/api/dvr/0?companyId=1&at=10')).status,403);assert.equal((await get('/api/dvr/0?at=10.1')).status,403);
 const hidden=await get('/api/dvr/0/requests/'+malicious.id);assert(hidden.ok);noInternal(await hidden.json());const admin=await(await get('/api/dvr/0/requests/'+malicious.id,teacher.cookie)).json();assert.equal(admin.fact.data.trafficClass,'malicious');noInternal(await(await get('/api/dvr/0/metrics?companyId=0')).json());
 for(const socket of sockets)socket.disconnect();let exited=once(child,'exit');child.kill('SIGKILL');await exited;child=spawnServer();await ready();const resumed=await connect(teacher.cookie);assert((await send(resumed,reset)).ok);assert.equal((await(await get('/api/snapshot',teacher.cookie)).json()).generation,1);assert.equal((await get('/api/dvr/0?at=10')).status,200);assert.equal((await get('/api/dvr/1?at=0')).status,403);assert.equal(db.prepare('SELECT count(*) AS n FROM history_games').get()!.n,2);
 }finally{for(const socket of sockets)socket.disconnect();if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}db.close();rmSync(dir,{recursive:true,force:true});}
});
