import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const path=process.argv[2]??'artifacts/actions-benchmark-4a.json';
const report=JSON.parse(readFileSync(path,'utf8'));
assert.equal(report.results.length,16);assert.equal(report.controls.length,2);
const checks:{duration:number;scenario:string;evidence:unknown}[]=[];
for(const r of report.results) {
  const company=(sample:any,id=0)=>sample.companies[id];
  const causes=r.causes as any[],samples=r.samples as any[];
  assert.equal(r.finalTick,r.duration);assert.equal(r.final.population,5000);
  for(const sample of [...samples,r.final])assert.equal(sample.companies.reduce((n:number,c:any)=>n+c.customers,sample.unserved),5000);
  let evidence:unknown;
  switch(r.strategy) {
    case 'A-equivalent': assert.equal(new Set(r.final.companies.map((c:any)=>JSON.stringify([c.customers,c.capital,c.revenue,c.pressure]))).size,1);evidence={customers:r.final.companies.map((c:any)=>c.customers),modules:r.final.modules};break;
    case 'B-restart': {
      const restart=causes.find(c=>c.command.type==='infra.restart_all');assert.equal(restart.webRate,0);
      const before=[...samples].reverse().find(s=>s.tick<=restart.at)!,after=samples.find(s=>s.tick>=restart.at+20)!;
      assert.ok(company(after).abandoned>company(before).abandoned);
      evidence={at:restart.at,capacity:restart.webRate,abandonedBefore:company(before).abandoned,abandonedAfter:company(after).abandoned};break;
    }
    case 'C-insufficient': {
      const change=r.final.tests.find((t:any)=>t.reports.some((q:any)=>q.suite==='unit'));assert.equal(change.status,'DEPLOYED');assert.equal(change.reports[0].passed,true);assert.ok(r.final.defectActivations[0].D02>0);
      assert.ok(samples.filter(s=>s.tick<100).every(s=>(s.defectActivations[0].D02??0)===0));
      evidence={change:change.id,status:change.status,unitPassed:true,discountActivations:r.final.defectActivations[0].D02};break;
    }
    case 'D-exhaustive': {
      const change=r.final.tests.find((t:any)=>t.reports.some((q:any)=>q.suite==='integration'));assert.equal(change.status,'QA_REJECTED');assert.equal(change.reports[0].passed,false);assert.equal(change.reports[0].observed.revenue,28.8);
      evidence={change:change.id,status:change.status,observed:change.reports[0].observed};break;
    }
    case 'E-campaign': {
      const start=causes.find(c=>c.command.type==='campaign.activate'),before=[...samples].reverse().find(s=>s.tick<=start.at)!,after=samples.find(s=>s.tick>=start.at+120)!;
      const arrived=company(after).arrived-company(before).arrived,control=company(after,1).arrived-company(before,1).arrived;
      assert.ok(arrived>control);assert.ok(samples.some(s=>s.tick>=start.at&&s.tick<=start.at+120&&company(s).queue>0));
      assert.ok(company(after).abandoned+company(after).rejected>company(before).abandoned+company(before).rejected);
      evidence={arrived,controlArrived:control,peakQueue:Math.max(...samples.filter(s=>s.tick>=start.at&&s.tick<=start.at+120).map(s=>company(s).queue))};break;
    }
    case 'F-expulsion': assert.equal(r.final.employees.find((e:any)=>e.id==='0-devops').status,'EXPELLED');assert.equal(company(r.final).eliminated,false);evidence={active:r.final.employees.filter((e:any)=>e.status==='ACTIVE').length,companyContinues:true};break;
    case 'G-migration': {
      const control=report.controls.find((c:any)=>c.duration===r.duration)!;
      const actual=company(r.final,1),reference=company(control.final,1);
      assert.ok(company(r.final).migratedOut>company(control.final).migratedOut);assert.ok(actual.arrived>reference.arrived);
      assert.ok(actual.abandoned+actual.rejected>reference.abandoned+reference.rejected);assert.ok(actual.pressure>reference.pressure);
      evidence={receiverArrivals:actual.arrived,controlArrivals:reference.arrived,receiverErrors:actual.abandoned+actual.rejected,controlErrors:reference.abandoned+reference.rejected,pressure:actual.pressure,controlPressure:reference.pressure};break;
    }
    case 'H-recovery': {
      assert.equal(r.recovered,true);
      assert.equal(r.final.employees.find((e:any)=>e.id==='0-product').status,'EXPELLED');
      assert.ok(causes.some(c=>c.at===400&&c.command.id==='persisted-restart'&&c.webRate===0));assert.ok(causes.some(c=>c.at===400&&c.command.type==='room.start'));
      const job=r.final.tests.find((t:any)=>t.reports.some((q:any)=>q.requests===500));assert.equal(job.reports.length,1);assert.ok(samples.some(s=>s.tick>400&&s.tests.some((t:any)=>t.id===job.id&&t.status==='QA_RUNNING')));
      evidence={change:job.id,requests:500,reports:job.reports.length,expulsionRetained:true,restartRecovered:true};break;
    }
    default:assert.fail('Unknown benchmark.');
  }
  checks.push({duration:r.duration,scenario:r.strategy,evidence});
}
writeFileSync(path.replace(/\.json$/,'.verified.json'),JSON.stringify({verified:true,sourceDigest:report.sourceDigest,checks},null,2));
console.log(`Verified ${checks.length} complete action scenarios and 2 migration controls.`);
