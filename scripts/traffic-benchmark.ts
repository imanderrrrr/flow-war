import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as current from '../server/engine.js';
import { createGameWriter } from '../server/storage.js';
import { runLoadFixture } from '../server/load.js';
import type { GameState } from '../shared/types.js';

const baseArgument = process.argv.find(arg => arg.startsWith('--baseline='));
const engine: typeof current = baseArgument ? await import(pathToFileURL(resolve(baseArgument.slice(11), 'server/engine.ts')).href) : current;
const version = baseArgument ? 'eae4bbf' : 'traffic-2.0';
const results: unknown[] = [];
for (const duration of [1200, 1500]) for (const strategy of ['baseline', 'scaled', 'protected-scaled']) {
  const directory = mkdtempSync(join(tmpdir(), 'flow-war-benchmark-'));
  const dbPath = join(directory, 'audit.sqlite'), db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE commands (identity TEXT,id TEXT,digest TEXT,result TEXT,PRIMARY KEY(identity,id))');
  const writer = baseArgument ? undefined : createGameWriter(db);
  const game = engine.createGame(duration, 7357);
  let commandSequence = 0;
  const command = (role: 'operator' | 'cto' | 'devops' | 'backend' | 'security' | 'qa', type: string, payload: Record<string,unknown> = {}, companyId = 0) => {
    const result = engine.applyCommand(game, { id: `bench-${role}-${companyId}`, role, companyId: role === 'operator' ? null : companyId }, { id: `bench-${++commandSequence}`, type, companyId, payload });
    if (!result.ok) throw new Error(`${type}: ${result.error}`);
  };
  command('operator', 'room.start');
  const changeCommand = (role: 'backend' | 'security' | 'qa' | 'cto' | 'devops', type: string, companyId: number, payload: Record<string,unknown> = {}) => {
    const change = game.changes.find(item=>item.companyId===companyId);
    const result = engine.applyCommand(game,{id:`bench-${role}-${companyId}`,role,companyId},{id:`bench-${++commandSequence}`,type,companyId,changeId:change?.id,payload});
    if(!result.ok)throw new Error(`${type}: ${result.error}`);
  };
  const insert = (graph: ReturnType<typeof engine.initialGraph>, type: string, before: string, value: number) => {
    const target=graph.nodes.find(node=>node.type===before)!,edge=graph.edges.find(edge=>edge.target===target.id)!;
    graph.nodes.push({id:`bench-${type}`,type,position:{x:0,y:0},data:{label:type,value}});
    graph.edges=graph.edges.filter(item=>item.id!==edge.id);graph.edges.push({id:`${type}-a`,source:edge.source,target:`bench-${type}`},{id:`${type}-b`,source:`bench-${type}`,target:target.id});return graph;
  };
  const ticks: number[] = [], saves: number[] = [];
  const peak = { pendingAndRecent: 0, outbox: 0, queue: 0, heapMB: 0, snapshotKB: 0 };
  let conservationChecks = 0, audited = 0;
  const started = performance.now();
  try {
    while (game.status === 'RUNNING') {
      if (strategy === 'protected-scaled') {
        if(game.tick===10)for(const company of game.companies){changeCommand('backend','change.submit',company.id,{graph:insert(engine.initialGraph('backend'),'atomic','write',1),revision:0});changeCommand('qa','qa.run',company.id,{suite:'Concurrencia'});}
        if(game.tick===15||game.tick===28)for(const company of game.companies){changeCommand('qa','qa.approve',company.id);changeCommand('cto','cto.authorize',company.id);changeCommand('devops','deploy.start',company.id,{strategy:'rolling'});}
        if(game.tick===23)for(const company of game.companies){let graph=engine.initialGraph('security');graph=insert(graph,'auth','exit',1);graph=insert(graph,'waf','exit',1);graph=insert(graph,'bot','exit',100);changeCommand('security','change.submit',company.id,{graph,revision:0});changeCommand('qa','qa.run',company.id,{suite:'Seguridad'});}
      }
      if (strategy !== 'baseline' && game.tick === 300) for (const company of game.companies) {
        for(let budget=0;budget<(strategy==='protected-scaled'?6:2);budget++)command('cto','cto.budget',{amount:1000},company.id);
        for (let server = 1; server < (strategy==='protected-scaled'?8:4); server++) command('devops', 'infra.scale', { delta: 1 }, company.id);
        command('devops', 'infra.balancer', { enabled: true }, company.id);
      }
      const before = performance.now(); engine.step(game); ticks.push(performance.now() - before);
      if (!baseArgument) for (const company of game.companies) {
        const state = company.traffic, totals = state.totals;
        const requests = Object.values(state.requests), pending = requests.filter(request => !request.result).length;
        if (totals.generated !== pending + totals.completed + totals.rejected + totals.abandoned + totals.failed) throw new Error('Request conservation failed');
        if (company.requests !== totals.generated + company.concurrency.totals.generated) throw new Error('Cohorts counted twice');
        if (company.revenue !== totals.revenue + company.concurrency.totals.revenue || company.lostRevenue !== totals.lostRevenue + company.concurrency.totals.lostRevenue) throw new Error('Economic reconciliation failed');
        conservationChecks++;
        peak.pendingAndRecent = Math.max(peak.pendingAndRecent, requests.length); peak.outbox = Math.max(peak.outbox, state.outbox.length);
      }
      peak.queue = Math.max(peak.queue, ...game.companies.map(company => company.queue));
      if (Math.round(game.tick * 10) % 10 === 0 || game.tick >= duration) {
        if (writer) {
          audited += game.companies.reduce((sum, company) => sum + company.traffic.outbox.length, 0);
          const beforeSave = performance.now(); writer(game); saves.push(performance.now() - beforeSave);
        }
      }
      if (Math.round(game.tick * 10) % 100 === 0) {
        peak.heapMB = Math.max(peak.heapMB, process.memoryUsage().heapUsed / 1024 ** 2);
        peak.snapshotKB = Math.max(peak.snapshotKB, JSON.stringify(engine.project(game, { id: 'bench', role: 'qa', companyId: 0 })).length / 1024);
      }
    }
    const percentile = (samples: number[], fraction: number) => { const sorted = [...samples].sort((a,b)=>a-b); return Math.round((sorted[Math.min(sorted.length-1, Math.floor(sorted.length*fraction))] ?? 0)*1000)/1000; };
    const elapsed = performance.now() - started;
    const result = {
      version, duration, strategy, seed:7357, finalTick:game.tick, status:game.status, wallSeconds:Math.round(elapsed)/1000,
      tickP95ms:percentile(ticks,.95), tickMaxMs:percentile(ticks,1), saveP95ms:percentile(saves,.95), peak, audited, conservationChecks,
      companies:game.companies.map(company=>({ id:company.id, customers:company.customers, capital:Math.round(company.capital), pressure:Math.round(company.pressure), reputation:Math.round(company.reputation), requests:company.requests, successes:company.successes, errors:company.errors, revenue:company.revenue, lostRevenue:company.lostRevenue,
        ...(baseArgument ? { unclassified:company.requests-company.successes-company.errors, latencyFormula:company.latency } : { traffic:company.traffic.totals, legitimate:company.traffic.legitimate, malicious:company.traffic.malicious, unresolved:company.traffic.unresolvedCount }) })),
    };
    if (writer && (db.prepare('SELECT count(*) AS n FROM request_receipts').get() as {n:number}).n !== audited) throw new Error('Receipt archive lost or duplicated records');
    results.push(result); console.log(JSON.stringify(result));
  } finally { db.close(); rmSync(directory,{recursive:true,force:true}); }
}
const output = resolve('artifacts'); mkdirSync(output,{recursive:true});
const load = baseArgument ? undefined : runLoadFixture(current.createGame().companies[0], {backend:current.initialGraph('backend'),security:current.initialGraph('security'),executionVersion:1},0);
writeFileSync(join(output,`traffic-benchmark-${version}.json`),JSON.stringify({ hardware:{node:process.version,cpu:cpus()[0]?.model,cores:cpus().length,memoryGB:Math.round(totalmem()/1024**3)}, results, load },null,2));
