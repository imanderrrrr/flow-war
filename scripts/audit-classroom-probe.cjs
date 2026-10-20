// Test-process-only instrumentation. Loaded explicitly by audit-classroom-load;
// no HTTP diagnostics or product configuration is added to FLOW WAR.
const fs = require('node:fs');
const {performance, monitorEventLoopDelay} = require('node:perf_hooks');
const {registerHooks, syncBuiltinESMExports} = require('node:module');
const sqlite = require('node:sqlite');
const threads = require('node:worker_threads');
const {Socket} = require('socket.io');
const output = process.env.FLOW_PROBE_OUTPUT, control = process.env.FLOW_PROBE_CONTROL;
const started = performance.now(), loop = monitorEventLoopDelay({resolution:10}); loop.enable();
const data = {hookedStep:false,hookedQueue:false,ticks:0,idleSteps:0,snapshots:0,snapshotBytes:0,maxSnapshotBytes:0,maxConnections:0,connections:0,disconnects:0,writes:0,commits:0,rollbacks:0,checkpoints:0,workersCreated:0,workersExited:0,workerErrors:0,workerInjectedFailures:0,workerTerminations:0,workerReplies:0,maxWorkers:0,maxWorkersBusy:0,maxQueued:0,lastControl:null};
const tickMs=[],intervalMs=[],callbackMs=[],persistMs=[],workerMs=[],memory=[],workerMemory=[],active=new Map(),sockets=new Set();let pendingFailure=false;
const pct=v=>{const a=[...v].sort((a,b)=>a-b);return {n:a.length,p50:a[Math.ceil(a.length*.50)-1]??null,p95:a[Math.ceil(a.length*.95)-1]??null,p99:a[Math.ceil(a.length*.99)-1]??null,max:a.at(-1)??null};};
global.__flowAuditStep=(step,game)=>{const tick=game.tick,t=performance.now();try{return step(game);}finally{if(game.tick!==tick){data.ticks++;tickMs.push(performance.now()-t);}else data.idleSteps++;}};
global.__flowAuditQueue=n=>{data.maxQueued=Math.max(data.maxQueued,n);};
registerHooks({load(url,context,next){const r=next(url,context);if(!r.source)return r;let s=Buffer.isBuffer(r.source)?r.source.toString():String(r.source);
 if(url.endsWith('/server/index.ts')){const count=(s.match(/step\(game\)/g)||[]).length;if(count!==1)throw Error('Audit step hook requires exactly one engine call site');s=s.replace(/step\(game\)/g,'globalThis.__flowAuditStep(step,game)');data.hookedStep=true;}
 if(url.endsWith('/server/dvr-pool.ts')){const pattern=/this\.queue\.push\(task\);\s*this\.pump\(\);/;if(!pattern.test(s))throw Error('Audit queue hook no longer matches');s=s.replace(pattern,'this.queue.push(task);this.pump();globalThis.__flowAuditQueue(this.queue.length);');data.hookedQueue=true;}
 return {...r,source:s};}});
const nativeInterval=global.setInterval;
global.setInterval=function(fn,ms,...args){if(ms!==100)return nativeInterval(fn,ms,...args);let last=performance.now();return nativeInterval(function(...values){const now=performance.now();intervalMs.push(now-last);last=now;try{return fn(...values);}finally{callbackMs.push(performance.now()-now);}},ms,...args);};
const nativeExec=sqlite.DatabaseSync.prototype.exec,transactions=new WeakMap();
sqlite.DatabaseSync.prototype.exec=function(sql){if(/^BEGIN/i.test(sql))transactions.set(this,performance.now());const r=nativeExec.call(this,sql);if(/^COMMIT/i.test(sql)&&transactions.has(this)){data.commits++;persistMs.push(performance.now()-transactions.get(this));transactions.delete(this);}if(/^ROLLBACK/i.test(sql))data.rollbacks++;if(/wal_checkpoint/i.test(sql))data.checkpoints++;return r;};
const nativeRun=sqlite.StatementSync.prototype.run;
sqlite.StatementSync.prototype.run=function(...args){const r=nativeRun.apply(this,args);data.writes+=Number(r.changes);return r;};
const emit=Socket.prototype.emit,close=Socket.prototype._onclose;
Socket.prototype.emit=function(event,...args){if(event==='snapshot'){sockets.add(this);data.connections=[...sockets].filter(s=>s.connected).length;data.maxConnections=Math.max(data.maxConnections,data.connections);data.snapshots++;const size=Buffer.byteLength(JSON.stringify(args[0]));data.snapshotBytes+=size;data.maxSnapshotBytes=Math.max(data.maxSnapshotBytes,size);emit.call(this,'audit:stamp',{at:performance.timeOrigin+performance.now(),tick:args[0].tick,generation:args[0].generation});}return emit.call(this,event,...args);};
Socket.prototype._onclose=function(...args){if(sockets.delete(this))data.disconnects++;data.connections=[...sockets].filter(s=>s.connected).length;return close.apply(this,args);};
const NativeWorker=threads.Worker;
threads.Worker=class extends NativeWorker{
 constructor(...args){super(...args);if(!String(args[0]).includes('dvr-worker'))return;const state={id:this.threadId,worker:this,busy:false,started:0};active.set(this,state);data.workersCreated++;data.maxWorkers=Math.max(data.maxWorkers,active.size);
 this.on('message',()=>{if(state.busy){workerMs.push(performance.now()-state.started);data.workerReplies++;}state.busy=false;});this.on('error',()=>data.workerErrors++);this.on('exit',()=>{active.delete(this);data.workersExited++;});}
 postMessage(...args){const s=active.get(this);if(s){s.busy=true;s.started=performance.now();data.maxWorkersBusy=Math.max(data.maxWorkersBusy,[...active.values()].filter(v=>v.busy).length);if(pendingFailure){pendingFailure=false;data.workerInjectedFailures++;setTimeout(()=>this.terminate(),20).unref();}}return super.postMessage(...args);}
 terminate(){if(active.has(this))data.workerTerminations++;return super.terminate();}
};syncBuiltinESMExports();
function report(final=false){const samples=memory.map(m=>m.rss),heaps=memory.map(m=>m.heapUsed);return {...data,elapsedMs:performance.now()-started,final,eventLoop:{p50:loop.percentile(50)/1e6,p95:loop.percentile(95)/1e6,p99:loop.percentile(99)/1e6,max:loop.max/1e6},tickMs:pct(tickMs),engineIntervalMs:pct(intervalMs),engineCallbackMs:pct(callbackMs),persistenceMs:pct(persistMs),workerTaskMs:pct(workerMs),activeWorkers:active.size,busyWorkers:[...active.values()].filter(s=>s.busy).length,memory,workerMemory,heapMaxBytes:Math.max(0,...heaps),rssMaxBytes:Math.max(0,...samples)};}
function flush(final=false){fs.writeFileSync(output,JSON.stringify(report(final)));}
const monitor=nativeInterval(()=>{const m=process.memoryUsage();memory.push({atMs:performance.now()-started,heapUsed:m.heapUsed,rss:m.rss,external:m.external});for(const s of active.values())s.worker.getHeapStatistics().then(h=>workerMemory.push({atMs:performance.now()-started,id:s.id,usedHeapBytes:h.used_heap_size,totalHeapBytes:h.total_heap_size})).catch(()=>{});
 if(fs.existsSync(control)){try{const c=JSON.parse(fs.readFileSync(control,'utf8'));if(c.id!==data.lastControl){data.lastControl=c.id;if(c.failWorker)pendingFailure=true;}}catch{}}
 flush();},1000);monitor.unref();process.on('exit',()=>flush(true));
