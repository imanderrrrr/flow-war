type Requester=(url:string,init:{signal:AbortSignal})=>Promise<Response>;
/** One request lane: abort transport and ignore stale results even if transport ignores abort. */
export class LatestDvrRequest<T>{
 private version=0;
 private controller?:AbortController;
 constructor(private readonly fetcher:Requester=(url,init)=>fetch(url,init)){}
 cancel(){this.version++;this.controller?.abort();this.controller=undefined;}
 async get(url:string):Promise<T|undefined>{
  this.cancel();const version=this.version,controller=new AbortController();this.controller=controller;
  const stale=()=>controller.signal.aborted||version!==this.version;
  try{
   const response=await this.fetcher(url,{signal:controller.signal});
   const body=await response.json().catch(()=>{throw Error('El DVR no devolvió evidencia válida.');});
   if(stale())return undefined;
   if(!response.ok){
    if(response.status===429||response.status===503)throw Error('El DVR está ocupado. Espera un momento y vuelve a intentarlo.');
    throw Error(typeof body?.error==='string'?body.error:'No se pudo consultar la evidencia histórica.');
   }
   return body as T;
  }catch(error){if(stale())return undefined;if(error instanceof TypeError)throw Error('No se pudo conectar con el DVR.');throw error;}
  finally{if(this.controller===controller)this.controller=undefined;}
 }
}
