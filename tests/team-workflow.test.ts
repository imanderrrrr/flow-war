import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame, project } from '../server/engine.js';
import { AiGateway, AnthropicProvider, validateOutput, type Provider } from '../server/claude.js';
import { AiScheduler } from '../server/ai-scheduler.js';
import { aiContext, prepareAi, commitAi, beginAiAttempt } from '../server/ai-service.js';
import { workflow, available } from '../server/workflow.js';
import { createTestJob, advanceTestJob, testReport } from '../server/qa.js';
import { recoverGame, serializeGame } from '../server/persistence.js';
import { DEFAULT_TEST, type TestScenario } from '../shared/actions.js';
import type { AiInput } from '../shared/collaboration.js';
import type { GameState, Identity } from '../shared/types.js';
import { command, advanceGame, reviewForQa, insertBlock } from './helpers.js';
const actor=(role:Identity['role'],companyId=0):Identity=>({id:`${companyId}-${role}`,role,companyId});
const start=()=>{const g=createGame();g.status='RUNNING';return g;};
function candidate(atomic=false){const g=start();assert(command(g,'backend','change.submit',{graph:atomic?insertBlock('atomic'):g.companies[0].backend,revision:0}).ok);return g;}
const fixture=(output:unknown):Provider=>({name:'test',model:'simulated',async generate(){return structuredClone(output);}});
const letter=(g:GameState,recipient='backend')=>({changeId:g.changes[0].id,recipient,subject:'Investigación de compra',description:'Observo un comportamiento que deseo revisar.',steps:'Ejecutar el escenario adjunto.',observed:'Consultar la evidencia adjunta.',expected:'La expectativa que define el estudiante.',severity:'high',evidenceIds:workflow(g.companies[0]).runs.filter(r=>r.report&&r.changeId===g.changes[0].id).map(r=>r.id),observationRefs:[]});
function execute(g:GameState,scenario:TestScenario=DEFAULT_TEST){reviewForQa(g);const ch=g.changes[0];assert(command(g,'qa','qa.execute',{changeId:ch.id,scenario}).ok);advanceGame(g,15);return ch.reports.at(-1)!;}
function approved(g:GameState){execute(g);const ch=g.changes[0];assert(command(g,'qa','qa.review',{changeId:ch.id,risks:'Acepto continuar con el alcance de estas pruebas.',evidenceIds:workflow(g.companies[0]).runs.map(r=>r.id)}).ok);return ch;}
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));

test('E7 every Backend mutation and stale AI proposal is rejected after submission; a Security observation cannot unlock it',async()=>{
 const g=start(),c=g.companies[0],input:AiInput={id:'pre-lock',kind:'backend.propose',text:'Cambiar compra.'};const graph=c.backend;
 const raw={graph:{nodes:graph.nodes.map(n=>({...n,data:{...n.data,value:1}})),edges:graph.edges}},p=await prepareAi(g,actor('backend'),input,new AiGateway(fixture(raw)));commitAi(g,actor('backend'),input,p);
 assert(command(g,'backend','change.submit',{graph,revision:0}).ok);const frozen=structuredClone(g.changes[0]);
 for(const [type,payload]of [['draft.save',{graph,revision:1}],['change.submit',{graph,revision:1}],['ai.accept',{proposalId:p.id}],['module.create',{name:'Bypass',configuration:{kind:'inventory',minimum:1},dependencies:[]}],['module.revise',{moduleId:'missing',name:'Bypass',configuration:{kind:'inventory',minimum:1},dependencies:[]}]] as const)assert.equal(command(g,'backend',type,payload).ok,false,type);
 await assert.rejects(()=>prepareAi(g,actor('backend'),{...input,id:'locked'},new AiGateway(fixture(raw))));
 assert(command(g,'security','security.correction',{changeId:frozen.id,nodeId:'backend-payment',text:'Observación que QA debe evaluar.'}).ok);assert(workflow(c).backendLock);assert.deepEqual(g.changes[0].graph,frozen.graph);
 assert.equal(command(g,'cto','change.cancel',{changeId:frozen.id,reason:'No',confirmed:true}).ok,false);
 assert.equal(command(g,'security','draft.save',{graph,revision:1}).ok,false);
});

test('E7 Backend letters preserve exact student wording and evidence, release only Backend and require new Security review',()=>{
 const g=candidate();execute(g,{...DEFAULT_TEST,requests:2,concurrency:2,stock:1});const old=g.changes[0],graph=structuredClone(old.graph),p=letter(g);
 assert.equal(command(g,'qa','qa.return',{...p,evidenceIds:['C1-QA1']}).ok,false);assert(workflow(g.companies[0]).backendLock);
 assert(command(g,'qa','qa.return',p).ok);assert.deepEqual(workflow(g.companies[0]).letters[0].description,p.description);assert.equal(workflow(g.companies[0]).backendLock,undefined);assert.deepEqual(old.graph,graph);assert(old.reports[0].testEvidence);
 assert(command(g,'backend','change.submit',{graph,revision:g.companies[0].drafts.backend!.revision}).ok);assert.equal(g.changes[0].status,'SECURITY_PENDING');assert.equal(g.changes[0].implementation!.backendVersion,2);assert.equal(g.changes[0].reports.length,0);assert.deepEqual(old.graph,graph);
});

test('E7 Security return creates a separate protection revision and leaves Backend locked',()=>{
 const g=candidate(true);execute(g);const original=structuredClone(g.changes[0]),old=g.changes[0];
 assert(command(g,'qa','qa.return',letter(g,'security')).ok);const next=g.changes[0];assert.notEqual(next.id,old.id);assert.equal(next.implementation!.backendVersion,old.implementation!.backendVersion);assert.equal(next.status,'SECURITY_PENDING');assert.deepEqual(old.implementation,original.implementation);assert.deepEqual(old.reports,original.reports);
 assert.equal(command(g,'backend','draft.save',{graph:old.graph,revision:1}).ok,false);
 assert(command(g,'security','security.save',{changeId:next.id,nodeId:'backend-payment',text:'',revision:1}).ok);reviewForQa(g);execute(g);assert.equal(next.implementation!.security!.revision,2);assert.equal(workflow(g.companies[0]).runs.at(-1)!.changeId,next.id);
});

for(const spec of [
 {name:'two buyers last unit',scenario:{...DEFAULT_TEST,requests:2,concurrency:2,stock:1},oversold:1},
 {name:'100 concurrent',scenario:{...DEFAULT_TEST,requests:100,concurrency:100,stock:1},oversold:99},
 {name:'500 buyers limited stock',scenario:{...DEFAULT_TEST,requests:500,concurrency:500,stock:10},oversold:490},
 {name:'duplicate payments',scenario:{...DEFAULT_TEST,requests:2,concurrency:2,duplicateIntent:true}},
 {name:'payment retries',scenario:{...DEFAULT_TEST,retries:2}},
 {name:'no session',scenario:{...DEFAULT_TEST,authenticated:false,attack:'forged' as const}},
 {name:'foreign purchase',scenario:{...DEFAULT_TEST,ownsPurchase:false,attack:'forged' as const}},
 {name:'malicious input',scenario:{...DEFAULT_TEST,attack:'injection' as const}},
 {name:'bots',scenario:{...DEFAULT_TEST,attack:'bot' as const}},
])test(`E7 real isolated engine: ${spec.name}`,()=>{
 const g=candidate(),c=g.companies[0];reviewForQa(g);const before=structuredClone(c),job=createTestJob(c,g.changes[0],spec.scenario,887);for(let i=0;!advanceTestJob(job);i++)assert(i<10000);const report=testReport(job,3);
 assert.equal(report.requests,spec.scenario.requests);assert.equal(report.testEvidence!.outcomes.length,spec.scenario.requests);if(spec.oversold!==undefined)assert.equal(report.oversold,spec.oversold);assert.deepEqual(c,before);assert(report.testEvidence!.events!.length>0);assert(report.testEvidence!.outcomes.every(o=>o.customerId));
});

test('E7 repeat evidence remains deterministic through recovery, preserves original run and adds audit identity',()=>{
 let g=candidate();execute(g,{...DEFAULT_TEST,requests:100,concurrency:100,stock:1});const ch=g.changes[0],run=workflow(g.companies[0]).runs[0],observed=structuredClone(ch.reports[0].testEvidence);
 g=recoverGame(serializeGame(g));command(g,'operator','room.start');assert(command(g,'qa','qa.repeat',{runId:run.id}).ok);advanceGame(g,15);
 const repeat=g.changes[0].reports[1].testEvidence!;assert.deepEqual(repeat.outcomes,observed!.outcomes);assert.deepEqual(repeat.events,observed!.events);assert.deepEqual(repeat.observed,observed!.observed);assert.equal(repeat.graphHash,observed!.graphHash);assert.notEqual(repeat.runId,observed!.runId);assert.equal(workflow(g.companies[0]).runs[1].repeatOf,run.id);
});

test('E7 known failures remain visible on QA approval and CTO rejection/evidence/expiry never unlock Backend',()=>{
 const g=candidate(),ch=approved(g),c=g.companies[0];
 // A fresh failed run must be acknowledged by the student's audit, never erased.
 assert.equal(command(g,'cto','cto.decide',{changeId:ch.id,decision:'authorize',reason:'Validado',confirmed:false}).ok,false);
 assert(command(g,'cto','cto.decide',{changeId:ch.id,decision:'evidence',reason:'Necesito 200 compras simultáneas.',confirmed:true}).ok);assert.equal(ch.status,'QA_PENDING');assert(workflow(c).backendLock);
 assert(command(g,'qa','qa.review',{changeId:ch.id,risks:'Prueba limitada',evidenceIds:workflow(c).runs.map(r=>r.id)}).ok);
 assert(command(g,'cto','cto.decide',{changeId:ch.id,decision:'reject',reason:'Riesgo alto.',confirmed:true}).ok);assert.equal(ch.status,'QA_PENDING');assert(workflow(c).backendLock);
 command(g,'qa','qa.review',{changeId:ch.id,risks:'Aceptación explícita',evidenceIds:workflow(c).runs.map(r=>r.id)});command(g,'cto','cto.decide',{changeId:ch.id,decision:'authorize',reason:'Decido continuar.',confirmed:true});advanceGame(g,61);assert.equal(ch.status,'EXPIRED');assert.equal(ch.reserved,0);assert(workflow(c).backendLock);
 assert(command(g,'qa','change.cancel',{changeId:ch.id,reason:'Cierre formal.',confirmed:true}).ok);assert(!workflow(c).backendLock);
});

test('E7 investment reserves real money, funds one real deployment exactly once and releases leftovers',()=>{
 const g=start(),c=g.companies[0],capital=c.capital;
 assert(command(g,'cto','investment.create',{department:'backend',objective:'Investigo compras',justification:'Objetivo del equipo',maximum:500,confirmed:true}).ok);const order=workflow(c).investments[0];assert.equal(order.status,'REQUESTED');assert.equal(c.reserved,0);
 assert(command(g,'cto','investment.transition',{orderId:order.id,status:'AUTHORIZED',spent:0,confirmed:true}).ok);assert.equal(c.capital,capital);assert.equal(c.reserved,500);assert.equal(available(c),capital-c.infraBudget-500);
 assert(command(g,'backend','investment.transition',{orderId:order.id,status:'IN_PROGRESS',spent:0,confirmed:true}).ok);
 assert(command(g,'backend','change.submit',{graph:insertBlock('atomic'),revision:0}).ok);let ch=g.changes[0];assert(command(g,'backend','investment.link',{orderId:order.id,changeId:ch.id}).ok);approved(g);
 const reserved=c.reserved;assert(command(g,'cto','cto.decide',{changeId:ch.id,decision:'authorize',reason:'Presupuesto revisado.',confirmed:true}).ok);assert.equal(c.reserved,reserved);assert.equal(ch.reserved,0);
 assert.equal(command(g,'cto','investment.transition',{orderId:order.id,status:'CANCELLED',spent:0,confirmed:true}).ok,false);
 assert(command(g,'devops','deploy.start',{strategy:'rolling'},ch.id).ok);advanceGame(g,7);assert.equal(ch.status,'DEPLOYED');assert.equal(order.spent,ch.cost);assert.equal(order.reserved,500-ch.cost);
 assert(command(g,'cto','investment.transition',{orderId:order.id,status:'COMPLETED',spent:0,confirmed:true}).ok);assert.equal(order.reserved,0);assert.equal(c.reserved,0);const after=c.capital;
 assert.equal(command(g,'cto','investment.transition',{orderId:order.id,status:'COMPLETED',spent:0,confirmed:true}).ok,false);assert.equal(c.capital,after);
});

test('E7 insufficient capital, cancellations, expiry, role and company boundaries cannot create funds or bypass lock',()=>{
 const g=candidate(),c=g.companies[0],before=c.capital;
 assert.equal(command(g,'cto','investment.create',{department:'backend',objective:'Trabajo',justification:'Revisar',maximum:10000,confirmed:true}).ok,false);
 assert(command(g,'cto','investment.create',{department:'backend',objective:'Trabajo',justification:'Revisar',maximum:500,confirmed:true}).ok);const order=workflow(c).investments[0];command(g,'cto','investment.transition',{orderId:order.id,status:'AUTHORIZED',spent:0,confirmed:true});
 assert.equal(command(g,'backend','investment.transition',{orderId:order.id,status:'IN_PROGRESS',spent:0,confirmed:true}).ok,false);assert.equal(order.status,'AUTHORIZED');
 assert.equal(command(g,'cto','investment.transition',{orderId:order.id,status:'CANCELLED',spent:0,confirmed:true},undefined,1).ok,false);assert.equal(c.capital,before);
 command(g,'cto','investment.transition',{orderId:order.id,status:'CANCELLED',spent:0,confirmed:true});assert.equal(c.reserved,0);assert.equal(c.capital,before);
 assert(command(g,'cto','investment.create',{department:'security',objective:'Revisar',justification:'Investigar',maximum:300,confirmed:true}).ok);const exp=workflow(c).investments[1];command(g,'cto','investment.transition',{orderId:exp.id,status:'AUTHORIZED',spent:0,confirmed:true});advanceGame(g,301);assert.equal(exp.status,'CANCELLED');assert.equal(exp.reserved,0);assert(c.reserved>=0);
});

test('E7 informal QA interpretation is schema validated, persists a private conversation and executes only real engine results',async()=>{
 const g=candidate();reviewForQa(g);const ch=g.changes[0],input:AiInput={id:'informal',kind:'qa.interpret',text:'Hacé q dos compradores compren la ultima unidad al mismo tiempo',changeId:ch.id};
 let sent:any;const transport:typeof fetch=async(_url,init)=>{sent=JSON.parse(String(init!.body));return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({scenario:{...DEFAULT_TEST,requests:2,stock:1,concurrency:2},missing:[]})}],usage:{input_tokens:100,output_tokens:100}}));};
 const gateway=new AiGateway(new AnthropicProvider('synthetic','test-model',transport)),p=await prepareAi(g,actor('qa'),input,gateway);commitAi(g,actor('qa'),input,p);assert(!sent.messages[0].content.includes('defects'));assert(!sent.messages[0].content.includes('market.customers'));assert.equal(ch.reports.length,0);
 assert(command(g,'qa','ai.accept',{proposalId:p.id}).ok);advanceGame(g,2);assert.equal(ch.reports[0].requests,2);assert.equal(ch.reports[0].oversold,1);const restored=recoverGame(serializeGame(g));
 assert(restored.companies[0].runtime.conversations![0].messages.some(m=>m.text.includes('1 sobreventas')));assert.equal(project(g,actor('backend')).operations?.conversations?.length,0);assert(!JSON.stringify(project(g,actor('qa',1))).includes(input.text));
});

test('E7 isolated company/role/thread/generation contexts are compact and prohibit foreign references',async()=>{
 const g=start();for(let companyId=0;companyId<5;companyId++){const a=actor('cto',companyId),input:AiInput={id:`ask-${companyId}`,kind:'cto.interpret',text:`Private team ${companyId}`,threadId:'same-id'};const p=await prepareAi(g,a,input,new AiGateway(fixture({intent:'query',changeId:'',department:'backend',maximum:0,objective:'',justification:'',reason:''})));commitAi(g,a,input,p);}
 for(let companyId=0;companyId<5;companyId++){const ctx=JSON.stringify(aiContext(g,actor('cto',companyId),{id:'ctx',kind:'cto.interpret',text:'Consultar',threadId:'same-id'}).context);for(let rival=0;rival<5;rival++)assert.equal(ctx.includes(`Private team ${rival}`),companyId===rival);}
 assert.equal(aiContext(g,actor('cto'),{id:'other-thread',kind:'cto.interpret',text:'Consulta',threadId:'new'}).context.history.length,0);
 assert.throws(()=>aiContext(g,actor('qa'),{id:'wrong',kind:'cto.interpret',text:'Consulta'}));
 command(g,'operator','room.reset');assert(g.companies.every(c=>!c.runtime.conversations?.length));
});

test('E7 five simultaneous companies run independently, bounded queues use fair round robin and slow company cannot monopolize',async()=>{
 const scheduler=new AiScheduler(5,30,1000);let release!:()=>void;const gate=new Promise<void>(r=>release=r),began:number[]=[];
 const work=Array.from({length:5},(_,i)=>scheduler.schedule(String(i),`u${i}`,i,async()=>{began.push(i);await gate;return i;}));await delay(5);assert.deepEqual(began,[0,1,2,3,4]);assert.equal(scheduler.metrics().active,5);release();assert.deepEqual(await Promise.all(work),[0,1,2,3,4]);
 const serial=new AiScheduler(1,30,1000),order:number[]=[];let open!:()=>void;const first=serial.schedule('first','0-a',0,()=>new Promise<void>(r=>open=r));await delay(1);
 const queued=[serial.schedule('burst1','0-b',0,async()=>order.push(0)),serial.schedule('burst2','0-c',0,async()=>order.push(0)),...Array.from({length:4},(_,i)=>serial.schedule(`r${i}`,`${i+1}-a`,i+1,async()=>order.push(i+1)))];open();await Promise.all([first,...queued]);assert.deepEqual(order.slice(0,4),[1,2,3,4]);
});

test('E7 cancellations, timeout, full queue and per-user contention are observable and cannot commit a delayed result',async()=>{
 const scheduler=new AiScheduler(1,1,60),block=()=>new Promise<void>(()=>{});const running=scheduler.schedule('running','actor',0,block);const timed=assert.rejects(running,e=>(e as any).code==='TIMEOUT');
 await assert.rejects(async()=>scheduler.schedule('second','actor',0,async()=>1),e=>(e as any).code==='AI_BUSY');
 const queued=scheduler.schedule('queued','other',1,async()=>1);const cancelled=assert.rejects(queued,e=>(e as any).code==='CANCELLED');
 assert.throws(()=>scheduler.schedule('full','third',2,async()=>1),e=>(e as any).code==='AI_QUEUE_FULL');assert(scheduler.cancel('other','queued'));await cancelled;assert.equal(scheduler.status('other')[0].state,'CANCELLED');await timed;assert.equal(scheduler.status('actor')[0].state,'TIMEOUT');
});

test('E7 operator diagnostics distinguish missing config, auth, throttling, timeout, structured failures and real transport success',async()=>{
 const input:AiInput={id:'diag',kind:'security.propose',text:'Texto'};assert.equal(new AnthropicProvider('','').status().state,'MISSING_CREDENTIALS');assert.equal(new AnthropicProvider('x','').status().state,'MISSING_MODEL');assert.equal(new AnthropicProvider('x','m').status().state,'UNVERIFIED');
 for(const [status,expected]of [[401,'AUTHENTICATION_ERROR'],[429,'RATE_LIMIT'],[500,'PROVIDER_ERROR']] as const){const p=new AnthropicProvider('secret','m',async()=>new Response('secret upstream',{status,headers:{'retry-after':'60'}}));await assert.rejects(()=>p.generate(input,insertBlock('atomic')),e=>(e as any).code===expected);assert.equal(p.status().state,expected);assert(!JSON.stringify(p.status()).includes('secret'));}
 const bad=new AnthropicProvider('key','m',async()=>new Response('{}'));await assert.rejects(()=>bad.generate(input,insertBlock('atomic')));assert.equal(bad.status().state,'INVALID_OUTPUT');
 let calls=0;const good=new AnthropicProvider('key','m',async(_u,init)=>{calls++;assert.equal((init!.headers as any)['anthropic-workspace-id'],'wrkspc_test');return calls===1?new Response('{}',{status:429,headers:{'retry-after':'.001'}}):new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:'{"text":"Preparado"}'}],usage:{input_tokens:10,output_tokens:5}}));},'wrkspc_test');await good.generate(input,insertBlock('atomic'));assert.equal(calls,2);assert.equal(good.status().state,'AVAILABLE');assert.equal(good.status().last?.inputTokens,10);
 const timeout=new AnthropicProvider('key','m',async(_u,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true})));const controller=new AbortController();const wait=timeout.generate(input,insertBlock('atomic'),undefined,controller.signal);controller.abort();await assert.rejects(wait);assert.equal(timeout.status().state,'TIMEOUT');
});

test('E7 interrupted requests retain the human text through restart and cannot apply actions, money or fabricated outputs',async()=>{
 const g=candidate();reviewForQa(g);const input:AiInput={id:'interrupted',kind:'qa.interpret',text:'Probar dos personas con una unidad',changeId:g.changes[0].id};beginAiAttempt(g,actor('qa'),input);
 const restored=recoverGame(serializeGame(g));assert.equal(restored.companies[0].runtime.aiAttempts![0].state,'INTERRUPTED');assert.equal(restored.companies[0].runtime.conversations![0].messages[0].text,input.text);assert.equal(restored.changes[0].reports.length,0);assert.equal(restored.companies[0].reserved,0);
 for(const bad of [{scenario:{...DEFAULT_TEST,requests:5000},missing:[]},{scenario:DEFAULT_TEST,missing:[],results:{revenue:9999}},{scenario:null,missing:['atomic']}])assert.throws(()=>validateOutput('qa.interpret',bad));
 const query:AiInput={id:'autonomy',kind:'cto.interpret',text:'Autorizá el cambio',changeId:g.changes[0].id},out={intent:'authorize',changeId:g.changes[0].id,department:'backend',maximum:0,objective:'',justification:'',reason:'Autorizá'};const p=await prepareAi(g,actor('cto'),query,new AiGateway(fixture(out)));commitAi(g,actor('cto'),query,p);assert.equal(g.changes[0].status,'QA_PENDING');assert.equal(command(g,'cto','ai.accept',{proposalId:p.id}).ok,false);assert.equal(g.companies[0].reserved,0);
});


test('E7 live QA projection exposes bounded real progress only to its authorized investigator',()=>{
 const g=candidate();reviewForQa(g);const ch=g.changes[0];command(g,'qa','qa.execute',{changeId:ch.id,scenario:{...DEFAULT_TEST,requests:100,concurrency:100,stock:1}});advanceGame(g,.1);
 const live=project(g,actor('qa')).operations!.qaLive!;assert.equal(live.total,100);assert(live.requests.length<=12);assert.equal(live.elapsed,1);assert.equal(live.finished,0);assert.equal(project(g,actor('qa',1)).operations?.qaLive,undefined);assert.equal(project(g,actor('cto')).operations?.qaLive,undefined);assert(!JSON.stringify(live).includes('defect'));
});

test('E7 valid structured CTO intent with a missing budget cannot create even an unreserved investment order',async()=>{
 const g=start(),input:AiInput={id:'missing-budget',kind:'cto.interpret',text:'Quiero invertir en Seguridad.'};const p=await prepareAi(g,actor('cto'),input,new AiGateway(fixture({intent:'investment',changeId:'',department:'security',maximum:0,objective:'',justification:'',reason:''})));commitAi(g,actor('cto'),input,p);
 assert.equal(command(g,'cto','ai.confirm',{proposalId:p.id,confirmed:true}).ok,false);assert.equal(workflow(g.companies[0]).investments.length,0);assert.equal(g.companies[0].reserved,0);
});

test('E7 lengthy team documents are compacted by deterministic fields before provider I/O, originals stay intact',async()=>{
 const g=candidate();reviewForQa(g);const c=g.companies[0],state=workflow(c),long='Solicitud extensa del estudiante. '.repeat(120).slice(0,3900);
 for(let i=0;i<8;i++)state.investments.push({id:`I${i}`,companyId:0,cto:'0-cto',department:'security',objective:long,justification:long,maximum:500,reserved:0,spent:0,status:'REQUESTED',at:0,expires:300});
 const context=aiContext(g,actor('cto'),{id:'bounded',kind:'cto.interpret',text:'Consultar órdenes.'}).context;assert(JSON.stringify(context).length<20000);assert.equal(state.investments[0].objective.length,long.length);
 const input:AiInput={id:'bounded-query',kind:'cto.interpret',text:'Consultar órdenes.'};await prepareAi(g,actor('cto'),input,new AiGateway({name:'test',model:'bounded',async generate(_i,_graph,ctx){assert(JSON.stringify(ctx).length<48000);return {intent:'query',changeId:'',department:'security',maximum:0,objective:'',justification:'',reason:''};}}));
});

test('E7 explicit unauthenticated, foreign-owner, input and automated scenarios are attacks even without a categorical label',()=>{
 for(const suite of ['unit','load'] as const)for(const patch of [{authenticated:false},{ownsPurchase:false},{invalidInput:true},{automated:true}])for(const protectedFlow of [false,true]){
  const g=start();command(g,'security','security.prepare',{auth:protectedFlow,authorization:protectedFlow,waf:protectedFlow,botThreshold:protectedFlow?100:0,blockedOrigins:[],rate:null});const ch=g.changes[0],job=createTestJob(g.companies[0],ch,{...DEFAULT_TEST,suite,...patch});while(!advanceTestJob(job)){}const r=testReport(job,0);
  assert.equal(r.securityOutcomes!.attempts,1);assert.equal(r.securityOutcomes!.blocked,Number(protectedFlow));assert.equal(r.securityOutcomes!.successful,Number(!protectedFlow));assert.equal(r.securityOutcomes!.legitimateRejected,0);assert.equal(r.testEvidence!.passed,protectedFlow);assert.equal(r.completed,Number(!protectedFlow));
 }
});

test('E7 competing and public snapshots cannot read operational budgets or financial commitments',()=>{
 const g=start();g.companies[0].infraBudget=4321;g.companies[0].reserved=567;
 for(const view of [project(g,null),project(g,actor('cto',1)),project(g,actor('qa',1))]){assert.equal(view.companies[0].infraBudget,undefined);assert.equal(view.companies[0].reserved,undefined);}
 const own=project(g,actor('cto'));assert.equal(own.privateCompany!.infraBudget,4321);assert.equal(own.privateCompany!.reserved,567);const teacher=project(g,{id:'operator',role:'operator',companyId:null});assert.equal(teacher.companies[0].infraBudget,4321);assert.equal(teacher.companies[0].reserved,567);
});
