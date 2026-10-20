import test from 'node:test';
import assert from 'node:assert/strict';
import {LatestDvrRequest} from '../src/dvrClient.js';
test('H3 rapid seeks and context cancellation ignore stale replies even when transport ignores AbortSignal',async()=>{
 const requests:{signal:AbortSignal;resolve:(response:Response)=>void}[]=[];
 const lane=new LatestDvrRequest<{at:number}>((_url,{signal})=>new Promise(resolve=>requests.push({signal,resolve})));
 const old=lane.get('/old'),latest=lane.get('/latest');assert(requests[0].signal.aborted);
 requests[1].resolve(new Response('{"at":2}'));assert.deepEqual(await latest,{at:2});
 requests[0].resolve(new Response('{"at":1}'));assert.equal(await old,undefined);
 const cancelled=lane.get('/previous-generation');lane.cancel();assert(requests[2].signal.aborted);
 requests[2].resolve(new Response('{"error":"obsolete"}',{status:503}));assert.equal(await cancelled,undefined);
 const scrubs=Array.from({length:20},(_,i)=>lane.get('/frame/'+i));
 for(let i=19;i>=0;i--)requests[3+i].resolve(new Response(JSON.stringify({at:i})));
 const results=await Promise.all(scrubs);assert.equal(results.filter(r=>r!==undefined).length,1);assert.deepEqual(results[19],{at:19});
});
test('H3 every request lane reports busy accurately and can retry without retaining stale state',async()=>{
 const replies=[new Response('{"error":"private diagnostic"}',{status:503}),new Response('{}',{status:429}),new Response('{"error":"Intervalo inválido."}',{status:400}),new Response('{"at":7}')];
 const lane=new LatestDvrRequest<{at:number}>(async()=>replies.shift()!);
 await assert.rejects(lane.get('/metrics'),/DVR está ocupado/);await assert.rejects(lane.get('/chat'),/DVR está ocupado/);
 await assert.rejects(lane.get('/evidence'),/Intervalo inválido/);assert.deepEqual(await lane.get('/retry'),{at:7});
});
