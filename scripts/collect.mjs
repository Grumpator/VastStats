import {readFile,writeFile,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const HOUR=3600000, MAX_GAP=12*60000;
export function machineState(row,now=Date.now()){
  if(!row)return {connection:'unknown',maintenanceWindows:null,listed:null,listingEndsAt:null};
  // Match Vast's own Machines page: timeout is heartbeat age in seconds; >=10 is offline.
  const connection=Number.isFinite(row.timeout)&&row.timeout>=0?(row.timeout>=10?'offline':'online'):'unknown';
  const raw=row.machine_maintenance;
  let maintenanceWindows=null;
  if(raw===null||Array.isArray(raw)){
    const windows=[];let valid=true;
    for(const window of raw??[]){
      if(window.cancelled_at)continue;
      if(!Number.isFinite(window.start_time)||!Number.isFinite(window.duration_hours)||window.duration_hours<=0){valid=false;break;}
      const start=window.start_time*1000,end=start+window.duration_hours*HOUR;
      if(!Number.isFinite(end)||!Number.isFinite(new Date(start).getTime())||!Number.isFinite(new Date(end).getTime())){valid=false;break;}
      if(end>now)windows.push({start:new Date(start).toISOString(),end:new Date(end).toISOString()});
    }
    if(valid)maintenanceWindows=windows.sort((a,b)=>a.start.localeCompare(b.start));
  }
  const flag=row.listed===true||row.listed===1?true:row.listed===false||row.listed===0?false:null;
  const expiry=Number.isFinite(row.end_date)&&row.end_date>0?row.end_date*1000:null;
  const listingEndsAt=expiry&&Number.isFinite(new Date(expiry).getTime())?new Date(expiry).toISOString():null;
  return {connection,maintenanceWindows,listed:flag===true&&expiry!==null&&expiry<=now?false:flag,listingEndsAt};
}
export function parseMap(text){
  const mapping=JSON.parse(text);
  if(!mapping||Array.isArray(mapping)||typeof mapping!=='object'||!Object.keys(mapping).length)throw Error('Invalid box map');
  const names=Object.values(mapping);
  if(Object.keys(mapping).some(id=>!/^\d+$/.test(id))||names.some(n=>typeof n!=='string'||! /^[A-Za-z][A-Za-z0-9 _-]{0,23}$/.test(n))||new Set(names).size!==names.length)throw Error('Invalid box map');
  return mapping;
}
export function sanitizeMachines(raw,mapping,now=Date.now()){
  const rows=Array.isArray(raw)?raw:raw.machines;
  if(!Array.isArray(rows))throw Error('Unexpected machine response');
  return Object.entries(mapping).map(([id,name])=>{
    const row=rows.find(r=>String(r.id)===id);
    const running=row?.current_rentals_running,stored=row?.current_rentals_resident;
    const state=machineState(row,now);
    const validCounts=Number.isInteger(running)&&running>=0&&Number.isInteger(stored)&&stored>=running;
    // Construct an allowlist. Never spread, serialize, or log the API response.
    return {name,running:state.connection==='offline'?false:state.connection==='online'&&validCounts?running>0:null,storedInstances:validCounts?stored:null,...state};
  });
}
function windowSeconds(windows,start,end){
  let total=0,last=start;
  for(const window of windows){
    const a=Math.max(start,last,Date.parse(window.start)),b=Math.min(end,Date.parse(window.end));
    if(b>a){total+=(b-a)/1000;last=b;}
  }
  return total;
}
export function updateHistory(previous,samples,now=Date.now()){
  const stamp=new Date(now).toISOString();
  const boxes=samples.map(sample=>{
    const old=previous.boxes.find(b=>b.name===sample.name);
    const hours=(old?.hours??[]).map(h=>({start:h.start,end:h.end,observedSeconds:h.observedSeconds,occupiedSeconds:h.occupiedSeconds,storedInstances:h.storedInstances,incomeUsd:h.incomeUsd??null,connectionObservedSeconds:h.connectionObservedSeconds??0,offlineSeconds:h.offlineSeconds??0,maintenanceObservedSeconds:h.maintenanceObservedSeconds??0,maintenanceSeconds:h.maintenanceSeconds??0,listingObservedSeconds:h.listingObservedSeconds??0,listedSeconds:h.listedSeconds??0,unlistedSeconds:h.unlistedSeconds??0}));
    const last=old?.lastSample,start=last?Date.parse(last.at):NaN;
    if(Number.isFinite(start)&&now>start&&now-start<=MAX_GAP){
      // The previous observation represents time until this check. Long gaps stay unknown.
      for(let t=start;t<now;){
        const bucket=Math.floor(t/HOUR)*HOUR,end=Math.min(now,bucket+HOUR),seconds=(end-t)/1000;
        const key=new Date(bucket).toISOString();let row=hours.find(r=>r.start===key);
        if(!row){row={start:key,end:new Date(end).toISOString(),observedSeconds:0,occupiedSeconds:0,storedInstances:last.storedInstances,incomeUsd:null,connectionObservedSeconds:0,offlineSeconds:0,maintenanceObservedSeconds:0,maintenanceSeconds:0,listingObservedSeconds:0,listedSeconds:0,unlistedSeconds:0};hours.push(row);}
        row.end=new Date(end).toISOString();
        if(typeof last.running==='boolean'){row.observedSeconds+=seconds;row.occupiedSeconds+=last.running?seconds:0;}
        if(last.connection==='online'||last.connection==='offline')row.connectionObservedSeconds+=seconds;
        if(last.connection==='offline')row.offlineSeconds+=seconds;
        if(Array.isArray(last.maintenanceWindows)){row.maintenanceObservedSeconds+=seconds;row.maintenanceSeconds+=windowSeconds(last.maintenanceWindows,t,end);}
        if(typeof last.listed==='boolean'){
          const expiry=last.listingEndsAt?Date.parse(last.listingEndsAt):Infinity;
          const listed=last.listed?Math.max(0,(Math.min(end,expiry)-t)/1000):0;
          row.listingObservedSeconds+=seconds;row.listedSeconds+=listed;row.unlistedSeconds+=seconds-listed;
        }
        row.storedInstances=last.storedInstances;
        t=end;
      }
    }
    const latest=hours.at(-1);
    // At an exact boundary the count belongs to the new hour, not the previous hour.
    if(latest&&Math.floor(Date.parse(latest.start)/HOUR)===Math.floor(now/HOUR))latest.storedInstances=sample.storedInstances;
    return {name:sample.name,hours,lastSample:{at:stamp,running:sample.running,storedInstances:sample.storedInstances,connection:sample.connection??'unknown',maintenanceWindows:sample.maintenanceWindows??null,listed:sample.listed??null,listingEndsAt:sample.listingEndsAt??null}};
  });
  return {version:1,updatedAt:stamp,boxes};
}
export async function collect(){
  const key=process.env.VAST_API_KEY,map=process.env.VAST_BOX_MAP;
  if(!key||!map)throw Error('Set VAST_API_KEY and VAST_BOX_MAP repository secrets before collection');
  const mapping=parseMap(map);
  const response=await fetch('https://console.vast.ai/api/v0/machines/?owner=me&include_offline=1',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(45000)});
  if(!response.ok){console.error('Vast API returned HTTP '+response.status+'.');throw Error('Vast API request failed; previous data preserved');}
  const now=Date.now(),samples=sanitizeMachines(await response.json(),mapping,now);
  if(samples.some(s=>s.connection==='unknown'))console.warn('Some configured boxes have no usable heartbeat status. They will be shown as unknown, not offline.');
  const file=new URL('../public/data.json',import.meta.url),previous=JSON.parse(await readFile(file,'utf8'));
  const next=updateHistory(previous,samples,now);
  const temporary=new URL('../public/data.json.tmp',import.meta.url);
  await writeFile(temporary,JSON.stringify(next)+'\n');await rename(temporary,file);
  console.log('Public summary updated for '+next.boxes.length+' boxes.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)collect().catch(()=>{
  // API errors can include request URLs or credentials. Do not print the underlying error.
  console.error('Collection failed. Check repository secrets and Vast API availability. Existing data was preserved.');process.exitCode=1;
});
