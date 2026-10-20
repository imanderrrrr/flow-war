import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,createWriteStream} from 'node:fs';
import {cpus,totalmem,freemem,platform,release} from 'node:os';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
if(process.argv.includes('--help')){console.log('node scripts/audit-final-regressions.mjs [--only=tests,build,traffic,actions,connections,chat,entrega5]');process.exit(0);}
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
const root='docs/benchmarks/final-hardening';mkdirSync(root,{recursive:true});
const benchEnv={...process.env,FLOW_DVR_WORKERS:'2'};for(const key of ['FLOW_ACTION_BENCH','FLOW_BENCH_STRATEGY','FLOW_DELIVERY5_CASE','FLOW_DELIVERY5_DURATION'])delete benchEnv[key];
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain','--','server','shared','scripts','tests','package.json'],{encoding:'utf8'}).trim();
const metadata={sha,date:new Date().toISOString(),node:process.version,os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,cores:cpus().length,totalRamBytes:totalmem(),freeRamBytes:freemem(),workers:2,sourceDirty:dirty};
const runs=[];
const cases=[['tests',['test'],[]],['build',['run','build'],[]],['traffic',['run','bench:traffic'],['traffic-benchmark-traffic-2.0-market-3.0.json','market-benchmark-market-3.0.json']],['actions',['run','bench:actions'],['actions-benchmark-4a.json','actions-benchmark-4a.verified.json']],['connections',['run','bench:connections'],['connection-benchmark.json']],['chat',['run','bench:chat'],['entrega5-chat.json']],['entrega5',['run','bench:entrega5'],['entrega5-benchmark.json']]];
for(const [name,args,files] of cases){
 if(only&&!only.includes(name))continue;
 const start=Date.now(),out=createWriteStream(`${root}/${name}.txt`);console.log(`START ${name} ${new Date().toISOString()}`);
 const child=spawn('npm',args,{env:benchEnv,stdio:['ignore','pipe','pipe']});child.stdout.pipe(out,{end:false});child.stderr.pipe(out,{end:false});
 const result=await new Promise(resolve=>{child.once('error',e=>resolve({exitCode:null,error:e.message}));child.once('exit',(exitCode,signal)=>resolve({exitCode,signal}));});await new Promise(r=>out.end(r));
 const evidence=[];
 for(const file of files)if(result.exitCode===0&&existsSync(`artifacts/${file}`)){const raw=readFileSync(`artifacts/${file}`),packed=gzipSync(raw);writeFileSync(`${root}/${file}.gz`,packed);evidence.push({file:`${file}.gz`,sha256Raw:createHash('sha256').update(raw).digest('hex'),sha256Gzip:createHash('sha256').update(packed).digest('hex'),rawBytes:raw.length});}
 runs.push({...metadata,name,command:`npm ${args.join(' ')}`,startedAt:new Date(start).toISOString(),wallMs:Date.now()-start,...result,evidence,clients:['connections','chat'].includes(name)?27:null,simulatedSeconds:['traffic','actions','entrega5'].includes(name)?[1200,1500]:null,scenario:'unchanged repository command, default full parameters'});
 writeFileSync(`${root}/regression-runs.json`,JSON.stringify(runs,null,2));console.log(`END ${name} code=${result.exitCode} wall=${(Date.now()-start)/1000}s`);
}
process.exitCode=runs.every(r=>r.exitCode===0)?0:1;
