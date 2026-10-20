import {io as rawIo,type Socket,type ManagerOptions,type SocketOptions} from 'socket.io-client';
import {receiveState,type ClientState,type StatePacket} from './sync.js';
export type {Socket} from 'socket.io-client';
/** All React and test consumers use the production reducer, including recovery. */
export function attachState(socket:Socket,onClear?:()=>void){
 let state:ClientState|undefined,resyncPending=false;
 const clear=()=>{state=undefined;onClear?.();for(const listener of socket.listeners('snapshot:clear'))listener.call(socket);};
 socket.on('state:clear',clear);
 socket.on('disconnect',()=>{clear();resyncPending=false;});
 socket.on('connect',()=>{state=undefined;resyncPending=false;});
 socket.on('state:update',(packet:StatePacket,ack:(value:unknown)=>void)=>{
  const result=receiveState(state,packet);state=result.state;
  if(result.resync){clear();if(!resyncPending){resyncPending=true;socket.emit('state:resync');}return;}
  if(result.applied){resyncPending=false;for(const listener of socket.listeners('snapshot'))listener.call(socket,state!.snapshot);}
  if(typeof ack==='function')ack({stream:packet.stream,seq:packet.seq});
 });
 return socket;
}
export function io(uri?:string|Partial<ManagerOptions & SocketOptions>,options?:Partial<ManagerOptions & SocketOptions>):Socket { return attachState(typeof uri==='string'?rawIo(uri,options):rawIo(uri)); }
