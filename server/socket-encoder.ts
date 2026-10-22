import {createRequire} from 'node:module';
// Resolve the parser from socket.io's own location: the exact CommonJS instance its Client and adapter use.
const parser=createRequire(createRequire(import.meta.url).resolve('socket.io'))('socket.io-parser') as typeof import('socket.io-parser');
type Packet=Parameters<InstanceType<typeof parser.Encoder>['encode']>[0];
// Public at runtime and used by encode() itself; the published typings mark it private.
type StringEncoder={encodeAsString(packet:Packet):string};

/** state:update payloads are JSON round-tripped by SnapshotSync, so the recursive binary scan can never match. */
export class StateUpdateEncoder extends parser.Encoder {
 encode(packet:Packet){
  if(packet.type===parser.PacketType.EVENT&&Array.isArray(packet.data)&&packet.data[0]==='state:update')return [(this as unknown as StringEncoder).encodeAsString(packet)];
  return super.encode(packet);
 }
}
export const stateUpdateParser={...parser,Encoder:StateUpdateEncoder};
export const standardEncoder=()=>new parser.Encoder();
export {parser as socketIoParser};
