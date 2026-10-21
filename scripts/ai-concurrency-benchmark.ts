import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AiGateway, AnthropicProvider } from '../server/claude.js';
import { initialGraph } from '../server/engine.js';
const began=performance.now(),order:number[]=[],active=Array(5).fill(0),maximum=Array(5).fill(0);let global=0,maxGlobal=0;
const transport:typeof fetch=async(_url,init)=>{
 const body=JSON.parse(String(init!.body)),prompt=JSON.parse(body.messages[0].content),company=prompt.authorizedContext.companyId;
 assert.equal(prompt.request,`company-${company}`);active[company]++;global++;maximum[company]=Math.max(maximum[company],active[company]);maxGlobal=Math.max(global,maxGlobal);order.push(company);
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,company===0?120:20);init!.signal!.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('aborted'));},{once:true});});
 active[company]--;global--;return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({text:`company-${company}`})}],usage:{input_tokens:40,output_tokens:8}}));
};
const provider=new AnthropicProvider('synthetic-key','simulated-transport',transport),gateway=new AiGateway(provider),tasks:Promise<unknown>[]=[];
for(let round=0;round<6;round++)for(let company=0;company<5;company++)tasks.push(gateway.generate(`${company}-u${round}`,{id:`${company}-${round}`,kind:'security.propose',text:`company-${company}`},initialGraph('backend'),company,{companyId:company}).then(result=>assert.equal(result.text,`company-${company}`)));
await Promise.all(tasks);await new Promise<void>(r=>setImmediate(r));assert.equal(maxGlobal,5);assert(maximum.every(n=>n===1));assert.deepEqual(order.slice(0,5),[0,1,2,3,4]);
const metrics=gateway.scheduler.metrics(),percentiles=(nums:number[])=>{const s=nums.slice().sort((a,b)=>a-b);return {n:s.length,p50:s[Math.ceil(s.length*.5)-1],p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)};};
const report={status:'passed',at:new Date().toISOString(),transport:'simulated Anthropic HTTP; no contracted capacity assertion',requests:tasks.length,companies:5,maxGlobal,maxPerCompany:maximum,slowCompany:0,wallMs:performance.now()-began,waitMs:percentiles(metrics.recent.map(r=>r.waitMs??0)),durationMs:percentiles(metrics.recent.map(r=>r.durationMs??0)),inputTokens:provider.metrics().reduce((n,m)=>n+(m.inputTokens??0),0),outputTokens:provider.metrics().reduce((n,m)=>n+(m.outputTokens??0),0),order,orderDigest:createHash('sha256').update(JSON.stringify(order)).digest('hex'),metrics};
writeFileSync('docs/benchmarks/entrega-7/ai-concurrency.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,metrics:undefined,order:undefined}));
