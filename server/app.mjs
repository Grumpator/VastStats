import http from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mergeStatus} from '../public/overview-model.js';
import {occupancyPeriods,occupancyResult} from './occupancy.mjs';

export function dateWindow(url){
  const from=url.searchParams.get('from'),to=url.searchParams.get('to');
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value??'')&&Number.isFinite(Date.parse(value+'T12:00Z'))&&new Date(value+'T12:00Z').toISOString().slice(0,10)===value;
  if(!valid(from)||!valid(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>3660)throw Error('Use valid inclusive from/to dates, at most ten years apart');
  return {from,to};
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
export async function createServer({runtime,publicDir,now=Date.now}){
  // Only top-level application assets are public; data directories and config are not.
  const assets=new Set((await readdir(publicDir,{withFileTypes:true})).filter(f=>f.isFile()&&mime[path.extname(f.name)]).map(f=>f.name));
  let occupancyCache=null;
  async function occupancySummary(){
    const time=now(),key=runtime.store.generation+':'+Math.floor(time/60000);
    if(occupancyCache?.key!==key){
      const pending=runtime.store.occupancy(time);occupancyCache={key,pending};
      pending.catch(()=>{if(occupancyCache?.key===key)occupancyCache=null;});
    }
    return occupancyCache.pending;
  }
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
    const send=(code,value,type='application/json; charset=utf-8')=>{
      const body=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value)),etag='"'+createHash('sha256').update(body).digest('hex').slice(0,24)+'"';
      res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-cache');res.setHeader('ETag',etag);
      if(code===200&&req.headers['if-none-match']===etag){res.writeHead(304);res.end();return;}
      res.writeHead(code);res.end(req.method==='HEAD'?undefined:body);
    };
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');send(405,{error:'Read-only endpoint'});return;}
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/healthz'){
        const health=runtime.health(),index=await runtime.store.index();health.history.updatedAt=index.updatedAt??null;send(200,health);return;
      }
      if(url.pathname==='/api/status'||url.pathname==='/api/overview'){
        const status=runtime.store.status,index=await runtime.store.index();
        // Now has its own collection clock; history imports must not replace it.
        const snapshot=status??{...index,version:1,source:'telemetry'};
        if(url.pathname==='/api/status'){send(200,{...snapshot,collection:runtime.health()});return;}
        const stats=await occupancySummary(),totals={};
        for(const period of occupancyPeriods){
          const fleet={occupied:0,observed:0,elapsed:0};
          for(const box of snapshot.boxes){const value=stats.windows.get(box.deviceKey??box.storageKey??box.name)?.[period.key];if(value)for(const field of ['occupied','observed','elapsed'])fleet[field]+=value[field];}
          totals[period.key]=occupancyResult(fleet);
        }
        const metadata=new Map(stats.index.boxes.map(box=>[box.deviceKey??box.storageKey??box.name,box]));
        send(200,{...snapshot,historyUpdatedAt:stats.index.updatedAt??null,occupancy:totals,boxes:snapshot.boxes.map(box=>{
          const key=box.deviceKey??box.storageKey??box.name;
          return {...metadata.get(key),...box,totalOccupancy:stats.devices.get(key)??null};
        }),collection:runtime.health()});return;
      }
      if(url.pathname==='/api/history'){
        let window;try{window=dateWindow(url);}catch(e){send(400,{error:e.message});return;}
        const history=await runtime.store.history(window.from,window.to),status=runtime.store.status;
        const merged=mergeStatus(history,status);
        // A just-discovered device may have been added by mergeStatus during this request.
        for(const b of merged.boxes){b.hours??=[];b.days??=[];b.runCounts??=[];b.snapshots??=[];}
        send(200,{...merged,collection:runtime.health()});return;
      }
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!assets.has(name)){send(404,{error:'Not found'});return;}
      send(200,await readFile(path.join(publicDir,name)),mime[path.extname(name)]);
    }catch{send(503,{error:'Cached data is temporarily unavailable'});}
  });
}
