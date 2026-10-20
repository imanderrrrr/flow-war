import {expandSnapshot} from './snapshot-codec.js';
import type {Snapshot} from './types.js';
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
// Compact, immutable tree edits. Keyed collections preserve IDs, ordering and deletions.
export type Patch = ['=',Json] | ['o',Record<string,Patch>,string[]] | ['a',number,Record<string,Patch>] | ['k',string[]|null,Record<string,Patch>];
const object=(v:Json):v is {[key:string]:Json}=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keyed=(v:Json[]):boolean=>v.length>0&&v.every(x=>object(x)&&typeof x.id==='string')&&new Set(v.map(x=>(x as any).id)).size===v.length;
export function difference(before:Json,after:Json):Patch|undefined {
 if(before===after)return;
 if(Array.isArray(before)&&Array.isArray(after)){
  if(keyed(before)&&keyed(after)){
   const old=new Map(before.map(v=>[(v as any).id as string,v])),order=after.map(v=>(v as any).id as string),changes:Record<string,Patch>={};
   for(const item of after){const id=(item as any).id as string,p=old.has(id)?difference(old.get(id)!,item):['=',item] as Patch;if(p)changes[id]=p;}
   const sameOrder=before.length===after.length&&before.every((v,i)=>(v as any).id===order[i]);
   if(sameOrder&&!Object.keys(changes).length)return;
   const patch:Patch=['k',sameOrder?null:order,changes];return JSON.stringify(patch).length<JSON.stringify(after).length?patch:['=',after];
  }
  const changes:Record<string,Patch>={};for(let i=0;i<after.length;i++){const p=i<before.length?difference(before[i],after[i]):['=',after[i]] as Patch;if(p)changes[i]=p;}
  if(before.length===after.length&&!Object.keys(changes).length)return;
  const patch:Patch=['a',after.length,changes];return JSON.stringify(patch).length<JSON.stringify(after).length?patch:['=',after];
 }
 if(object(before)&&object(after)){
  const changes:Record<string,Patch>={},removed=Object.keys(before).filter(k=>!Object.hasOwn(after,k));
  for(const key of Object.keys(after)){const p=Object.hasOwn(before,key)?difference(before[key],after[key]):['=',after[key]] as Patch;if(p)changes[key]=p;}
  if(!removed.length&&!Object.keys(changes).length)return;return ['o',changes,removed];
 }
 return ['=',after];
}
const safe=(key:string)=>{if(['__proto__','constructor','prototype'].includes(key))throw Error('Invalid state key');return key;};
export function applyPatch(before:Json,patch:Patch):Json {
 if(patch[0]==='=')return patch[1];
 if(patch[0]==='o'){
  if(!object(before))throw Error('Object base required');const result={...before};for(const k of patch[2])delete result[safe(k)];for(const [k,p]of Object.entries(patch[1]))result[safe(k)]=applyPatch(result[k]??null,p);return result;
 }
 if(!Array.isArray(before))throw Error('Array base required');
 if(patch[0]==='a'){const result=before.slice(0,patch[1]);for(const [k,p]of Object.entries(patch[2]))result[Number(k)]=applyPatch(result[Number(k)]??null,p);return result;}
 const old=new Map(before.map(v=>[(v as any).id as string,v])),order=patch[1]??before.map(v=>(v as any).id as string);
 return order.map(id=>patch[2][id]?applyPatch(old.get(id)??null,patch[2][id]):old.get(id)!);
}
export type StatePacket=({protocol:1;stream:string;seq:number;generation:number;identity:string;kind:'full';snapshot:Snapshot}|{protocol:1;stream:string;seq:number;generation:number;identity:string;kind:'delta';base:number;patch:Patch}) & {compact?:1};
export type ClientState={stream:string;seq:number;generation:number;identity:string;snapshot:Snapshot;wire?:Snapshot;compact?:1};
export const identityKey=(s:Snapshot)=>s.identity?`${s.identity.id}:${s.identity.role}:${s.identity.companyId}`:'public';
export function receiveState(state:ClientState|undefined,packet:StatePacket):{state:ClientState|undefined;resync:boolean;applied:boolean}{
 if(packet.protocol!==1||!Number.isSafeInteger(packet.seq)||packet.seq<1)return{state:undefined,resync:true,applied:false};
 if(state&&packet.stream!==state.stream)return{state,resync:true,applied:false};
 if(state&&packet.seq<=state.seq)return{state,resync:false,applied:false};
 if(packet.kind==='full'){
  if(state&&state.generation===packet.generation&&packet.snapshot.tick<state.snapshot.tick)return{state:undefined,resync:true,applied:false};
  if(packet.snapshot.generation!==packet.generation||identityKey(packet.snapshot)!==packet.identity)return{state:undefined,resync:true,applied:false};
  return{state:{stream:packet.stream,seq:packet.seq,generation:packet.generation,identity:packet.identity,snapshot:packet.compact?expandSnapshot(packet.snapshot):packet.snapshot,wire:packet.snapshot,compact:packet.compact},resync:false,applied:true};
 }
 if(!state||packet.base!==state.seq||packet.seq!==state.seq+1||packet.identity!==state.identity||packet.generation!==state.generation)return{state:undefined,resync:true,applied:false};
 try{const wire=applyPatch((state.wire??state.snapshot) as unknown as Json,packet.patch) as unknown as Snapshot;const snapshot=state.compact?expandSnapshot(wire):wire;if(snapshot.generation!==packet.generation||identityKey(snapshot)!==packet.identity||snapshot.tick<state.snapshot.tick)throw Error('Invalid successor');return{state:{...state,seq:packet.seq,snapshot,wire},resync:false,applied:true};}catch{return{state:undefined,resync:true,applied:false};}
}
