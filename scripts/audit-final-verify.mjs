// Read-only validation of committed evidence. Does not regenerate any report.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root='docs/benchmarks/final-hardening/',read=name=>JSON.parse(readFileSync(root+name,'utf8')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=read('evidence-manifest.json');assert.equal(manifest.format,1);
for(const file of manifest.files){assert.match(file.file,/^[A-Za-z0-9_.-]+$/);const bytes=readFileSync(root+file.file);assert.equal(bytes.length,file.bytes,file.file);assert.equal(sha(bytes),file.sha256,file.file);}
const runs=read('regression-runs.json');assert.equal(runs.length,7);assert(runs.every(r=>r.exitCode===0));
for(const run of runs)for(const file of run.evidence){const packed=readFileSync(root+file.file);assert.equal(sha(packed),file.sha256Gzip);assert.equal(sha(gunzipSync(packed)),file.sha256Raw);}
const final=read('final-verification.json');assert.equal(final.tests.passed,232);assert.equal(final.tests.failed,0);assert.equal(final.exactReconstructions,176);assert.equal(final.liveExactFrames,72);
for(const run of final.classroomRuns){assert.equal(run.result,'passed');assert.equal(run.budgets.allCommandAckP95Below150,false);}
assert.equal(final.classroomRuns.find(r=>r.label==='certified-1500s-20x').budgets.eventLoopP99Below150,false);
console.log(JSON.stringify({verified:true,evidenceFiles:manifest.files.length,tests:232,exactReconstructions:176,liveExactFrames:72,latencyExceptionsPreserved:true}));
