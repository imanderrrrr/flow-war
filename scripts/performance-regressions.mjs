import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,createWriteStream,copyFileSync,readdirSync,existsSync} from 'node:fs';
const root='docs/benchmarks/entrega-5-5',runs=[];mkdirSync(root,{recursive:true});
for(const name of ['test','build','bench:traffic','bench:actions','bench:connections','bench:chat','bench:entrega5']){
 const args=name==='test'?['test']:['run',name],started=new Date().toISOString(),at=Date.now(),log=createWriteStream(`${root}/${name.replaceAll(':','-')}.txt`);console.log(`START ${name}`);
 const child=spawn('npm',args,{env:process.env,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const timer=setTimeout(()=>child.kill('SIGTERM'),40*60*1000);
 const [exitCode,signal]=await new Promise(r=>{child.once('exit',(c,s)=>r([c,s]));child.once('error',e=>r([null,e.message]));});clearTimeout(timer);await new Promise(r=>log.end(r));runs.push({command:`npm ${args.join(' ')}`,started,wallMs:Date.now()-at,exitCode,signal});writeFileSync(`${root}/regressions.json`,JSON.stringify(runs,null,2)+'\n');console.log(`END ${name}: ${exitCode}`);
}
if(existsSync('artifacts')){mkdirSync(`${root}/regression-artifacts`,{recursive:true});for(const f of readdirSync('artifacts'))if(f.endsWith('.json')&&!f.includes('base'))copyFileSync(`artifacts/${f}`,`${root}/regression-artifacts/${f}`);}
process.exitCode=runs.every(r=>r.exitCode===0)?0:1;
