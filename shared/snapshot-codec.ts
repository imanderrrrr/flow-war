import type {Snapshot,FlowParticle} from './types.js';
// Only wire representation changes. Economic fields remain exact authoritative values.
const particleFields=['id','born','duration','color','customerId','kind','route','seed','requestId','companyId','executionVersion','status','reason','finishedAt','journey','queue'] as const;
/** Compact public companies once per broadcast; never cache across game ticks. */
export function compactCompanies(companies:Snapshot['companies']):Snapshot['companies'] {
 return companies.map(c=>({...c,particles:c.particles.map(p=>particleFields.map(k=>p[k]??null))})) as unknown as Snapshot['companies'];
}
export function compactSnapshot(snapshot:Snapshot,sharedCompanies?:Snapshot['companies']):Snapshot {
 const companies=sharedCompanies??compactCompanies(snapshot.companies);
 let privateCompany:any=snapshot.privateCompany;
 if(privateCompany){privateCompany={...privateCompany};const publicCompany=snapshot.companies[snapshot.identity!.companyId!];for(const key of Object.keys(privateCompany))if(key in publicCompany&&(Object.is(privateCompany[key],(publicCompany as any)[key])||JSON.stringify(privateCompany[key])===JSON.stringify((publicCompany as any)[key])))delete privateCompany[key];if(privateCompany.particles)privateCompany.particles=privateCompany.particles.map((p:FlowParticle)=>particleFields.map(k=>p[k]??null));}
 return {...snapshot,companies,privateCompany} as unknown as Snapshot;
}
export function expandSnapshot(wire:Snapshot):Snapshot {
 const decode=(rows:any[])=>rows.map(row=>{const p:Record<string,unknown>={};for(let i=0;i<particleFields.length;i++)if(row[i]!==null)p[particleFields[i]]=row[i];return p;});
 const companies=wire.companies.map(c=>({...c,particles:decode(c.particles)}));
 let privateCompany:any=wire.privateCompany;
 if(privateCompany){const {modules,pipelineCounts,...common}=companies[wire.identity!.companyId!];privateCompany={...common,...privateCompany};if(wire.privateCompany!.particles)privateCompany.particles=decode(wire.privateCompany!.particles);}
 return {...wire,companies,privateCompany} as unknown as Snapshot;
}
