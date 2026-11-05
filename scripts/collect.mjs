const HOUR=3600000;
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
export function sanitizeMachines(raw,mapping,now=Date.now()){
  const rows=Array.isArray(raw)?raw:raw.machines;
  if(!Array.isArray(rows))throw Error('Unexpected machine response');
  return Object.entries(mapping).map(([id,name])=>{
    const row=rows.find(r=>String(r.id)===id);
    const running=row?.current_rentals_running,stored=row?.current_rentals_resident;
    const state=machineState(row,now);
    const validCounts=Number.isInteger(running)&&running>=0&&Number.isInteger(stored)&&stored>=running;
    // Construct an allowlist. Never spread, serialize, or log the API response.
    const allocatedStorageGb=Number.isFinite(row?.alloc_disk_space)&&row.alloc_disk_space>=0?row.alloc_disk_space:null;
    const gpuCount=Number.isInteger(row?.num_gpus)&&row.num_gpus>=0?row.num_gpus:null;
    const reliability=Number.isFinite(row?.reliability2)&&row.reliability2>=0&&row.reliability2<=1?row.reliability2:null;
    const verification=['verified','unverified','deverified'].includes(row?.verification)?row.verification:null;
    return {name,gpuCount,reliability,verification,running:state.connection==='offline'?false:state.connection==='online'&&validCounts?running>0:null,runningInstances:validCounts?running:null,storedInstances:validCounts?stored:null,allocatedStorageGb,...state};
  });
}
