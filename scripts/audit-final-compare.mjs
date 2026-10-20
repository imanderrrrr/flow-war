import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root='docs/benchmarks/final-hardening/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');for(const run of JSON.parse(readFileSync(root+'regression-runs.json','utf8')))for(const file of run.evidence){const packed=readFileSync(root+file.file);assert.equal(sha(packed),file.sha256Gzip);assert.equal(sha(gunzipSync(packed)),file.sha256Raw);}
const current=JSON.parse(gunzipSync(readFileSync(root+'entrega5-benchmark.json.gz'))),original=JSON.parse(readFileSync('docs/benchmarks/entrega-5-resultados.json','utf8'));
const comparisons=[];
for(const sample of current.results){
 const base=original.results.find(r=>r.name===sample.name&&r.duration===sample.duration);assert(base);
 for(const key of ['final','forensic'])assert.deepEqual(sample[key],base[key],`${sample.name}/${sample.duration}: ${key}`);
 const fields=['id','customers','capital','reputation','pressure','migratedIn','migratedOut','arrived','abandoned','rejected','servers','eliminated'];
 const samples=sample.samples.filter(s=>[60,600,660,720,sample.duration].includes(s.tick)).map(({companies,...s})=>({...s,companies:companies.map(c=>Object.fromEntries(fields.map(key=>[key,c[key]])))}));
 const effects=sample.effects.filter(e=>['infra.maintenance','module.create','deploy.start','chat.send','room.pause'].includes(e.type));
 assert.deepEqual(samples,base.samples);assert.deepEqual(effects,base.effects);assert.equal(sample.seeks.length,base.seeks.length);
 sample.seeks.forEach((seek,i)=>assert.equal(seek.digest,base.seeks[i].digest,`${sample.name}/${sample.duration}@${seek.at}`));
 comparisons.push({name:sample.name,duration:sample.duration,reconstructions:sample.seeks.length,economyExact:true,forensicsExact:true,tick:sample.tick,persist:sample.persist,peakHeapMiB:sample.peakHeapMiB,dbBytes:sample.dbBytes});
}
assert.equal(comparisons.length,22);assert.equal(comparisons.reduce((n,r)=>n+r.reconstructions,0),176);
execFileSync('git',['diff','--exit-code','dd88729949dabbbf8c216c265dd580eef071a5aa','--','server/engine.ts','server/traffic.ts','server/market.ts','server/requests.ts','server/defects.ts','server/scenarios.ts','server/module-execution.ts']);
const priorRoot='docs/benchmarks/audit-fixes/';
const packed=(dir,name)=>JSON.parse(gunzipSync(readFileSync(dir+name+'.gz')));
const inherited=[];
function compareCases(group,now,prior,fields){assert.equal(now.length,prior.length);for(let i=0;i<now.length;i++){for(const field of fields)assert.deepEqual(now[i][field],prior[i][field],`${group}/${i}/${field}`);inherited.push({group,duration:now[i].duration,strategy:now[i].strategy,control:now[i].control??group.endsWith('controls'),identicalComparableResults:true});}}
const traffic=packed(root,'traffic-benchmark-traffic-2.0-market-3.0.json'),oldTraffic=JSON.parse(readFileSync(priorRoot+'new-traffic-benchmark-traffic-2.0-market-3.0.json','utf8'));
compareCases('traffic',traffic.results,oldTraffic.results,['version','duration','strategy','seed','finalTick','status','audited','conservationChecks','companies']);assert.deepEqual(traffic.load,oldTraffic.load);
const market=packed(root,'market-benchmark-market-3.0.json'),oldMarket=packed(priorRoot,'new-market-benchmark-market-3.0.json');
for(const group of ['results','controls'])compareCases('market-'+group,market[group],oldMarket[group],['duration','strategy','migrations','config','seed','finalTick','status','saveCadenceSeconds','populationChecks','requestChecks','archivedReceipts','population','unserved','totals','novaVertexThenOut','deadlines','administrativeAbandons','companies','samples']);
const actions=packed(root,'actions-benchmark-4a.json'),oldActions=packed(priorRoot,'new-actions-benchmark-4a.json');
for(const group of ['results','controls'])compareCases('actions-'+group,actions[group],oldActions[group],['strategy','control','duration','seed','recovered','finalTick','saveCadenceSeconds','checks','receipts','final','samples','causes']);assert.equal(inherited.length,42);
const result={sha:current.commit,date:new Date().toISOString(),reference:'dd88729949dabbbf8c216c265dd580eef071a5aa',publishedReference:'docs/benchmarks/entrega-5-resultados.json',scenarios:22,exactReconstructions:176,economicEngineUnchanged:true,inheritedComparableCases:42,inherited,excludedNonComparableFields:'Timings, memory/size samples, serialized market digest with receivedAt wall-clock timestamps and optional prior-local baseline. Published economic states, samples, action causes and all 176 forensic hashes are compared unchanged.',projection:'Same published sample/field/effect projection as entrega5-report.mjs; all 176 state hashes compared literally.',comparisons};writeFileSync(root+'economic-regression.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({scenarios:22,exactReconstructions:176,inheritedComparableCases:42,economyExact:true,forensicsExact:true}));
