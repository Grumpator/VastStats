import {dayKey,midnight,addDays} from '../public/model.js';
// All input timestamps are UNIX seconds. Only aggregates leave this module.
export function mergeIntervals(intervals){
  const result=[];
  for(const [start,end] of intervals.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0])){
    const last=result.at(-1);if(last&&start<=last[1])last[1]=Math.max(last[1],end);else result.push([start,end]);
  }
  return result;
}
export function intersectIntervals(left,right){
  const result=[];let a=0,b=0;
  while(a<left.length&&b<right.length){const start=Math.max(left[a][0],right[b][0]),end=Math.min(left[a][1],right[b][1]);if(end>start)result.push([start,end]);if(left[a][1]<right[b][1])a++;else b++;}
  return result;
}
const seconds=intervals=>intervals.reduce((n,[a,b])=>n+b-a,0);
export function mergeRuns(rows){
  const result=[];
  for(const row of rows.filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start||a.end-b.end)){
    const last=result.at(-1);
    if(last&&(row.start<last.end||(row.start===last.end&&(last.openEnd||row.openStart)))){
      if(row.end>last.end){last.end=row.end;last.openEnd=row.openEnd;}
      else if(row.end===last.end)last.openEnd=last.openEnd&&row.openEnd;
    }else result.push({...row});
  }
  return result;
}

export function coverageIntervals(metric,start,stop){
  // Refuse coarse charts: a nonempty monthly chart bucket does not prove an hour was observed.
  if(!metric||!Array.isArray(metric.t)||!Number.isFinite(metric.step)||metric.step<=0||(!metric.raw&&metric.step>300))return [];
  const width=metric.raw?1:metric.step;
  const channels=Object.values(metric.channels||{}).filter(c=>Array.isArray(c?.avg));
  if(!channels.length)return [];
  return mergeIntervals(metric.t.flatMap((t,i)=>Number.isFinite(t)&&channels.some(c=>Number.isFinite(c.avg[i]))?[[Math.max(start,t),Math.min(stop,t+width)]]:[]));
}

export function summarizeHistory({name,start,stop,responses,now=Date.now()}){
  if(typeof name!=='string'||!Number.isFinite(start)||!Number.isFinite(stop)||stop<=start)throw Error('Invalid history window');
  const limit=Math.min(stop,now/1000),coverage=[],running=[],uncertain=[],containers=new Map();
  for(const response of responses){
    const metric=response.sections?.metric;
    coverage.push(...coverageIntervals(metric,start,limit));
    const section=response.sections?.conts;
    if(section?.error||!Array.isArray(section?.active))throw Error('Container history unavailable');
    const view=section.view??response.view;
    for(const row of section.active){
      const id=typeof row.id==='string'&&/^\d+$/.test(row.id)?Number(row.id):row.id;
      if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid container history: identifier');
      if(!Number.isFinite(row.first_seen))throw Error('Invalid container history: first observation');
      if(!Number.isFinite(row.last_seen))throw Error('Invalid container history: last observation');
      if(!Array.isArray(row.runs))throw Error('Invalid container history: intervals');
      const old=containers.get(id);
      containers.set(id,{first:Math.min(old?.first??Infinity,row.first_seen),last:Math.max(old?.last??-Infinity,row.last_seen),ended:old&&old.last>row.last_seen?old.ended:row.end_witnessed===true,runs:old?.runs||[]});
      if(row.approx){if(Array.isArray(view))uncertain.push([view[0],view[1]]);else uncertain.push([start,limit]);}
      for(const run of row.runs){
        if(!Number.isFinite(run.start)||!Number.isFinite(run.end)||run.end<run.start)throw Error('Invalid running interval');
        if(run.fragmented)uncertain.push([run.start,run.end]);else {const span=[Math.max(start,run.start),Math.min(limit,run.end)];running.push(span);containers.get(id).runs.push({start:span[0],end:span[1],openStart:!!run.open_start,openEnd:!!run.open_end});}
      }
    }
  }
  // Hardware buckets can extend beyond the last container observation. An open
  // container has no known stop, so that trailing time is unknown, never idle.
  const lifetimes=[...containers.values()];
  if(lifetimes.some(c=>!c.ended))uncertain.push([Math.max(...lifetimes.map(c=>c.last)),limit]);
  // Remove approximate/fragmented spans from coverage, rather than treating them as idle or full.
  const exclusions=mergeIntervals(uncertain),observed=[];
  for(const [a,b] of mergeIntervals(coverage)){
    let cursor=a;for(const [x,y] of exclusions){if(y<=cursor)continue;if(x>=b)break;if(x>cursor)observed.push([cursor,Math.min(x,b)]);cursor=Math.max(cursor,y);if(cursor>=b)break;}if(cursor<b)observed.push([cursor,b]);
  }
  const occupied=intersectIntervals(mergeIntervals(running),observed),hours=[];
  const instanceRuns=lifetimes.map(c=>mergeRuns(c.runs));
  const countIn=range=>{const known=intersectIntervals(observed,range);return instanceRuns.reduce((n,runs)=>n+runs.filter(r=>intersectIntervals([[r.start,r.end]],known).length>0).length,0);};
  for(let at=Math.floor(start/3600)*3600;at<limit;at+=3600){
    const end=Math.min(at+3600,limit),range=[[Math.max(at,start),end]],known=intersectIntervals(observed,range),seen=seconds(known);
    if(!seen)continue;
    const last=known.at(-1)[1]-0.001;
    const stored=[...containers.values()].some(c=>!c.ended&&c.last<last)?null:[...containers.values()].filter(c=>c.first<=last&&c.last>last).length;
    hours.push({start:new Date(at*1000).toISOString(),end:new Date(end*1000).toISOString(),observedSeconds:seen,occupiedSeconds:seconds(intersectIntervals(occupied,range)),storedInstances:stored,runningSessions:countIn(range),source:'telemetry',calculationVersion:3});
  }
  const days=[];
  for(let key=dayKey(new Date(start*1000));midnight(key)/1000<limit;key=addDays(key,1)){
    const a=midnight(key)/1000,b=midnight(addDays(key,1))/1000,range=[[Math.max(a,start),Math.min(b,limit)]],seen=seconds(intersectIntervals(observed,range));
    if(seen)days.push({start:new Date(a*1000).toISOString(),end:new Date(b*1000).toISOString(),observedSeconds:seen,occupiedSeconds:seconds(intersectIntervals(occupied,range)),runningSessions:countIn(range),calculationVersion:3});
  }
  return {version:2,aggregationVersion:3,name,source:'telemetry',updatedAt:new Date(now).toISOString(),dataThrough:observed.length?new Date(observed.at(-1)[1]*1000).toISOString():null,hours,days};
}
