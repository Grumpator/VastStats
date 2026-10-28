import {periodDays} from './model.js?v=2.0.2';
export async function loadHistoryData(base,selected,view,{fetchImpl=fetch}={}){
  const get=async path=>{const response=await fetchImpl(new URL(path,base),{cache:'no-store'});if(!response.ok)throw Error('History summary unavailable');return response.json();};
  const index=await get('index.json');
  if(index.version!==2||!Array.isArray(index.boxes))throw Error('Unsupported history index');
  const months=new Set(periodDays(selected,view).map(d=>d.slice(0,7)));
  const boxes=await Promise.all(index.boxes.map(async entry=>{
    if(!/^[A-Za-z][A-Za-z0-9 _-]{0,23}$/.test(entry.name)||!Array.isArray(entry.months)||entry.months.some(m=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)))throw Error('Invalid public history index');
    const files=await Promise.all(entry.months.filter(m=>months.has(m)).map(async month=>{
      const file=await get(encodeURIComponent(entry.name)+'/'+month+'.json');
      if(file.version!==2||file.name!==entry.name||file.month!==month||!Array.isArray(file.hours)||!Array.isArray(file.snapshots))throw Error('Invalid public month summary');
      return file;
    }));
    return {...entry,hours:files.flatMap(f=>f.hours),snapshots:files.flatMap(f=>f.snapshots)};
  }));
  return {...index,boxes};
}

export function applySnapshots(value,box,bin,now=Date.now(),maxAgeSeconds=5400){
  const snapshots=(box.snapshots||[]).filter(s=>Date.parse(s.at)>=bin.start&&Date.parse(s.at)<bin.end);
  const latest=box.lastSample,stamp=Date.parse(latest?.at),isNow=bin.start<=now&&now<bin.end;
  const current=isNow&&stamp>=bin.start&&stamp<bin.end&&now-stamp>=0&&now-stamp<=maxAgeSeconds*1000?latest:null;
  const observed=[...snapshots,...(current?[{...current,maintenance:current.maintenanceWindows?.some(w=>Date.parse(w.start)<=stamp&&stamp<Date.parse(w.end))??null}]:[])];
  const state=observed.some(s=>s.connection==='offline')?'offline':observed.some(s=>s.maintenance)?'maintenance':observed.some(s=>s.listed===false)?'unlisted':observed.some(s=>s.listed===true)?'listed':value.borderState;
  return {...value,borderState:state,stored:current?.storedInstances??value.stored,isNow,snapshotAt:current?.at??snapshots.at(-1)?.at??null,currentSnapshot:current};
}
