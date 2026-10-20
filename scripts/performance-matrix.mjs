import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,symlinkSync,mkdirSync,createWriteStream,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const sha='b52ccc67c8aeaf3d76cf52a4db60d10e120f5942';
if(execFileSync('git',['rev-parse',sha],{encoding:'utf8'}).trim()!==sha)throw Error('Reference SHA mismatch');
const root=resolve('docs/benchmarks/entrega-5-5'),baseline=mkdtempSync(join(tmpdir(),'flow-frozen-b52-'));mkdirSync(root,{recursive:true});
const archive=spawn('git',['archive',sha],{stdio:['ignore','pipe','inherit']}),tar=spawn('tar',['-x','-C',baseline],{stdio:['pipe','inherit','inherit']});archive.stdout.pipe(tar.stdin);const [[a],[t]]=await Promise.all([once(archive,'exit'),once(tar,'exit')]);if(a||t)throw Error('Cannot freeze reference');symlinkSync(resolve('node_modules'),join(baseline,'node_modules'),'dir');
const runs=[];
try{for(const [duration,speed] of [[1200,20],[1500,20],[1200,1]])for(const [configuration,mode] of [['A','on'],['B','on'],['C','off']]){
 const label=`final-${configuration}-${duration}-${speed}x`,file=join(root,label+'.json'),args=['--import','tsx','scripts/performance-classroom.ts',`--label=${label}`,`--duration=${duration}`,`--speed=${speed}`,`--dvr=${mode}`,...(configuration==='A'?[`--server-root=${baseline}`]:[])];
 if(existsSync(file)){const previous=JSON.parse(readFileSync(file,'utf8'));if(previous.status==='passed'&&previous.exitCode===0){runs.push({label,reused:true,exitCode:0});console.log(`REUSE ${label}`);continue;}throw Error(`Preserve failed evidence and select a new final label: ${label}`);}
 const log=createWriteStream(join(root,label+'.txt')),started=new Date().toISOString(),at=Date.now();console.log(`START ${label} ${started}`);const child=spawn(process.execPath,args,{env:process.env,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.stdout.on('data',b=>process.stdout.write(b));const [exitCode,signal]=await once(child,'exit');await new Promise(r=>log.end(r));runs.push({label,command:`node ${args.map(v=>v.startsWith('--server-root')?'--server-root=<frozen-reference>':v).join(' ')}`,started,wallMs:Date.now()-at,exitCode,signal});writeFileSync(join(root,'matrix-runs.json'),JSON.stringify(runs,null,2)+'\n');console.log(`END ${label} ${exitCode}`);if(exitCode!==0)throw Error(`${label} failed`);
}}finally{rmSync(baseline,{recursive:true,force:true});}
