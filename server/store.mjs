import {readFile,writeFile,mkdir,rename,cp,rm,readdir,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {dayKey,currentStatus,aggregate} from '../public/model.js';
import {validStorageKey,identityNamespace} from '../scripts/history-discovery.mjs';
import {occupancyPeriods,occupancyTotal} from './occupancy.mjs';

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
  constructor(root){this.root=path.resolve(root);this.leases=new Map();this.status=null;this.generation=null;this.writer=Promise.resolve();}
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
      if([await this.index(),this.status].some(value=>value&&value.identityNamespace!==namespace))throw Error('Local identity does not match stored data');
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
    // Validate all referenced month files before exposing a new generation.
    for(const b of index.boxes)for(const month of b.months){const file=await readJson(path.join(stage,b.storageKey??b.name,month+'.json'));if(file?.version!==2||file.name!==b.name||file.month!==month||!Array.isArray(file.hours)||!Array.isArray(file.snapshots))throw Error('Invalid history month');}
    const generation='gen-'+randomUUID();await rename(stage,this.historyPath(generation));
    await atomicJson(path.join(this.root,'CURRENT'),{generation});this.generation=generation;await this.cleanup();
  }
  async cleanup(){
    for(const entry of await readdir(path.join(this.root,'history'),{withFileTypes:true}))if(entry.isDirectory()&&entry.name.startsWith('gen-')&&entry.name!==this.generation&&!this.leases.has(entry.name))await rm(this.historyPath(entry.name),{recursive:true,force:true});
  }
  async publishStatus(status){
    const work=async()=>{
      if(this.status&&Date.parse(this.status.updatedAt)>=Date.parse(status.updatedAt))return;
      for(const box of status.boxes){
        const key=box.deviceKey??box.storageKey;if(!validStorageKey(key))throw Error('Invalid status identity');
        const sample=box.lastSample,state=currentStatus(sample,Date.parse(sample.at)),month=dayKey(new Date(sample.at)).slice(0,7);
        const file=path.join(this.root,'observations',key,month+'.json'),prior=await readJson(file,[]);
        const sighting={at:sample.at,connection:state.connection,listed:state.listed,maintenance:state.maintenance,reliability:sample.reliability??null,verification:sample.verification??null};
        await atomicJson(file,[...prior.filter(s=>s.at!==sighting.at),sighting].sort((a,b)=>a.at.localeCompare(b.at)));
      }
      await atomicJson(path.join(this.root,'status.json'),status);this.status=status;
    };
    const pending=this.writer.then(work);this.writer=pending.catch(()=>{});return pending;
  }
  async index(){return readJson(path.join(this.historyPath(),'index.json'));}
  async occupancy(now=Date.now()){
    const generation=this.generation;
    this.leases.set(generation,(this.leases.get(generation)||0)+1);
    try{
      const root=this.historyPath(generation),index=await readJson(path.join(root,'index.json')),oldTotals=this.occupancyTotals?.generation===generation?this.occupancyTotals.devices:null;
      const devices=new Map(),windows=new Map();
      const earliest=dayKey(new Date(now-720*3600000)).slice(0,7);
      for(const box of index.boxes){
        const key=box.deviceKey??box.storageKey??box.name,total=oldTotals?.get(key)??{occupied:0,observed:0};
        const values=Object.fromEntries(occupancyPeriods.map(period=>{
          const start=now-period.hours*3600000,boundary=Date.parse(box.historyStart);
          return [period.key,{occupied:0,observed:0,elapsed:Math.max(0,(now-Math.max(start,Number.isFinite(boundary)?boundary:start))/1000)}];
        }));
        // Stream one month at a time. All-time totals are reused until history changes.
        for(const month of box.months){
          if(oldTotals&&month<earliest)continue;
          const file=await readJson(path.join(root,box.storageKey??box.name,month+'.json'));
          const rows=(file.hours||[]).map(row=>({...row,startMs:Date.parse(row.start),endMs:Date.parse(row.end)}));
          if(!oldTotals){const value=aggregate(rows,-Infinity,now,now,Date.parse(box.historyStart));total.occupied+=value.occupied;total.observed+=value.observed;}
          if(month>=earliest)for(const period of occupancyPeriods){
            const value=aggregate(rows,now-period.hours*3600000,now,now,Date.parse(box.historyStart));
            values[period.key].occupied+=value.occupied;values[period.key].observed+=value.observed;
          }
        }
        devices.set(key,total);windows.set(key,values);
      }
      this.occupancyTotals={generation,devices};
      return {index,devices:new Map(index.boxes.map(box=>{
        const key=box.deviceKey??box.storageKey??box.name,value=devices.get(key),boundary=Date.parse(box.historyStart);
        const elapsedSeconds=Number.isFinite(boundary)?Math.max(0,(now-boundary)/1000):0;
        return [key,{...occupancyTotal(value.occupied,value.observed),elapsedSeconds,coverage:elapsedSeconds>0?Math.min(1,value.observed/elapsedSeconds):null}];
      })),windows};
    }finally{const remaining=this.leases.get(generation)-1;if(remaining)this.leases.set(generation,remaining);else this.leases.delete(generation);}
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
}
export const folderURL=folder=>pathToFileURL(folder+path.sep);
