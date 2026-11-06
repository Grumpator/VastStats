import {aggregate,dayKey,midnight,addDays} from '../public/model.js';
import {periodRunCount} from '../public/history-data.js';
import {compactSnapshots} from '../public/summary-model.js';

export const viewCacheVersion=1;
const HOUR=3600000;
export const deviceKey=box=>box.deviceKey??box.storageKey??box.name;
export function emptySnapshotBuckets(){return {hours:new Map(),days:new Map(),months:new Map()};}
export function addSnapshot(buckets,sample){
  const time=Date.parse(sample.at);if(!Number.isFinite(time))return;
  const key=dayKey(new Date(time));
  for(const [scale,start] of [['hours',Math.floor(time/HOUR)*HOUR],['days',midnight(key)],['months',midnight(key.slice(0,7)+'-01')]]){
    buckets[scale].set(start,compactSnapshots([...(buckets[scale].get(start)||[]),sample]));
  }
}
export function indexViews(cache){
  return new Map(cache.boxes.map(box=>[box.key,{...box,...Object.fromEntries(['hours','days','months'].map(scale=>[scale,new Map(box[scale].map(row=>[row.start,row]))]))}]));
}
export function buildBoxViews(box,files){
  const source={hours:files.flatMap(f=>f.hours),days:files.flatMap(f=>f.days||[]),runCounts:files.flatMap(f=>f.runCounts||[])};
  const rows=source.hours.map(row=>({...row,startMs:Date.parse(row.start),endMs:Date.parse(row.end)})).sort((a,b)=>a.startMs-b.startMs),days=new Map(),months=new Map();
  const dayCounts=new Map(source.days.map(row=>[Date.parse(row.start),row]));
  for(const row of rows){const key=dayKey(new Date(row.startMs));for(const [groups,id] of [[days,key],[months,key.slice(0,7)+'-01']]){if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}}
  const evidence=emptySnapshotBuckets();for(const file of files)for(const sample of file.snapshots)addSnapshot(evidence,sample);
  const make=(scale,start,end,records)=>{
    const row=scale==='hours'?records[0]:dayCounts.get(start);
    const runCount=scale==='months'?periodRunCount(source,{start,end}):row?.observedSeconds>0&&Number.isInteger(row.runningSessions)&&row.runningSessions>=0?row.runningSessions:null;
    return {start,end,value:aggregate(records,start,end,Infinity,Date.parse(box.historyStart)),runCount,snapshots:evidence[scale].get(start)||[]};
  };
  const total=aggregate(rows,-Infinity,Infinity,Infinity,Date.parse(box.historyStart));
  return {key:deviceKey(box),total:{occupied:total.occupied,observed:total.observed},
    hours:rows.map(row=>make('hours',Math.floor(row.startMs/HOUR)*HOUR,Math.floor(row.startMs/HOUR)*HOUR+HOUR,[row])),
    days:[...days].map(([key,records])=>make('days',midnight(key),midnight(addDays(key,1)),records)),
    months:[...months].map(([key,records])=>{const next=new Date(key+'T12:00Z');next.setUTCMonth(next.getUTCMonth()+1);return make('months',midnight(key),midnight(next.toISOString().slice(0,10)),records);})};
}
