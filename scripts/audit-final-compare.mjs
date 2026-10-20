import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const root='docs/benchmarks/final-hardening/';
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
const result={sha:current.commit,date:new Date().toISOString(),reference:'dd88729949dabbbf8c216c265dd580eef071a5aa',publishedReference:'docs/benchmarks/entrega-5-resultados.json',scenarios:22,exactReconstructions:176,economicEngineUnchanged:true,projection:'Same published sample/field/effect projection as entrega5-report.mjs; all 176 state hashes compared literally.',comparisons};writeFileSync(root+'economic-regression.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({scenarios:22,exactReconstructions:176,economyExact:true,forensicsExact:true}));
