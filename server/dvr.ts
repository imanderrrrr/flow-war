import type {Express,Request} from 'express';
import type {DatabaseSync} from 'node:sqlite';
import type {Identity} from '../shared/types.js';
import {DvrPool,DvrBusy} from './dvr-pool.js';
import type {DvrQuery} from './dvr-query.js';
export {visibleFact} from './projections.js';
export function installDvr(app:Express,db:DatabaseSync,identityFor:(req:Request)=>Identity|null){
 const path=(db.prepare('PRAGMA database_list').get()as{file:string}).file;
 if(!path)throw Error('El DVR HTTP requiere historial SQLite durable.');
 const pool=new DvrPool(path,{workers:Number(process.env.FLOW_DVR_WORKERS??2)});
 const route=(url:string,kind:DvrQuery['kind'])=>app.get(url,async(req,res)=>{
  res.setHeader('Cache-Control','no-store');const identity=identityFor(req);if(!identity)return res.sendStatus(403);
  const controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};req.once('aborted',abort);res.once('close',abort);
  try{
   const query:DvrQuery={kind,identity,generation:Number(req.params.generation??0),companyId:Number(req.query.companyId??identity.companyId??0),at:req.query.at===undefined?undefined:Number(req.query.at),before:req.query.before===undefined?undefined:Number(req.query.before),requestId:typeof req.params.id==='string'?req.params.id:undefined};
   const data=await pool.run(query,controller.signal);if(!controller.signal.aborted)res.json(data);
  }catch(e){if(!controller.signal.aborted){const error=e instanceof DvrBusy?e:new DvrBusy();if(error.status===429||error.status===503)res.setHeader('Retry-After','1');res.status(error.status).json({error:error.message});}}
  finally{req.off('aborted',abort);res.off('close',abort);}
 });
 route('/api/dvr/games','games');route('/api/dvr/:generation','frame');route('/api/dvr/:generation/chat','chat');route('/api/dvr/:generation/metrics','metrics');route('/api/dvr/:generation/requests/:id','request');
 return pool;
}
