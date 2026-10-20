import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,createWriteStream,copyFileSync,statSync} from 'node:fs';
import {cpus,totalmem,freemem,platform,release} from 'node:os';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
if(process.argv.includes('--help')){console.log('node scripts/audit-final-regressions.mjs [--resume] [--only=tests,build,traffic,actions,connections,chat,entrega5]');process.exit(0);}
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
const root='docs/benchmarks/final-hardening';mkdirSync(root,{recursive:true});
const benchEnv={...process.env,FLOW_DVR_WORKERS:'2'};for(const key of ['FLOW_ACTION_BENCH','FLOW_BENCH_STRATEGY','FLOW_DELIVERY5_CASE','FLOW_DELIVERY5_DURATION'])delete benchEnv[key];
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const measuredPaths=['server','shared','src','tests','package.json','package-lock.json','scripts/traffic-benchmark.ts','scripts/market-benchmark.ts','scripts/actions-benchmark.ts','scripts/verify-actions-benchmark.ts','scripts/connection-benchmark.ts','scripts/chat-benchmark.ts','scripts/entrega5-benchmark.ts'];
const dirty=execFileSync('git',['status','--porcelain','--',...measuredPaths],{encoding:'utf8'}).trim();
const auditToolingDirty=execFileSync('git',['status','--porcelain','--','scripts/audit-final-*.mjs'],{encoding:'utf8'}).trim();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const metadata={sha,date:new Date().toISOString(),node:process.version,os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,cores:cpus().length,totalRamBytes:totalmem(),freeRamBytes:freemem(),workers:2,sourceDirty:dirty,measuredPaths,auditToolingDirty,runnerSha256:hash(readFileSync(import.meta.filename))};
const resume=process.argv.includes('--resume');
const runs=resume&&existsSync(`${root}/regression-runs.json`)?JSON.parse(readFileSync(`${root}/regression-runs.json`,'utf8')):[];
if(resume)for(const run of runs){if(run.exitCode!==0||run.sha!==sha)throw new Error('Resume requires successful results at the same code SHA');for(const file of run.evidence)if(hash(readFileSync(`${root}/${file.file}`))!==file.sha256Gzip)throw new Error(`Evidence changed: ${file.file}`);}
const cases=[['tests',['test'],[]],['build',['run','build'],[]],['traffic',['run','bench:traffic'],['traffic-benchmark-traffic-2.0-market-3.0.json','market-benchmark-market-3.0.json']],['actions',['run','bench:actions'],['actions-benchmark-4a.json','actions-benchmark-4a.verified.json']],['connections',['run','bench:connections'],['connection-benchmark.json']],['chat',['run','bench:chat'],['entrega5-chat.json']],['entrega5',['run','bench:entrega5'],['entrega5-benchmark.json']]];
for(const [name,args,files] of cases){
 if(only&&!only.includes(name))continue;
 if(resume&&runs.some(r=>r.name===name)){console.log(`KEEP ${name} previously completed`);continue;}
 if(existsSync(`${root}/${name}.txt`)){
  if(!resume)throw new Error(`Refusing to overwrite existing log ${name}; use --resume`);
  const preserved=`${name}-interrupted-${Date.now()}.txt`;copyFileSync(`${root}/${name}.txt`,`${root}/${preserved}`);
  writeFileSync(`${root}/${preserved}.json`,JSON.stringify({status:'interrupted-without-exit-result',exitCode:null,originalLog:`${name}.txt`,preservedLog:preserved,sha,recordedAt:new Date().toISOString(),sha256:hash(readFileSync(`${root}/${preserved}`)),note:'Partial output is preserved and is not a successful run. The complete command is rerun.'},null,2)+'\n');
 }
 const start=Date.now(),out=createWriteStream(`${root}/${name}.txt`);console.log(`START ${name} ${new Date().toISOString()}`);
 const child=spawn('npm',args,{env:benchEnv,stdio:['ignore','pipe','pipe']});child.stdout.pipe(out,{end:false});child.stderr.pipe(out,{end:false});
 const result=await new Promise(resolve=>{child.once('error',e=>resolve({exitCode:null,error:e.message}));child.once('exit',(exitCode,signal)=>resolve({exitCode,signal}));});await new Promise(r=>out.end(r));
 const evidence=[];
 for(const file of files)if(result.exitCode===0){if(!existsSync(`artifacts/${file}`)||statSync(`artifacts/${file}`).mtimeMs<start)throw new Error(`Missing fresh artifact ${file}`);const raw=readFileSync(`artifacts/${file}`),packed=gzipSync(raw);writeFileSync(`${root}/${file}.gz`,packed);evidence.push({file:`${file}.gz`,sha256Raw:hash(raw),sha256Gzip:hash(packed),rawBytes:raw.length});}
 runs.push({...metadata,name,command:`npm ${args.join(' ')}`,startedAt:new Date(start).toISOString(),wallMs:Date.now()-start,...result,evidence,clients:['connections','chat'].includes(name)?27:null,simulatedSeconds:['traffic','actions','entrega5'].includes(name)?[1200,1500]:null,scenario:'unchanged repository command, default full parameters'});
 writeFileSync(`${root}/regression-runs.json`,JSON.stringify(runs,null,2));console.log(`END ${name} code=${result.exitCode} wall=${(Date.now()-start)/1000}s`);
}
process.exitCode=runs.every(r=>r.exitCode===0)?0:1;
