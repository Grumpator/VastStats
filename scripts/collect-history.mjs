import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {HistoryApi} from './history-api.mjs';
import {summarizeHistory} from './history-model.mjs';
import {parseMap,sanitizeMachines} from './collect.mjs';
import {dayKey,midnight} from '../public/model.js';
const DAY=86400;
export function nextMonth(month,delta=1){const d=new Date(month+'-01T12:00Z');d.setUTCMonth(d.getUTCMonth()+delta);return d.toISOString().slice(0,7);}
export function monthWindow(month){return [midnight(month+'-01')/1000,midnight(nextMonth(month)+'-01')/1000];}
export function mergeHours(previous,incoming){
  const rows=new Map(previous.map(r=>[r.start,r]));
  for(const row of incoming){const old=rows.get(row.start);if(!old||row.observedSeconds>=old.observedSeconds)rows.set(row.start,row);}
  return [...rows.values()].sort((a,b)=>a.start.localeCompare(b.start));
}
async function readJson(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function save(file,value){const temp=new URL(file.href+'.tmp');await writeFile(temp,JSON.stringify(value)+'\n');await rename(temp,file);}
export async function collectHistory({api,root=new URL('../public/data/',import.meta.url),now=Date.now(),mapping}={}){
  mapping??=parseMap(process.env.VAST_BOX_MAP||'');
  if(new Set(Object.values(mapping).map(n=>n.toLowerCase())).size!==Object.keys(mapping).length)throw Error('Public box names must be unique ignoring case');
  api??=new HistoryApi(process.env.VAST_API_KEY);
  await mkdir(root,{recursive:true});
  const previous=await readJson(new URL('index.json',root),{version:2,boxes:[]});
  const current=sanitizeMachines(await api.machines(),mapping,now);
  await api.connect();
  const stamp=new Date(now).toISOString(),month=dayKey(new Date(now)).slice(0,7),boxes=[];
  for(const [id,name] of Object.entries(mapping)){
    const old=previous.boxes.find(b=>b.name===name),sample=current.find(b=>b.name===name);
    const entry={name,months:[...(old?.months||[])],lastSample:{at:stamp,running:sample.running,runningInstances:sample.runningInstances,storedInstances:sample.storedInstances,allocatedStorageGb:sample.allocatedStorageGb,connection:sample.connection,maintenanceWindows:sample.maintenanceWindows,listed:sample.listed,listingEndsAt:sample.listingEndsAt},historyUpdatedAt:old?.historyUpdatedAt??null,dataThrough:old?.dataThrough??null};
    try{
      const meta=await api.meta(id),first=meta.extent?.t0;
      if(!Number.isFinite(first)||first<=0)throw Error('No history extent');
      const from=dayKey(new Date(first*1000)).slice(0,7),available=[];
      for(let m=from;m<=month;m=nextMonth(m)){if(available.length>=120)throw Error('History range too large');available.push(m);}
      const stop=Math.floor(now/1000);
      // Discover one reporting series. CPU/memory values stay private; only their sample presence is used.
      const overview=await api.query(id,first,stop,{metric:{points:100}});
      const keys=Object.keys(overview.sections?.metric?.channels||{}),series=keys.find(k=>/cpu|memory|mem_/i.test(k))??keys[0];
      if(!series)throw Error('Reporting coverage unavailable');
      for(const m of available){
        const folder=new URL(encodeURIComponent(name)+'/',root);await mkdir(folder,{recursive:true});
        const file=new URL(m+'.json',folder),cached=await readJson(file,null);
        const recent=m===month||(Number(dayKey(new Date(now)).slice(-2))<=7&&m===nextMonth(month,-1));
        if(cached&&!recent&&process.env.HISTORY_REBUILD!=='1')continue;
        const [begin,end]=monthWindow(m),until=Math.min(end,stop);
        const priorThrough=cached?.dataThrough?Date.parse(cached.dataThrough)/1000:null;
        const since=Math.max(begin,first,process.env.HISTORY_REBUILD!=='1'&&priorThrough?priorThrough-3*DAY:begin);
        const responses=[];
        // Request fine coverage. Vast may return native coarser buckets; >5m is rejected by the reducer.
        for(let at=since;at<until;){
          const to=Math.min(until,(Math.floor(at/DAY)+1)*DAY);
          responses.push(await api.query(id,at,to,{conts:{},metric:{series:[series],points:Math.max(1,Math.ceil((to-at)/15))}}));
          at=to;
        }
        if(!responses.length)continue;
        const summary=summarizeHistory({name,start:since,stop:until,responses,now});
        // A changed upstream format must not erase previously recovered hours.
        summary.hours=mergeHours(cached?.hours||[],summary.hours);
        const through=[summary.dataThrough,cached?.dataThrough].filter(t=>Number.isFinite(Date.parse(t))).sort();
        summary.dataThrough=through.at(-1)??null;
        summary.month=m;summary.final=m<month&&!recent;
        summary.snapshots=cached?.snapshots||[];
        if(m===month){const status={at:stamp,connection:sample.connection,listed:sample.listed,maintenance:sample.maintenanceWindows?.some(w=>Date.parse(w.start)<=now&&now<Date.parse(w.end))??null};summary.snapshots=[...summary.snapshots.filter(s=>s.at!==stamp),status];}
        await save(file,summary);
        if(!entry.months.includes(m))entry.months.push(m);
        console.log(name+' '+m+': '+summary.hours.length+' hourly summaries.');
      }
      entry.months.sort();
      const latest=await readJson(new URL(encodeURIComponent(name)+'/'+entry.months.at(-1)+'.json',root),null);
      entry.dataThrough=latest?.dataThrough??entry.dataThrough;entry.historyUpdatedAt=stamp;
    }catch{
      entry.historyError=true;
      console.warn(name+': history refresh unavailable; keeping existing summaries.');
    }
    boxes.push(entry);
  }
  const result={version:2,source:'telemetry',updatedAt:stamp,snapshotMaxAgeSeconds:5400,boxes};
  await save(new URL('index.json',root),result);
  if(boxes.every(b=>b.historyError))throw Error('No box history could be refreshed');
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)collectHistory().catch(()=>{console.error('API history refresh failed. No credentials or raw API data were logged.');process.exitCode=1;});
