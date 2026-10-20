// Explicit benchmark preload only; never installed by the application.
const fs=require('node:fs'),{performance,monitorEventLoopDelay}=require('node:perf_hooks');
const {registerHooks}=require('node:module'),{Socket}=require('socket.io'),{Encoder}=require('socket.io-parser'),sqlite=require('node:sqlite');
const start=performance.now(),cpu=process.cpuUsage(),loop=monitorEventLoopDelay({resolution:10});loop.enable();
const peers=new Set(),sockets=new Set(),sizes=[],serialize=[],broadcast=[],windows=new Map(),transportWindows=new Map();let emitted=0,logical=0,encoded=0,writes=0,commits=0,rss=0,heap=0,full=0,delta=0,jsonMs=0,jsonCalls=0,previousTcp=0,compressionConnections=0;
const stringify=JSON.stringify;JSON.stringify=function(...args){const at=performance.now();try{return stringify.apply(this,args);}finally{jsonMs+=performance.now()-at;jsonCalls++;}};
global.__flowPerfBroadcast=fn=>{const at=performance.now();try{return fn();}finally{broadcast.push(performance.now()-at);}};
registerHooks({load(url,context,next){const r=next(url,context);if(!r.source||!url.endsWith('/server/index.ts'))return r;let s=String(r.source),start=s.indexOf('function broadcast()'),open=s.indexOf('{',start),depth=1,end=open+1;if(start<0)throw Error('Missing broadcast instrumentation');for(;depth&&end<s.length;end++){if(s[end]==='{')depth++;if(s[end]==='}')depth--;}const body=s.slice(open+1,end-1);return{...r,source:s.slice(0,open+1)+'return globalThis.__flowPerfBroadcast(()=>{'+body+'});'+s.slice(end-1)};}});
const emit=Socket.prototype.emit;Socket.prototype.emit=function(event,...args){
 const net=this.conn?.transport?.socket?._socket;if(net)peers.add(net);sockets.add(this);
 if(event==='snapshot'||event==='state:update'){
  if(this.conn?.transport?.socket?.extensions?.includes('permessage-deflate'))compressionConnections++;
  const at=performance.now(),s=JSON.stringify(args[0]),n=Buffer.byteLength(s);serialize.push(performance.now()-at);sizes.push(n);logical+=n;emitted++;
  if(event==='snapshot'||args[0].kind==='full')full++;else delta++;
  const key=Math.floor((performance.now()-start)/1000);windows.set(key,(windows.get(key)||0)+n);
 }
 return emit.call(this,event,...args);
};
const encode=Encoder.prototype.encode;Encoder.prototype.encode=function(...args){const result=encode.apply(this,args);for(const part of result)encoded+=typeof part==='string'?Buffer.byteLength(part):part.byteLength;return result;};
const run=sqlite.StatementSync.prototype.run;sqlite.StatementSync.prototype.run=function(...args){const r=run.apply(this,args);writes+=Number(r.changes);return r;};
const exec=sqlite.DatabaseSync.prototype.exec;sqlite.DatabaseSync.prototype.exec=function(sql){const r=exec.call(this,sql);if(/^COMMIT/i.test(sql))commits++;return r;};
const pct=a=>{const s=a.slice().sort((a,b)=>a-b);return{n:s.length,total:s.reduce((a,b)=>a+b,0),p50:s[Math.ceil(s.length*.5)-1]??0,p95:s[Math.ceil(s.length*.95)-1]??0,p99:s[Math.ceil(s.length*.99)-1]??0,max:s.at(-1)??0};};
function sample(){const m=process.memoryUsage();rss=Math.max(rss,m.rss);heap=Math.max(heap,m.heapUsed);const tcp=[...peers].reduce((n,s)=>n+s.bytesWritten,0),key=Math.floor((performance.now()-start)/1000);transportWindows.set(key,(transportWindows.get(key)||0)+tcp-previousTcp);previousTcp=tcp;}
function flush(){sample();const wallMs=performance.now()-start,c=process.cpuUsage(cpu);fs.writeFileSync(process.env.FLOW_PERF_PROBE,stringify({wallMs,cpuMicros:c,cpuPercent:(c.user+c.system)/wallMs/10,rssMax:rss,heapMax:heap,eventLoopP99:loop.percentile(99)/1e6,emitted,logicalBytes:logical,socketIoEncodedBytes:encoded,tcpBytesWritten:[...peers].reduce((n,s)=>n+s.bytesWritten,0),tcpBytesRead:[...peers].reduce((n,s)=>n+s.bytesRead,0),full,delta,writes,commits,sizes:pct(sizes),payloadSerializationMs:pct(serialize),broadcastMs:pct(broadcast),jsonStringifyMs:jsonMs,jsonStringifyCalls:jsonCalls,logicalPeakOneSecondBytes:Math.max(0,...windows.values()),transportPeakOneSecondBytes:Math.max(0,...transportWindows.values()),compression:compressionConnections>0,syncMetrics:[...sockets].map(s=>s.data.stateMetrics).filter(Boolean),layer:'net.Socket.bytesWritten: TCP payload including HTTP upgrade, Engine.IO and WebSocket framing after negotiated compression; excludes IP/TCP headers and Wi-Fi airtime',serializationScope:'JSON.stringify inclusive of runtime, diff-size selection and probe payload accounting; broadcast excludes asynchronous zlib CPU'}));}
setInterval(sample,20).unref();setInterval(flush,1000).unref();process.on('SIGUSR2',()=>{flush();fs.writeFileSync(process.env.FLOW_PERF_PROBE+'.flushed','ok');});process.on('exit',flush);
