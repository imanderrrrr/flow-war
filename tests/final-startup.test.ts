import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('final startup: concurrent first starts have one owner and one usable credential file',{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-final-startup-')),ports:number[]=[];
 for(let i=0;i<2;i++){const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');ports.push((probe.address() as {port:number}).port);await new Promise<void>(r=>probe.close(()=>r()));}
 const children=ports.map(port=>spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'production',FLOW_DATA_DIR:dir,FLOW_PORT:String(port)},stdio:['ignore','ignore','pipe']}));
 const errors=['',''];children.forEach((child,i)=>child.stderr.on('data',b=>errors[i]+=String(b)));
 try{
  let winner=-1;
  for(let attempt=0;attempt<100;attempt++){
   const health=await Promise.all(ports.map(async port=>{try{return(await fetch(`http://127.0.0.1:${port}/api/health`)).ok;}catch{return false;}}));
   assert(health.filter(Boolean).length<=1,'two active owners');winner=health.findIndex(Boolean);
   if(winner>=0&&children[1-winner].exitCode!==null)break;
   await new Promise(r=>setTimeout(r,50));
  }
  assert(winner>=0);assert.equal(children[1-winner].exitCode,1);assert.match(errors[1-winner],/usando el almacenamiento/);
  const access=readFileSync(join(dir,'access.json'),'utf8'),credentials=JSON.parse(access).credentials,teacher=credentials.find((c:any)=>c.identity.role==='operator');
  const login=await fetch(`http://127.0.0.1:${ports[winner]}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:teacher.code})});assert.equal(login.status,200);assert.equal((await login.json()).identity.role,'operator');assert.equal(readFileSync(join(dir,'access.json'),'utf8'),access);
 }finally{
  await Promise.all(children.map(async child=>{if(child.exitCode===null&&child.signalCode===null){const end=once(child,'exit');child.kill('SIGTERM');await end;}}));rmSync(dir,{recursive:true,force:true});
 }
});
