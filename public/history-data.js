import {periodDays} from './model.js?v=2.6.1';
export function githubDataSource({fetchImpl=fetch,now=Date.now}={}){
  let base=null,checked=-Infinity,pending=null;
  return async()=>{
    if(pending)return pending;
    // One public ref lookup per five minutes, then immutable files from that commit.
    if(now()-checked<300000){if(base)return base;throw Error('Repository version unavailable');}
    checked=now();
    pending=(async()=>{try{
      const response=await fetchImpl('https://api.github.com/repos/Grumpator/VastStats/git/ref/heads/main',{cache:'no-store'});
      if(!response.ok)throw Error('Repository version unavailable');
      const ref=await response.json(),sha=ref.object?.sha;
      if(ref.object?.type!=='commit'||! /^[a-f0-9]{40}$/.test(sha))throw Error('Invalid repository version');
      base=new URL('https://raw.githubusercontent.com/Grumpator/VastStats/'+sha+'/public/data/');
    }catch(error){if(!base)throw error;}
    return base;})();
    try{return await pending;}finally{pending=null;}
  };
}
export async function loadHistoryData(base,selected,view,{fetchImpl=fetch,days=periodDays(selected,view)}={}){
  const get=async path=>{const response=await fetchImpl(new URL(path,base),{cache:'no-store'});if(!response.ok)throw Error('History summary unavailable');return response.json();};
  const index=await get('index.json');
  if(index.version!==2||!Array.isArray(index.boxes))throw Error('Unsupported history index');
  const months=new Set(days.map(d=>d.slice(0,7)));
  const boxes=await Promise.all(index.boxes.map(async entry=>{
    if(!/^[A-Za-z][A-Za-z0-9 _-]{0,23}$/.test(entry.name)||!Array.isArray(entry.months)||entry.months.some(m=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)))throw Error('Invalid public history index');
    const files=await Promise.all(entry.months.filter(m=>months.has(m)).map(async month=>{
      const file=await get(encodeURIComponent(entry.name)+'/'+month+'.json');
      if(file.version!==2||file.name!==entry.name||file.month!==month||!Array.isArray(file.hours)||!Array.isArray(file.snapshots))throw Error('Invalid public month summary');
      return file;
    }));
    return {...entry,hours:files.flatMap(f=>f.hours),days:files.flatMap(f=>f.days||[]),runCounts:files.flatMap(f=>f.runCounts||[]),snapshots:files.flatMap(f=>f.snapshots)};
  }));
  return {...index,boxes};
}

export function periodRunCount(box,bin){
  if(bin.end-bin.start>25*3600000){
    const rows=box.runCounts?.filter(r=>Date.parse(r.start)>=bin.start&&Date.parse(r.start)<bin.end).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
    const observed=box.hours.filter(r=>r.observedSeconds>0&&Date.parse(r.start)<bin.end&&Date.parse(r.end)>bin.start),starts=new Set(rows?.map(r=>r.start));
    if(!rows?.length||!observed.length||observed.some(r=>!starts.has(r.start))||rows.some(r=>!Number.isInteger(r.runStarts)||!Number.isInteger(r.runningAtStart)))return null;
    // The first available hour also accounts for runs carried into a partial history window.
    return rows[0].runningAtStart+rows.reduce((sum,r)=>sum+r.runStarts,0);
  }
  const rows=bin.end-bin.start>3600000?box.days:box.hours;
  const row=rows?.find(r=>Date.parse(r.start)===bin.start);
  return row?.observedSeconds>0&&Number.isInteger(row.runningSessions)&&row.runningSessions>=0?row.runningSessions:null;
}

export function applySnapshots(value,box,bin,now=Date.now(),maxAgeSeconds=5400){
  const snapshots=(box.snapshots||[]).filter(s=>Date.parse(s.at)>=bin.start&&Date.parse(s.at)<bin.end);
  const latest=box.lastSample,stamp=Date.parse(latest?.at),isNow=bin.start<=now&&now<bin.end;
  const current=isNow&&stamp>=bin.start&&stamp<bin.end&&now-stamp>=0&&now-stamp<=maxAgeSeconds*1000?latest:null;
  const observed=[...snapshots,...(current?[{...current,maintenance:current.maintenanceWindows?.some(w=>Date.parse(w.start)<=stamp&&stamp<Date.parse(w.end))??null}]:[])];
  const state=observed.some(s=>s.connection==='offline')?'offline':observed.some(s=>s.maintenance)?'maintenance':observed.some(s=>s.listed===false)?'unlisted':observed.some(s=>s.listed===true)?'listed':value.borderState;
  return {...value,borderState:state,stored:current?.storedInstances??value.stored,isNow,snapshotAt:current?.at??snapshots.at(-1)?.at??null,currentSnapshot:current};
}
