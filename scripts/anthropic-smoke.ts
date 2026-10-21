import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { AiGateway, AnthropicProvider } from '../server/claude.js';
import { prepareAi, commitAi } from '../server/ai-service.js';
import { createGame } from '../server/engine.js';
import { command, advanceGame, reviewForQa } from '../tests/helpers.js';
import type { AiInput } from '../shared/collaboration.js';
import type { Identity } from '../shared/types.js';
const provider=new AnthropicProvider(),report:any={at:new Date().toISOString(),transport:'real Anthropic HTTPS',status:'pending',configuration:provider.status(),checks:[],limitations:[]};
if(!process.env.ANTHROPIC_API_KEY||!process.env.ANTHROPIC_MODEL){report.status='not_run';report.reason='Missing ANTHROPIC_API_KEY or ANTHROPIC_MODEL';writeFileSync('docs/benchmarks/entrega-7/anthropic.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exit(0);}
const g=createGame();g.status='RUNNING';const gateway=new AiGateway(provider),actor=(role:Identity['role'],companyId=0):Identity=>({id:`${companyId}-${role}`,role,companyId});
async function request(a:Identity,input:Omit<AiInput,'id'>){const raw={...input,id:crypto.randomUUID()},p=await prepareAi(g,a,raw,gateway);commitAi(g,a,raw,p);report.checks.push({kind:input.kind,companyId:a.companyId,valid:true});return p;}
try{
 const backend=await request(actor('backend'),{kind:'backend.propose',text:'Conserva la compra con lectura, escritura y pago. No agregues controles.'});assert(command(g,'backend','ai.accept',{proposalId:backend.id}).ok);const draft=g.companies[0].drafts.backend!;assert(command(g,'backend','change.submit',{graph:draft.graph,revision:draft.revision}).ok);const ch=g.changes[0];
 const security=await request(actor('security'),{kind:'security.compile',changeId:ch.id,nodeId:'backend-payment',text:'Requerir sesión iniciada para procesar pagos.'});assert(security.output.executable);assert(command(g,'security','security.save',{changeId:ch.id,nodeId:'backend-payment',text:'Requerir sesión iniciada para procesar pagos.',revision:0,interpretationId:security.id}).ok);reviewForQa(g);
 const qa=await request(actor('qa'),{kind:'qa.interpret',changeId:ch.id,text:'Hacé que dos compradores distintos con sesión iniciada compren la última unidad al mismo tiempo.'});assert.equal(qa.output.scenario?.requests,2);assert.equal(qa.output.scenario?.stock,1);assert.equal(qa.output.scenario?.concurrency,2);assert(command(g,'qa','ai.accept',{proposalId:qa.id}).ok);advanceGame(g,3);assert.equal(ch.reports[0].requests,2);report.engine={requests:ch.reports[0].requests,completed:ch.reports[0].completed,oversold:ch.reports[0].oversold};
 await assert.rejects(()=>request(actor('qa',1),{kind:'qa.interpret',changeId:ch.id,text:'Probar dos compradores.'}));report.checks.push({kind:'company-isolation',valid:true});report.status='passed';
}catch(e){report.status='failed';report.code=(e as any).code??'VALIDATION_FAILED';process.exitCode=1;}
report.provider=provider.status();report.measurements=provider.metrics();writeFileSync('docs/benchmarks/entrega-7/anthropic.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
