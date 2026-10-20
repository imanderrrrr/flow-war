import {spawn} from 'node:child_process';
import {createWriteStream,writeFileSync} from 'node:fs';
const root='docs/benchmarks/final-hardening',runs=[];
for(const [duration,speed] of [[1200,20],[1500,20],[1200,1]]){
 const label=`certified-${duration}s-${speed}x`,args=['run','bench:classroom','--',`--duration=${duration}`,`--speed=${speed}`,`--label=${label}`];
 const startedAt=new Date().toISOString(),at=Date.now(),out=createWriteStream(`${root}/classroom-${label}.txt`);console.log(`START ${label} ${startedAt}`);
 const child=spawn('npm',args,{env:process.env,stdio:['ignore','pipe','pipe']});child.stdout.pipe(out,{end:false});child.stderr.pipe(out,{end:false});
 const result=await new Promise(resolve=>{child.once('error',e=>resolve({exitCode:null,error:e.message}));child.once('exit',(exitCode,signal)=>resolve({exitCode,signal}));});await new Promise(r=>out.end(r));
 runs.push({label,command:`npm ${args.join(' ')}`,startedAt,wallMs:Date.now()-at,...result});writeFileSync(`${root}/classroom-runs.json`,JSON.stringify(runs,null,2)+'\n');console.log(`END ${label} code=${result.exitCode} wall=${(Date.now()-at)/1000}s`);
}
process.exitCode=runs.every(r=>r.exitCode===0)?0:1;
