import {currentStatus} from './model.js?v=1.3.2';

export function tileState(sample,now=Date.now(),maxAge=900){
  const status=currentStatus(sample,now,maxAge);
  const category=status.maintenance===true?'maintenance':status.maintenance===false?status.listed===true?'listed':status.listed===false?'unlisted':'unknown':'unknown';
  const activity=status.connection==='offline'?'offline':status.connection==='online'?status.running===true?'running':status.running===false?'idle':'unknown':'unknown';
  const matrix={listed:{running:'running',idle:'listed',offline:'offline'},maintenance:{running:'maintenance-running',idle:'maintenance',offline:'maintenance-offline'},unlisted:{running:'unlisted-running',idle:'unlisted',offline:'offline-unlisted'}};
  return {...status,category,activity,state:matrix[category]?.[activity]??'unknown'};
}

// Largest square that fits the viewport, bounded so small/large estates stay usable.
export function tileLayout(count,width,height,{min=22,max=64,gap=5}={}){
  for(let size=max;size>=min;size--){
    const columns=Math.max(1,Math.floor((width+gap)/(size+gap)));
    if(Math.ceil(count/columns)*(size+gap)-gap<=height||size===min)return {size,columns};
  }
}

export function mergeStatus(history,status){
  if(!status||status.identityNamespace!==history.identityNamespace)return history;
  const historical=new Map(history.boxes.map(box=>[box.deviceKey,box]));
  const boxes=status.boxes.map(latest=>{
    const box=historical.get(latest.deviceKey);historical.delete(latest.deviceKey);
    if(!box)return {...latest,months:[],hours:[],days:[],runCounts:[],snapshots:[],historyStart:latest.firstSeenAt};
    const stamp=Date.parse(box.lastSample?.at);
    return !Number.isFinite(stamp)||Date.parse(latest.lastSample?.at)>stamp?{...box,name:latest.name,lastSample:latest.lastSample,discoveryMissing:false}:box;
  });
  // The current feed supplies private ID order. Archive-only devices remain last.
  for(const box of historical.values())boxes.push(Date.parse(status.updatedAt)>Date.parse(history.updatedAt)?{...box,lastSample:null,discoveryMissing:true}:box);
  return {...history,boxes,earnings:status.earnings??null,statusUpdatedAt:status.updatedAt,snapshotMaxAgeSeconds:status.snapshotMaxAgeSeconds};
}
