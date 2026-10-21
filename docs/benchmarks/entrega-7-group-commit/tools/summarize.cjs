// Aggregates harness JSON outputs: per-run rows plus per (config, version) median [min..max] over valid runs.
// Valid = harness status passed and mean sampled 1-min load during the run < 8 (start load is gated by run-matrix.sh).
const fs=require('node:fs'),path=require('node:path');
const dir=process.argv[2];
const files=fs.readdirSync(dir).filter(f=>/^(base|gc)-\d\d-(on|off)-r\d+\.json$/.test(f)).sort();
const rows=[];
for(const f of files){
 const name=f.replace('.json',''),r=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')),c=r.clients??{},seg=r.segments??[];
 const [version,conn,mode,rep]=name.split('-');
 const loads=fs.existsSync(path.join(dir,name+'.load'))?fs.readFileSync(path.join(dir,name+'.load'),'utf8').trim().split('\n').map(l=>Number(l.split(/\s+/)[2])).filter(Number.isFinite):[];
 const max=k=>Math.max(...seg.map(s=>k(s)??0));
 rows.push({run:name,version,config:`${conn}-${mode}`,rep,status:r.status,errors:(r.errors??[]).length,loadMean:loads.reduce((a,b)=>a+b,0)/(loads.length||1),loadMax:Math.max(0,...loads),
  runningWallS:r.runningWallSeconds,nonChatP50:c.nonChatAckMs?.p50,nonChatP95:c.nonChatAckMs?.p95,nonChatP99:c.nonChatAckMs?.p99,nonChatMax:c.nonChatAckMs?.max,chatP50:c.chatAckMs?.p50,chatP95:c.chatAckMs?.p95,chatP99:c.chatAckMs?.p99,chatMax:c.chatAckMs?.max,ackMax:c.ackMs?.max,
  cadenceP99:c.cadenceMs?.p99,cadenceMax:c.cadenceMs?.max,evloopP99Max:max(s=>s.eventLoopP99),cpuPctSeg2:seg[1]?.cpuPercent,broadcastP50Seg2:seg[1]?.broadcastMs?.p50,broadcastP95Seg2:seg[1]?.broadcastMs?.p95,serializeP50Seg2:seg[1]?.socketIoSerializationMs?.p50,serializeTotalSeg2:seg[1]?.socketIoSerializationMs?.total,
  rssMaxMB:max(s=>s.rssMax)/1e6,commits:seg.reduce((n,s)=>n+(s.commits??0),0),rowWrites:seg.reduce((n,s)=>n+(s.writes??0),0),tcpOutMB:seg.reduce((n,s)=>n+(s.tcpBytesWritten??0),0)/1e6,logicalOutMB:seg.reduce((n,s)=>n+(s.logicalBytes??0),0)/1e6,stateMessages:seg.reduce((n,s)=>n+(s.emitted??0),0),
  bytesPerStateMessage:seg.reduce((n,s)=>n+(s.logicalBytes??0),0)/Math.max(1,seg.reduce((n,s)=>n+(s.sizes?.n??0),0)),
  mainDbMB:r.storage?.mainBytes/1e6,walMB:r.storage?.walBytes/1e6,economicDigest:r.finalEconomicDigest,fullEconomicDigest:r.fullEconomicDigest,actionTraceDigest:r.actionTraceDigest,sigkillExact:r.recovery?.exact,flowSlackOriginals:r.flowSlack?.originals,flowSlackDeliveries:r.flowSlack?.deliveries,flowSlackLoss:r.flowSlack?.loss,leaks:r.flowSlack?.leaks,
  sourceDigest:r.sourceDigest,probeDigest:r.probeDigest,harnessDigest:r.harnessDigest,git:r.reference});
}
for(const r of rows)r.valid=r.status==='passed'&&r.loadMean<8;
const keys=['runningWallS','nonChatP50','nonChatP95','nonChatP99','nonChatMax','chatP50','chatP95','chatP99','chatMax','ackMax','cadenceP99','cadenceMax','evloopP99Max','cpuPctSeg2','broadcastP50Seg2','broadcastP95Seg2','serializeP50Seg2','rssMaxMB','tcpOutMB','logicalOutMB','bytesPerStateMessage','commits','rowWrites','mainDbMB','walMB','loadMean','loadMax'];
const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);return s.length?(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2):NaN;};
const groups={};for(const r of rows.filter(r=>r.valid))(groups[`${r.config}|${r.version}`]??=[]).push(r);
const agg={};
for(const [k,g] of Object.entries(groups))agg[k]={n:g.length,...Object.fromEntries(keys.map(x=>[x,{median:median(g.map(r=>r[x])),min:Math.min(...g.map(r=>r[x])),max:Math.max(...g.map(r=>r[x]))}])),economicDigests:[...new Set(g.map(r=>r.economicDigest))],fullEconomicDigests:[...new Set(g.map(r=>r.fullEconomicDigest))],actionTraceDigests:[...new Set(g.map(r=>r.actionTraceDigest))],sigkillExact:g.every(r=>r.sigkillExact===true),leaks:g.reduce((n,r)=>n+(r.leaks??0),0),loss:g.reduce((n,r)=>n+(r.flowSlackLoss??0),0),deliveriesComplete:g.every(r=>r.flowSlackDeliveries===r.flowSlackOriginals*(r.config.startsWith('27')?5:6)),sourceDigests:[...new Set(g.map(r=>r.sourceDigest))],probeDigests:[...new Set(g.map(r=>r.probeDigest))],harnessDigests:[...new Set(g.map(r=>r.harnessDigest))]};
const fmt=n=>Number.isFinite(n)?(Math.abs(n)>=100?n.toFixed(0):n.toFixed(1)):'-';
console.log('run'.padEnd(18),'st','valid','load','wall','ncP95','chP95','cadP99','evP99','bcP50','cpu%','digest');
for(const r of rows)console.log(r.run.padEnd(18),r.status==='passed'?'ok':'XX',r.valid?'yes':'NO ',fmt(r.loadMean).padStart(4),fmt(r.runningWallS),fmt(r.nonChatP95),fmt(r.chatP95),fmt(r.cadenceP99),fmt(r.evloopP99Max),fmt(r.broadcastP50Seg2),fmt(r.cpuPctSeg2),(r.economicDigest??'').slice(0,8));
console.log('\nmedian [min..max] per group (valid runs)');
for(const [k,a] of Object.entries(agg).sort())console.log(k.padEnd(12),`n=${a.n}`,['nonChatP95','chatP95','cadenceP99','evloopP99Max','broadcastP50Seg2','cpuPctSeg2','ackMax','runningWallS'].map(x=>`${x}=${fmt(a[x].median)}[${fmt(a[x].min)}..${fmt(a[x].max)}]`).join(' '),'digests',a.economicDigests.map(d=>d?.slice(0,8)).join(','),'sigkillExact',a.sigkillExact,'leaks',a.leaks,'loss',a.loss,'deliveries',a.deliveriesComplete);
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({rows,agg},null,2));
