import {readFile,writeFile,mkdir,rename,cp,rm,readdir,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {dayKey,currentStatus,aggregate} from '../public/model.js';
import {validStorageKey,identityNamespace} from '../scripts/history-discovery.mjs';
import {occupancyPeriods,occupancyTotal} from './occupancy.mjs';
import {periodWindow,periodBins} from '../public/periods.js';
import {compactSnapshots,combineSummaries} from '../public/summary-model.js';
import {mergeStatus} from '../public/overview-model.js';
import {buildBoxViews,indexViews,viewCacheVersion,deviceKey,emptySnapshotBuckets,addSnapshot} from './views.mjs';

export async function readJson(file,fallback=null){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function atomicJson(file,value){
  await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,JSON.stringify(value)+'\n',{mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}
}
const validMonth=m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export function validateIndex(index){
  if(index?.version!==2||!Array.isArray(index.boxes))throw Error('Invalid history index');
  for(const b of index.boxes)if(!validStorageKey(b.storageKey??b.name)||(b.deviceKey!==undefined&&!/^device-[a-f0-9]{32}$/.test(b.deviceKey))||!Array.isArray(b.months)||b.months.some(m=>!validMonth(m)))throw Error('Invalid history paths');
  return index;
}
export class DataStore {
  constructor(root){this.root=path.resolve(root);this.leases=new Map();this.status=null;this.generation=null;this.writer=Promise.resolve();this.observations=new Map();this.suspended=new Map();}
  historyPath(generation=this.generation){return path.join(this.root,'history',generation);}
  async open(){
    await mkdir(this.root,{recursive:true});
    this.lock=path.join(this.root,'process.lock');
    try{this.lockHandle=await open(this.lock,'wx');}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      const previous=await readJson(this.lock);if(!Number.isInteger(previous?.pid)||previous.pid<=0)throw Error('Invalid data lock; check that no app is using this directory');
      let alive=true;try{process.kill(previous.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
      if(alive)throw Error('Another process is already using DATA_DIR');
      await rm(this.lock);this.lockHandle=await open(this.lock,'wx');
    }
    await this.lockHandle.writeFile(JSON.stringify({pid:process.pid}));
    try{
      const pointer=await readJson(path.join(this.root,'CURRENT'));
      const identityFile=path.join(this.root,'identity.json');let identity=await readJson(identityFile);
      if(!identity){
        if(pointer)throw Error('Identity file is missing from existing storage; restore it or choose an empty DATA_DIR');
        identity={version:1,secret:randomBytes(32).toString('hex')};await atomicJson(identityFile,identity);
      }
      if(identity.version!==1||typeof identity.secret!=='string'||!/^[a-f0-9]{64}$/.test(identity.secret))throw Error('Invalid local identity file');
      this.identitySeed=identity.secret;const namespace=identityNamespace(this.identitySeed);
      if(pointer){if(!/^gen-[a-f0-9-]+$/.test(pointer.generation))throw Error('Invalid history generation');this.generation=pointer.generation;validateIndex(await readJson(path.join(this.historyPath(),'index.json')));}
      else{const stage=await this.stage(false);await atomicJson(path.join(stage,'index.json'),{version:2,source:'telemetry',identityNamespace:namespace,updatedAt:null,boxes:[]});await this.publish(stage);}
      this.status=await readJson(path.join(this.root,'status.json'));
      this.earningsReport=await readJson(path.join(this.root,'earnings.json'));
      const settings=await readJson(path.join(this.root,'suspended.json'),{devices:[]});
      this.suspended=new Map(settings.devices.map(device=>[device.deviceKey,device]));
      if([await this.index(),this.status].some(value=>value&&value.identityNamespace!==namespace))throw Error('Local identity does not match stored data');
      await this.loadViews();await this.loadObservations();
      for(const base of [this.root,path.join(this.root,'history')])for(const entry of await readdir(base,{withFileTypes:true}))if(entry.isDirectory()&&/^(status-stage-|stage-)/.test(entry.name))await rm(path.join(base,entry.name),{recursive:true,force:true});
      await this.cleanup();return this;
    }catch(e){await this.close();throw e;}
  }
  async stage(copy=true){
    const stage=path.join(this.root,'history','stage-'+randomUUID());await mkdir(stage,{recursive:true});
    if(copy&&this.generation)await cp(this.historyPath(),stage,{recursive:true,mode:constants.COPYFILE_FICLONE});
    return stage;
  }
  async publish(stage){
    const index=validateIndex(await readJson(path.join(stage,'index.json')));
    // Compute and persist views before exposing the generation. Readers keep the old view until ready.
    const cache=await this.buildViews(stage,index);await atomicJson(path.join(stage,'views.json'),cache);
    const generation='gen-'+randomUUID();await rename(stage,this.historyPath(generation));
    await atomicJson(path.join(this.root,'CURRENT'),{generation});this.generation=generation;
    this.viewData={generation,index,boxes:indexViews(cache)};await this.cleanup();
    this.detailCache?.clear();
  }
  async buildViews(root,index){
    const boxes=[];
    for(const box of index.boxes){
      const files=[];
      for(const month of box.months){const file=await readJson(path.join(root,box.storageKey??box.name,month+'.json'));if(file?.version!==2||file.name!==box.name||file.month!==month||!Array.isArray(file.hours)||!Array.isArray(file.snapshots))throw Error('Invalid history month');files.push(file);}
      boxes.push(buildBoxViews(box,files));
    }
    return {version:viewCacheVersion,updatedAt:index.updatedAt,boxes};
  }
  async loadViews(){
    if(this.viewData?.generation===this.generation)return;
    const root=this.historyPath(),index=validateIndex(await readJson(path.join(root,'index.json')));
    let cache;try{cache=await readJson(path.join(root,'views.json'));if(cache?.version!==viewCacheVersion||cache.updatedAt!==index.updatedAt||!Array.isArray(cache.boxes))cache=null;else indexViews(cache);}catch{cache=null;}
    if(!cache){cache=await this.buildViews(root,index);await atomicJson(path.join(root,'views.json'),cache);}
    this.viewData={generation:this.generation,index,boxes:indexViews(cache)};
  }
  recordObservation(key,sample){
    if(!this.observations.has(key))this.observations.set(key,emptySnapshotBuckets());
    addSnapshot(this.observations.get(key),sample);
  }
  async loadObservations(){
    const root=path.join(this.root,'observations');let entries;
    try{entries=await readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
    for(const entry of entries)if(entry.isDirectory()&&validStorageKey(entry.name)){
      for(const file of await readdir(path.join(root,entry.name)))if(validMonth(file.replace(/\.json$/,''))&&file.endsWith('.json'))for(const sample of await readJson(path.join(root,entry.name,file),[]))this.recordObservation(entry.name,sample);
    }
  }
  revision(){return this.generation+':'+(this.status?.updatedAt??'');}
  details(period,reference=Date.now(),now=Date.now()){
    const view=this.viewData,window=periodWindow(period,Math.min(reference,now)),bins=periodBins(window);
    const cacheKey=this.revision()+':'+period+':'+window.start;
    this.detailCache??=new Map();
    if(this.detailCache.has(cacheKey))return this.detailCache.get(cacheKey);
    const history=mergeStatus(view.index,this.status);
    const boxes=history.boxes.map(box=>{
      const key=deviceKey(box),cached=view.boxes.get(key),observations=this.observations.get(key);
      const {hours,days,runCounts,snapshots,...metadata}=box;
      return {...metadata,summaries:bins.map(bin=>{
        const row=cached?.[window.scale].get(bin.start);
        return {start:bin.start,end:bin.end,value:row?.value??null,runCount:row?.runCount??null,snapshots:compactSnapshots([...(row?.snapshots||[]),...(observations?.[window.scale].get(bin.start)||[])])};
      })};
    });
    const result={...history,representation:'summaries',revision:this.revision(),window,boxes};
    this.detailCache.set(cacheKey,result);while(this.detailCache.size>24)this.detailCache.delete(this.detailCache.keys().next().value);
    return result;
  }
  async cleanup(){
    for(const entry of await readdir(path.join(this.root,'history'),{withFileTypes:true}))if(entry.isDirectory()&&entry.name.startsWith('gen-')&&entry.name!==this.generation&&!this.leases.has(entry.name))await rm(this.historyPath(entry.name),{recursive:true,force:true});
  }
  async publishStatus(status){
    const work=async()=>{
      if(this.status&&Date.parse(this.status.updatedAt)>=Date.parse(status.updatedAt))return;
      const sightings=[];
      for(const box of status.boxes){
        const key=box.deviceKey??box.storageKey;if(!validStorageKey(key))throw Error('Invalid status identity');
        const sample=box.lastSample,state=currentStatus(sample,Date.parse(sample.at)),month=dayKey(new Date(sample.at)).slice(0,7);
        const file=path.join(this.root,'observations',key,month+'.json'),prior=await readJson(file,[]);
        const sighting={at:sample.at,connection:state.connection,listed:state.listed,maintenance:state.maintenance,reliability:sample.reliability??null,verification:sample.verification??null};
        sightings.push([key,sighting]);
        await atomicJson(file,[...prior.filter(s=>s.at!==sighting.at),sighting].sort((a,b)=>a.at.localeCompare(b.at)));
      }
      await atomicJson(path.join(this.root,'status.json'),status);this.status=status;
      for(const [key,sample] of sightings)this.recordObservation(key,sample);
      this.detailCache?.clear();
    };
    const pending=this.writer.then(work);this.writer=pending.catch(()=>{});return pending;
  }
  async index(){return readJson(path.join(this.historyPath(),'index.json'));}
  async settingsDevices(){
    const index=await this.index(),devices=new Map(this.suspended);
    for(const box of [...index.boxes,...(this.status?.boxes??[])]){
      const key=deviceKey(box);
      devices.set(key,{deviceKey:key,name:box.name});
    }
    return [...devices.values()];
  }
  setSuspended(key,suspended){
    const pending=this.writer.then(async()=>{
      const device=(await this.settingsDevices()).find(device=>device.deviceKey===key);
      if(!device)return false;
      if(this.suspended.has(key)===suspended)return true;
      const next=new Map(this.suspended);
      if(suspended)next.set(key,device);else next.delete(key);
      await atomicJson(path.join(this.root,'suspended.json'),{devices:[...next.values()]});
      this.suspended=next;
      return true;
    });
    this.writer=pending.catch(()=>{});
    return pending;
  }
  workedInBillingReport(report){
    const view=this.viewData;
    if(this.billingWork?.view===view&&this.billingWork.report===report)return this.billingWork.totals;
    const hourMs=3600000,dayMs=24*hourMs;
    const days=new Set(report.daily.map(row=>Date.parse(row.day+'T00:00Z')));
    const cutoff=Math.floor(Date.parse(report.updatedAt)/hourMs)*hourMs;
    const totals=new Map();
    for(const [key,box] of view.boxes){
      let worked=0,observed=0;
      for(const {start,end,value} of box.hours.values()){
        if(end>cutoff||!days.has(Math.floor(start/dayMs)*dayMs))continue;
        worked+=value.occupied;
        observed+=value.observed;
      }
      if(observed>0)totals.set(key,worked);
    }
    this.billingWork={view,report,totals};
    return totals;
  }
  async occupancy(now=Date.now()){
    const view=this.viewData,index=view.index,devices=new Map(),windows=new Map();
    const ranges=occupancyPeriods.map(period=>periodWindow(period.key,now));
    for(const box of index.boxes){
      const key=deviceKey(box),cached=view.boxes.get(key),boundary=Date.parse(box.historyStart);
      const elapsedSeconds=Number.isFinite(boundary)?Math.max(0,(now-boundary)/1000):0;
      const total=cached.total;
      devices.set(key,{...occupancyTotal(total.occupied,total.observed),elapsedSeconds,coverage:elapsedSeconds?Math.min(1,total.observed/elapsedSeconds):null});
      windows.set(key,Object.fromEntries(ranges.map(range=>{
        const rows=periodBins(range).map(bin=>cached[range.scale].get(bin.start)?.value).filter(Boolean);
        const value=combineSummaries(rows,range,now,boundary);
        return [range.key,{occupied:value.occupied,observed:value.observed,elapsed:value.elapsed}];
      })));
    }
    return {index,devices,windows};
  }
  async history(from,to){
    const generation=this.generation;this.leases.set(generation,(this.leases.get(generation)||0)+1);
    try{
      const root=this.historyPath(generation),index=validateIndex(await readJson(path.join(root,'index.json'))),months=[];
      for(let month=from.slice(0,7);month<=to.slice(0,7);){months.push(month);const date=new Date(month+'-01T12:00Z');date.setUTCMonth(date.getUTCMonth()+1);month=date.toISOString().slice(0,7);}
      const boxes=[];
      for(const box of index.boxes){
        const files=[];for(const month of box.months.filter(m=>months.includes(m)))files.push(await readJson(path.join(root,box.storageKey??box.name,month+'.json')));
        const sightings=[];for(const month of months)sightings.push(...await readJson(path.join(this.root,'observations',box.deviceKey??box.storageKey??box.name,month+'.json'),[]));
        const rows=key=>files.flatMap(f=>f[key]||[]).filter(r=>dayKey(new Date(r.start??r.at))>=from&&dayKey(new Date(r.start??r.at))<=to);
        const snapshots=[...new Map([...rows('snapshots'),...sightings.filter(s=>dayKey(new Date(s.at))>=from&&dayKey(new Date(s.at))<=to)].map(s=>[s.at,s])).values()].sort((a,b)=>a.at.localeCompare(b.at));
        boxes.push({...box,hours:rows('hours'),days:rows('days'),runCounts:rows('runCounts'),snapshots});
      }
      // Include newly discovered devices even before their first history import.
      const status=this.status;
      if(!index.identityNamespace&&!index.boxes.length&&status?.identityNamespace)index.identityNamespace=status.identityNamespace;
      if(status?.identityNamespace===index.identityNamespace)for(const b of status.boxes)if(!boxes.some(old=>old.deviceKey===b.deviceKey)){
        const snapshots=[];for(const month of months)snapshots.push(...await readJson(path.join(this.root,'observations',b.deviceKey,month+'.json'),[]));
        boxes.push({...b,months:[],historyStart:b.firstSeenAt,hours:[],days:[],runCounts:[],snapshots:snapshots.filter(s=>dayKey(new Date(s.at))>=from&&dayKey(new Date(s.at))<=to)});
      }
      return {...index,boxes};
    }finally{const remaining=this.leases.get(generation)-1;if(remaining)this.leases.set(generation,remaining);else this.leases.delete(generation);}
  }
  async close(){await this.writer;if(this.lockHandle){await this.lockHandle.close();this.lockHandle=null;await rm(this.lock,{force:true});}}
  async publishEarnings(report){await atomicJson(path.join(this.root,'earnings.json'),report);this.earningsReport=report;}
}
export const folderURL=folder=>pathToFileURL(folder+path.sep);
