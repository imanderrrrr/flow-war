import {compactSnapshot} from '../shared/snapshot-codec.js';
import {randomUUID} from 'node:crypto';
import type {Socket} from 'socket.io';
import type {Snapshot} from '../shared/types.js';
import {difference,identityKey,type Json,type StatePacket} from '../shared/sync.js';
/** One acknowledged update per socket. Superseded state is rebuilt on demand. */
export class SnapshotSync {
 private stream=randomUUID();private seq=0;private base?:Snapshot;private inFlight?:{seq:number;since:number};private force=true;
 readonly metrics={full:0,delta:0,coalesced:0,resyncs:0};
 constructor(private socket:Socket){ socket.data.stateMetrics=this.metrics; }
 resync(){this.force=true;this.inFlight=undefined;this.metrics.resyncs++;}
 send(build:()=>Snapshot,now=Date.now()){
  if(this.inFlight){if(now-this.inFlight.since<2000){this.metrics.coalesced++;return;}this.inFlight=undefined;this.force=true;}
  if(!this.socket.conn.transport.writable){this.metrics.coalesced++;return;}
  // Wire normalization also detaches every shared projection from mutable engine state.
  const next=JSON.parse(JSON.stringify(compactSnapshot(build()))) as Snapshot,identity=identityKey(next),previous=this.base;
  const full=this.force||!previous||previous.generation!==next.generation||identityKey(previous)!==identity;
  const patch=full?undefined:difference(previous as unknown as Json,next as unknown as Json);
  if(!full&&!patch)return;
  const seq=++this.seq;
  const header={compact:1 as const,protocol:1 as const,stream:this.stream,seq,generation:next.generation,identity};
  const packet:StatePacket=full?{...header,kind:'full',snapshot:next}:{...header,kind:'delta',base:seq-1,patch:patch!};
  this.base=next;this.force=false;this.inFlight={seq,since:now};this.metrics[full?'full':'delta']++;
  // ACK timeout does not enqueue another update. Periodic delivery replaces it with a full base.
  this.socket.timeout(2000).emit('state:update',packet,(err:Error|null,ack:{stream:string;seq:number})=>{if(this.inFlight?.seq!==seq)return;if(!err&&ack?.stream===this.stream&&ack.seq===seq)this.inFlight=undefined;else{this.inFlight=undefined;this.force=true;}});
 }
}
