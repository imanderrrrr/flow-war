import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root='docs/benchmarks/audit-fixes/',read=name=>JSON.parse(existsSync(root+name)?readFileSync(root+name,'utf8'):gunzipSync(readFileSync(root+name+'.gz')).toString());
if(existsSync(root+'compressed-evidence-manifest.json')){for(const file of read('compressed-evidence-manifest.json').files){const packed=readFileSync(root+file.file),raw=gunzipSync(packed),sha=value=>createHash('sha256').update(value).digest('hex');assert.equal(sha(packed),file.sha256Compressed);assert.equal(sha(raw),file.sha256Uncompressed);}}
const original=JSON.parse(readFileSync('docs/benchmarks/entrega-5-resultados.json','utf8')),current=read('new-entrega5-benchmark.json'),comparisons=[];
for(const sample of current.results){
 const base=original.results.find(r=>r.name===sample.name&&r.duration===sample.duration);assert(base,'Missing original scenario');
 for(const key of ['final','forensic'])assert.deepEqual(sample[key],base[key],`${sample.name}/${sample.duration}: ${key}`);
 // The published reference used this exact projection in entrega5-report.mjs; raw hashes below are never normalized.
 const fields=['id','customers','capital','reputation','pressure','migratedIn','migratedOut','arrived','abandoned','rejected','servers','eliminated'];
 const samples=sample.samples.filter(s=>[60,600,660,720,sample.duration].includes(s.tick)).map(({companies,...s})=>({...s,companies:companies.map(c=>Object.fromEntries(fields.map(key=>[key,c[key]])))}));
 const effects=sample.effects.filter(e=>['infra.maintenance','module.create','deploy.start','chat.send','room.pause'].includes(e.type));
 assert.deepEqual(samples,base.samples,`${sample.name}/${sample.duration}: published samples`);assert.deepEqual(effects,base.effects,`${sample.name}/${sample.duration}: published effects`);
 assert.equal(sample.seeks.length,base.seeks.length);
 for(let i=0;i<sample.seeks.length;i++)assert.equal(sample.seeks[i].digest,base.seeks[i].digest,`${sample.name}/${sample.duration}@${sample.seeks[i].at}`);
 comparisons.push({name:sample.name,duration:sample.duration,exactReconstructions:sample.seeks.length,identicalEconomy:true,identicalForensics:true,original:{tick:base.tick,persist:base.persist,heapMiB:base.peakHeapMiB,dbBytes:base.dbBytes,journalBytes:base.journalBytes,maxSeekMs:Math.max(...base.seeks.map(s=>s.ms))},current:{tick:sample.tick,persist:sample.persist,heapMiB:sample.peakHeapMiB,dbBytes:sample.dbBytes,journalBytes:sample.journalBytes,maxSeekMs:Math.max(...sample.seeks.map(s=>s.ms))}});
}
assert.equal(comparisons.length,22);assert.deepEqual(read('baseline.json').economy,read('after.json').economy);
const before=read('load-before.json'),after=read('load-after.json'),longBefore=read('load-long-before.json'),longAfter=read('load-long-after.json'),storage=read('storage.json');
assert.equal(after.errors,0);assert.equal(after.chatDeliveries,3);assert.equal(after.queryStatus['200'],24);assert(after.eventLoop.p99<75);assert(after.engineIntervalMs.p95<150);assert(after.commandAckMs.p95<100);assert.equal(longAfter.errors,0);assert.equal(longAfter.chatDeliveries,3);assert.equal(longAfter.queryStatus['200'],24);assert(longAfter.eventLoop.p99<150);assert(longAfter.engineIntervalMs.p95<200);assert(longAfter.commandAckMs.p95<150);
const result={reference:'c86d32058f0fd1741e27e6397f6124a1f1a4b62b',measuredCommit:current.commit,hardware:current.hardware,scenarios:comparisons.length,exactReconstructions:comparisons.reduce((n,c)=>n+c.exactReconstructions,0),allOriginalComparableEconomicAndForensicResultsIdentical:true,publishedReferenceProjection:'Same sample/company/effect projection as scripts/entrega5-report.mjs; all state digests compared verbatim',heavyLoad:{before:longBefore,after:longAfter,acceptance:{eventLoopP99BelowMs:150,engineIntervalP95BelowMs:200,commandAckP95BelowMs:150,scope:'1200-second finished generation plus an independently simulated active generation at 900 seconds, speed 20, 3 clients, 24 successful DVR queries.'}},load:{before,after,acceptance:{eventLoopP99BelowMs:75,engineIntervalP95BelowMs:150,commandAckP95BelowMs:100,scope:'Dedicated local 120-second historical fixture; 100ms engine cadence, 3 clients, 2 concurrent DVR lanes; does not assert universal hardware/network capacity.'}},storage:{savedBytes:storage.savedPhysicalBytes,savedPercent:storage.savedPercent,receiptDigest:storage.receiptDigest},comparisons};
writeFileSync(root+'comparison.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({scenarios:result.scenarios,exactReconstructions:result.exactReconstructions,identical:true,loadAcceptance:'passed',savedPercent:storage.savedPercent}));
