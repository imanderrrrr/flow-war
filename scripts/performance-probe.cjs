// Explicit benchmark preload only; never installed by the application.
const fs=require('node:fs'),{performance,monitorEventLoopDelay}=require('node:perf_hooks');
const {registerHooks,syncBuiltinESMExports}=require('node:module'),{Socket}=require('socket.io'),{Encoder}=require('socket.io-parser'),sqlite=require('node:sqlite');
const threads=require('node:worker_threads'),NativeWorker=threads.Worker;let workersCreated=0;threads.Worker=class extends NativeWorker{constructor(...args){super(...args);if(String(args[0]).includes('dvr-worker'))workersCreated++;}};syncBuiltinESMExports();
const scheduled=[];let scheduledGame,maxScheduled=0,scheduledCommands=0;
// Flush hook: a group-commit server only queues released commands; flushCommands applies, commits and ACKs
// them before this step, at the declared tick. Servers without the function (per-command route) need no flush.
global.__flowScheduledStep=(step,game,flush)=>{scheduledGame=game;scheduled.sort((a,b)=>a.at-b.at||a.order-b.order);let released=false;while(scheduled.length&&scheduled[0].at<=game.tick+1e-7){const item=scheduled.shift();if(Math.abs(item.at-game.tick)>1e-7)item.ack({ok:false,error:'Benchmark command missed its declared tick'});else{released=true;item.run();}}if(released&&flush)flush();return step(game);};
const nativeOn=Socket.prototype.on;Socket.prototype.on=function(event,listener){if(event!=='command')return nativeOn.call(this,event,listener);return nativeOn.call(this,event,function(command,control,ack){if(!control||!Number.isFinite(control.benchmarkAt)||typeof ack!=='function')return listener.apply(this,arguments);const received=performance.now(),socket=this;scheduled.push({at:control.benchmarkAt,order:control.benchmarkOrder,ack,run:()=>{scheduledCommands++;const queuedMs=performance.now()-received;listener.call(socket,command,(result)=>ack(result,{benchmarkQueuedMs:queuedMs,benchmarkTick:scheduledGame.tick,benchmarkOrder:control.benchmarkOrder}));}});maxScheduled=Math.max(maxScheduled,scheduled.length);});};
const start=performance.now(),cpu=process.cpuUsage(),loop=monitorEventLoopDelay({resolution:10});loop.enable();
const peers=new Set(),sockets=new Set(),sizes=[],serialize=[],broadcast=[],windows=new Map(),transportWindows=new Map();let emitted=0,logical=0,encoded=0,writes=0,commits=0,rss=0,heap=0,full=0,delta=0,previousTcp=0,compressionConnections=0,websocketFrames=0,websocketFrameBytes=0,websocketPayloadBytes=0;
const stringify=JSON.stringify;
global.__flowPerfBroadcast=fn=>{const at=performance.now();try{return fn();}finally{broadcast.push(performance.now()-at);}};
registerHooks({load(url,context,next){const r=next(url,context);if(!r.source||!url.endsWith('/server/index.ts'))return r;let s=String(r.source),start=s.indexOf('function broadcast()'),open=s.indexOf('{',start),depth=1,end=open+1;if(start<0)throw Error('Missing broadcast instrumentation');for(;depth&&end<s.length;end++){if(s[end]==='{')depth++;if(s[end]==='}')depth--;}const body=s.slice(open+1,end-1);s=s.replace(/step\(game\)/g,'globalThis.__flowScheduledStep(step,game,typeof flushCommands==="function"?flushCommands:undefined)');start=s.indexOf('function broadcast()');open=s.indexOf('{',start);depth=1;end=open+1;for(;depth&&end<s.length;end++){if(s[end]==='{')depth++;if(s[end]==='}')depth--;}const updatedBody=s.slice(open+1,end-1);return{...r,source:s.slice(0,open+1)+'return globalThis.__flowPerfBroadcast(()=>{'+updatedBody+'});'+s.slice(end-1)};}});
const emit=Socket.prototype.emit;Socket.prototype.emit=function(event,...args){
 const net=this.conn?.transport?.socket?._socket;if(net)peers.add(net);sockets.add(this);
 if(event==='snapshot'||event==='state:update'){
  if(this.conn?.transport?.socket?.extensions?.includes('permessage-deflate'))compressionConnections++;
  emitted++;
  if(event==='snapshot'||args[0].kind==='full')full++;else delta++;
 }
 return emit.call(this,event,...args);
};
const WebSocket=require('ws'),frame=WebSocket.Sender.frame;WebSocket.Sender.frame=function(data,options){const result=frame.call(this,data,options);websocketFrames++;websocketFrameBytes+=result.reduce((n,b)=>n+(typeof b==='string'?Buffer.byteLength(b):b.byteLength),0);websocketPayloadBytes+=typeof data==='string'?Buffer.byteLength(data):data.byteLength;return result;};
// Each packet is counted once: inside encode() for the stock encoder, or in encodeAsString() when a server
// encoder subclass answers state:update without the hasBinary scan. Calls nested in encode() are not recounted.
const encode=Encoder.prototype.encode,encodeAsString=Encoder.prototype.encodeAsString;let encoding=0;
Encoder.prototype.encode=function(packet){
 const at=performance.now();let result;encoding++;try{result=encode.call(this,packet);}finally{encoding--;}return account(packet,result,performance.now()-at);
};
Encoder.prototype.encodeAsString=function(packet){
 if(encoding)return encodeAsString.call(this,packet);
 const at=performance.now(),result=encodeAsString.call(this,packet);return account(packet,[result],performance.now()-at)[0];
};
function account(packet,result,elapsed){
 const event=packet.data?.[0];for(const part of result){const bytes=typeof part==='string'?Buffer.byteLength(part):part.byteLength;encoded+=bytes;
  if(typeof part==='string'&&(event==='snapshot'||event==='state:update')){
   // Socket.IO header + [event,payload]. Subtract only the existing envelope.
   const bracket=part.indexOf('['),prefix=part.slice(0,bracket),envelope=prefix+'['+stringify(event)+',]';
   const n=bytes-Buffer.byteLength(envelope);sizes.push(n);logical+=n;serialize.push(elapsed);
   const key=Math.floor((performance.now()-start)/1000);windows.set(key,(windows.get(key)||0)+n);
  }
 }return result;
};
const run=sqlite.StatementSync.prototype.run;sqlite.StatementSync.prototype.run=function(...args){const r=run.apply(this,args);writes+=Number(r.changes);return r;};
const exec=sqlite.DatabaseSync.prototype.exec;sqlite.DatabaseSync.prototype.exec=function(sql){const r=exec.call(this,sql);if(/^COMMIT/i.test(sql))commits++;return r;};
const pct=a=>{const s=a.slice().sort((a,b)=>a-b);return{n:s.length,total:s.reduce((a,b)=>a+b,0),p50:s[Math.ceil(s.length*.5)-1]??0,p95:s[Math.ceil(s.length*.95)-1]??0,p99:s[Math.ceil(s.length*.99)-1]??0,max:s.at(-1)??0};};
function sample(){const m=process.memoryUsage();rss=Math.max(rss,m.rss);heap=Math.max(heap,m.heapUsed);const tcp=[...peers].reduce((n,s)=>n+s.bytesWritten,0),key=Math.floor((performance.now()-start)/1000);transportWindows.set(key,(transportWindows.get(key)||0)+tcp-previousTcp);previousTcp=tcp;}
function flush(){sample();const wallMs=performance.now()-start,c=process.cpuUsage(cpu);fs.writeFileSync(process.env.FLOW_PERF_PROBE,stringify({wallMs,workersCreated,scheduledCommands,maxScheduled,websocketFrames,websocketFrameBytes,websocketPayloadBytes,websocketFramingBytes:websocketFrameBytes-websocketPayloadBytes,cpuMicros:c,cpuPercent:(c.user+c.system)/wallMs/10,rssMax:rss,heapMax:heap,eventLoopP99:loop.percentile(99)/1e6,emitted,logicalBytes:logical,socketIoEncodedBytes:encoded,tcpBytesWritten:[...peers].reduce((n,s)=>n+s.bytesWritten,0),tcpBytesRead:[...peers].reduce((n,s)=>n+s.bytesRead,0),full,delta,writes,commits,sizes:pct(sizes),socketIoSerializationMs:pct(serialize),broadcastMs:pct(broadcast),logicalPeakOneSecondBytes:Math.max(0,...windows.values()),transportPeakOneSecondBytes:Math.max(0,...transportWindows.values()),compression:compressionConnections>0,syncMetrics:[...sockets].map(s=>s.data.stateMetrics).filter(Boolean),layer:'net.Socket.bytesWritten: TCP payload including HTTP upgrade, Engine.IO and WebSocket framing after negotiated compression; excludes IP/TCP headers and Wi-Fi airtime',serializationScope:'Actual Socket.IO Encoder.encode time for state messages; logical bytes derived from that encoding without reserializing payloads. Broadcast includes projection, codec, diff and encoding, excludes asynchronous zlib CPU.'}));}
setInterval(sample,20).unref();setInterval(flush,1000).unref();process.on('SIGUSR2',()=>{flush();fs.writeFileSync(process.env.FLOW_PERF_PROBE+'.flushed','ok');});process.on('exit',flush);
