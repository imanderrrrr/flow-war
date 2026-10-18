import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createGame, project, reportFor, step } from '../server/engine.js';
import { admitTraffic, initialTraffic, trafficParticles, TRAFFIC_SCENARIO } from '../server/traffic.js';
import { createGameWriter } from '../server/storage.js';
import { recoverGame } from '../server/persistence.js';
import { advanceGame, authorizeAtomic, command, insertBlock } from './helpers.js';
import { advanceLoadRun, createLoadRun, loadReport } from '../server/load.js';

function dbFixture() { const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE commands (identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');return {db,write:createGameWriter(db)}; }

test('one real initial legitimate request per company, counted once and preserved through pause/reconnect', () => {
  const game=createGame();assert.ok(project(game,null).companies.every(c=>c.particles.length===0&&c.utilization===0&&c.traffic.metrics.latencyMs===null));
  command(game,'operator','room.start');
  for(const company of game.companies){assert.equal(company.requests,1);assert.equal(company.traffic.legitimate.generated,1);const sprites=project(game,null).companies[company.id].particles;assert.equal(sprites.length,1);assert.ok(company.traffic.requests[sprites[0].requestId!]);}
  command(game,'operator','room.pause');command(game,'operator','room.start');command(game,'operator','room.start');
  advanceGame(game,1);assert.ok(game.companies.every(c=>c.traffic.totals.generated===1));
});

test('T11/T20 FIFO, fractional credits, deadlines and effects survive a committed snapshot and recovery', () => {
  const {db,write}=dbFixture();
  try{
    const game=createGame();command(game,'operator','room.start');const company=game.companies[0];company.traffic.config.rates.web=1;
    for(let i=0;i<20;i++)admitTraffic(company,0,i%2?'purchase':'browse');advanceGame(game,1.5);
    const waiting=[...company.traffic.services.web.waiting];assert.ok(waiting.length>5);write(game);
    const recovered=recoverGame((db.prepare('SELECT state FROM game WHERE id=1').get() as {state:string}).state);
    assert.deepEqual(recovered.companies[0].traffic.services.web.waiting,waiting);assert.equal(recovered.status,'PAUSED');
    command(recovered,'operator','room.start');advanceGame(recovered,12);advanceGame(game,12);
    assert.deepEqual(recovered.companies[0].traffic.totals,game.companies[0].traffic.totals);
    assert.equal(recovered.companies[0].capital,game.companies[0].capital);assert.equal(recovered.companies[0].stock,game.companies[0].stock);
    write(recovered);const count=Number((db.prepare('SELECT count(*) AS n FROM request_receipts').get() as {n:number}).n);
    write(recovered);assert.equal(Number((db.prepare('SELECT count(*) AS n FROM request_receipts').get() as {n:number}).n),count);
    const row=db.prepare('SELECT receipt FROM request_receipts WHERE id=?').get(waiting[0]) as {receipt:string};const receipt=JSON.parse(row.receipt);
    assert.ok(receipt.finishedAt>=receipt.arrivalAt);assert.ok(receipt.waits.some((visit:{service:string})=>visit.service==='web'));
    assert.equal(receipt.accounted,true);
  }finally{db.close();}
});

test('a failed SQLite transaction retains its receipts and leaves state/ledger unchanged on disk', () => {
  const {db,write}=dbFixture();try{const game=createGame();command(game,'operator','room.start');advanceGame(game,1);const outbox=structuredClone(game.companies[0].traffic.outbox);
    db.exec("CREATE TRIGGER fail_write BEFORE INSERT ON game BEGIN SELECT RAISE(FAIL,'test disk failure'); END");assert.throws(()=>write(game));
    assert.deepEqual(game.companies[0].traffic.outbox,outbox);assert.equal((db.prepare('SELECT count(*) AS n FROM request_receipts').get() as {n:number}).n,0);
    db.exec('DROP TRIGGER fail_write');write(game);assert.equal(game.companies[0].traffic.outbox.length,0);
  }finally{db.close();}
});

test('T12 pause freezes queues, operations, deadlines, money and QA load jobs', () => {
  const game=createGame();command(game,'operator','room.start');command(game,'backend','change.submit',{graph:insertBlock('atomic'),revision:0});command(game,'qa','qa.run',{suite:'Carga'},game.changes[0].id);
  for(let i=0;i<30;i++)admitTraffic(game.companies[0],0,'purchase');advanceGame(game,.5);command(game,'operator','room.pause');const before=structuredClone(game);advanceGame(game,100);assert.deepEqual(game,before);
});

test('T13 a normal queued request keeps its release across publication; the next admission uses the new one', () => {
  const game=createGame();game.status='RUNNING';authorizeAtomic(game,'rolling');const company=game.companies[0];const before=admitTraffic(company,game.tick,'purchase');
  advanceGame(game,6.1);assert.equal(company.version,2);assert.equal(before.executionVersion,1);assert.ok(!before.path.some(node=>node.type==='atomic'));
  const after=admitTraffic(company,game.tick,'purchase');assert.equal(after.executionVersion,2);assert.ok(after.path.some(node=>node.type==='atomic'));advanceGame(game,12);
  assert.ok(before.result);assert.ok(after.result);assert.equal(before.accounted,true);assert.equal(after.accounted,true);
});

test('T14/T16 private projections and foreign-role commands cannot expose or mutate another company runtime', () => {
  const game=createGame();command(game,'operator','room.start');const before=structuredClone(game);
  assert.equal(command(game,'backend','deploy.start').code,'FORBIDDEN');assert.equal(command(game,'qa','cto.budget',{amount:1000}).code,'FORBIDDEN');
  const anonymous=project(game,null),own=project(game,{id:'qa0',role:'qa',companyId:0});
  assert.equal('requests' in anonymous.companies[0].traffic,false);assert.equal('requests' in own.privateCompany!.traffic,false);assert.equal('services' in own.privateCompany!.traffic,false);
  assert.deepEqual(game,before);
});

test('T15 same seed and commands are invariant to projection frequency, sprite limit and timestep batching', () => {
  const a=createGame(),b=createGame();command(a,'operator','room.start');command(b,'operator','room.start');
  for(let i=0;i<200;i++){step(a,.2);step(b);project(b,null);trafficParticles(b.companies[0],b.tick,1);step(b);trafficParticles(b.companies[1],b.tick,88);}
  assert.deepEqual(a,b);
  const cohorts=a.companies.map(company=>Object.values(company.traffic.requests).map(request=>[request.arrivalAt,request.type,request.trafficClass]));
  for(const cohort of cohorts)assert.deepEqual(cohort,cohorts[0]);
});

test('observed sustained failures raise pressure and lower reputation without treating blocked attacks as dissatisfaction', () => {
  const healthy=createGame(),unavailable=createGame();command(healthy,'operator','room.start');command(unavailable,'operator','room.start');unavailable.companies[0].infraBudget=0;
  advanceGame(healthy,20);advanceGame(unavailable,20);
  assert.ok(unavailable.companies[0].pressure>healthy.companies[0].pressure);assert.ok(unavailable.companies[0].reputation<healthy.companies[0].reputation);
  assert.ok(unavailable.companies[0].traffic.legitimate.abandoned>0);assert.ok(unavailable.companies[0].traffic.metrics.unavailable>0);
});

test('healthy observed normal traffic improves reputation without a latency penalty inherited from aggregate formulas', () => {
  const game=createGame();command(game,'operator','room.start');advanceGame(game,100);
  for(const company of game.companies){assert.equal(company.traffic.legitimate.abandoned,0);assert.equal(company.pressure,0);assert.ok(company.reputation>83);assert.ok(company.traffic.metrics.latencyMs!<company.traffic.config.quality.healthyLatencyMs);}
});

test('T19 Carga executes real FIFO work and observed deadlines without mutating production', () => {
  const game=createGame();game.status='RUNNING';command(game,'backend','change.submit',{graph:game.companies[0].backend,revision:0});
  const before=structuredClone(game),report=reportFor(game,game.changes[0],'Carga');assert.deepEqual(game,before);
  assert.equal(report.requests,320);assert.ok(report.completed>0);assert.ok(report.rejected>0);assert.ok(report.abandoned!>0);assert.ok(report.loadEvidence!.maxQueue>0);
  assert.equal(report.loadEvidence!.pending,0);assert.equal(report.requests,report.completed+report.rejected+report.abandoned!+report.failed!);assert.ok(report.latency>0);
  assert.deepEqual(reportFor(game,game.changes[0],'Carga'),report);
});

test('a pending isolated load job resumes deterministically after a restart', () => {
  const game=createGame();game.status='RUNNING';command(game,'backend','change.submit',{graph:game.companies[0].backend,revision:0});const id=game.changes[0].id;command(game,'qa','qa.run',{suite:'Carga'},id);advanceGame(game,.5);
  const recovered=recoverGame(JSON.stringify(game));command(recovered,'operator','room.start');advanceGame(recovered,3);advanceGame(game,3);
  assert.deepEqual(recovered.changes[0].reports,game.changes[0].reports);assert.equal(recovered.changes[0].reports.length,1);
});

test('bounded retention keeps terminal receipts for audit while releasing full request contexts from memory', () => {
  const game=createGame();command(game,'operator','room.start');const company=game.companies[0];const first=Object.keys(company.traffic.requests)[0];advanceGame(game,20);
  assert.equal(company.traffic.requests[first],undefined);assert.ok(company.traffic.outbox.some(receipt=>receipt.id===first));
  assert.ok(company.traffic.capacityWindow.length<=100);assert.ok(Object.values(company.traffic.requests).every(request=>!request.result||game.tick-request.result.at<=10));
});

test('schema 2 upgrades preserve pending LAST-UNIT and historic counters without recreating ordinary traffic', () => {
  const legacy=JSON.parse(JSON.stringify(createGame()));legacy.schema=2;legacy.tick=350;legacy.status='RUNNING';delete legacy.generation;
  for(const company of legacy.companies)delete company.traffic;
  legacy.companies[0].requests=140;legacy.companies[0].successes=99;legacy.companies[0].errors=11;
  const recovered=recoverGame(JSON.stringify(legacy));assert.equal(recovered.schema,3);assert.equal(recovered.status,'PAUSED');
  assert.deepEqual(recovered.companies[0].concurrency,legacy.companies[0].concurrency);assert.equal(recovered.companies[0].requests,140);assert.equal(recovered.companies[0].traffic.totals.generated,0);
  command(recovered,'operator','room.start');assert.equal(recovered.companies[0].traffic.totals.generated,0);
});

test('an upgraded lobby issues its first real request; legacy queue estimates never become phantom pending jobs', () => {
  const legacy=JSON.parse(JSON.stringify(createGame()));legacy.schema=2;delete legacy.generation;
  for(const company of legacy.companies){delete company.traffic;company.queue=40;company.active=91;}
  const game=recoverGame(JSON.stringify(legacy));assert.equal(game.companies[0].queue,0);assert.equal(game.companies[0].active,0);
  assert.equal(game.companies[0].traffic.legacyMetrics?.queue,40);command(game,'operator','room.start');
  assert.ok(game.companies.every(company=>company.traffic.totals.generated===1));
});

test('reset archives pending results and namespaces the next room so receipts cannot collide', () => {
  const {db,write}=dbFixture();try{const game=createGame();command(game,'operator','room.start');const old=Object.keys(game.companies[0].traffic.requests)[0];
    command(game,'operator','room.reset');write(game);const receipt=JSON.parse((db.prepare('SELECT receipt FROM request_receipts WHERE id=?').get(old) as {receipt:string}).receipt);
    assert.equal(receipt.status,'ABANDONED');assert.equal(receipt.accounted,true);command(game,'operator','room.start');const next=Object.keys(game.companies[0].traffic.requests)[0];assert.notEqual(old,next);
    advanceGame(game,1);write(game);assert.ok(db.prepare('SELECT id FROM request_receipts WHERE id=?').get(next));
  }finally{db.close();}
});

test('read-only queries never write, pay or generate commercial revenue and recover their own route', () => {
  const {db,write}=dbFixture();try{const game=createGame();game.status='RUNNING';const company=game.companies[0];const request=admitTraffic(company,0,'query');
    write(game);const recovered=recoverGame((db.prepare('SELECT state FROM game').get() as {state:string}).state);command(recovered,'operator','room.start');advanceGame(recovered,2);
    const query=recovered.companies[0].traffic.requests[request.id];assert.equal(query.status,'COMPLETED');assert.equal(query.paid,false);assert.equal(query.committed,0);assert.equal(query.result?.revenue,0);assert.equal(query.result?.lostRevenue,0);
    assert.deepEqual(query.path.map(node=>node.type),['entry','read','exit']);
  }finally{db.close();}
});
