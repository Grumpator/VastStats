import {periodWindow} from './periods.js?v=1.3.2';
import {mergeStatus} from './overview-model.js?v=1.3.2';

export function showingSuspended(){
  try{return globalThis.sessionStorage?.getItem('vaststats.showSuspended')==='1';}catch{return false;}
}
export function fleetURL(url,includeSuspended=showingSuspended()){
  if(!includeSuspended)return url;
  return url+(url.includes('?')?'&':'?')+'includeSuspended=1';
}

export function cachedAPI({fetchImpl=fetch,limit=6}={}){
  const entries=new Map(),pending=new Map();
  return async (url,includeSuspended)=>{
    url=fleetURL(url,includeSuspended);
    if(pending.has(url))return pending.get(url);
    const request=(async()=>{
      const prior=entries.get(url),response=await fetchImpl(url,{cache:'no-store',headers:prior?.etag?{'If-None-Match':prior.etag}:{}});
      if(response.status===304&&prior)return prior.value;
      if(!response.ok)throw Error('Cached API data unavailable');
      const value=await response.json();entries.delete(url);entries.set(url,{value,etag:response.headers?.get('etag')});
      while(entries.size>limit)entries.delete(entries.keys().next().value);
      return value;
    })();pending.set(url,request);
    try{return await request;}finally{pending.delete(url);}
  };
}
const historyAPI=cachedAPI();
export async function loadHistoryWindow(days,{get=historyAPI}={}){
  const sorted=[...days].sort();
  const value=await get('/api/history?'+new URLSearchParams({from:sorted[0],to:sorted.at(-1)}));
  if(value.version!==2||!Array.isArray(value.boxes)||value.boxes.some(b=>!Array.isArray(b.hours)||!Array.isArray(b.snapshots)))throw Error('Invalid history response');
  return value;
}
export function detailsClient({fetchImpl=fetch,now=Date.now,limit=24}={}){
  const get=cachedAPI({fetchImpl,limit}),entries=new Map(),pending=new Map();let latest=null;
  let latestScope,refreshGeneration=0;
  async function refresh(scope=showingSuspended()){
    const generation=++refreshGeneration;
    const status=await get('/api/status',scope);
    if(generation===refreshGeneration){latest=status;latestScope=scope;}
    return status;
  }
  return {refresh,
    async load(period,reference=null,{refreshStatus=false}={}){
      const scope=showingSuspended();
      const status=!latest||refreshStatus||scope!==latestScope?await refresh(scope):latest;
      const time=now(),window=periodWindow(period,Math.min(reference??time,time));
      const revision=status.historyRevision,key=scope+':'+revision+':'+period+':'+window.start;
      let value=entries.get(key);
      if(!value){
        if(!pending.has(key)){
          const request=(async()=>{
            const response=await get('/api/details?'+new URLSearchParams({period,at:String(reference??time)}),scope);
            if(response.version!==2||response.representation!=='summaries'||!Array.isArray(response.boxes)||response.boxes.some(box=>!Array.isArray(box.summaries)))throw Error('Invalid details summary');
            // An import may finish between the status and details requests.
            const actualKey=scope+':'+response.revision+':'+period+':'+window.start;
            entries.set(actualKey,response);while(entries.size>limit)entries.delete(entries.keys().next().value);
            if(latest===status)latest={...status,historyRevision:response.revision};
            return response;
          })();pending.set(key,request);
          request.finally(()=>pending.delete(key)).catch(()=>{});
        }
        value=await pending.get(key);
      }else{entries.delete(key);entries.set(key,value);}
      return {...mergeStatus(value,status),collection:status.collection};
    }
  };
}
export function collectionNotice(data){
  const health=data.collection;
  if(!health)return '';
  if(!health.configured)return 'Collection is not configured. Set VAST_API_KEY to start.';
  const messages=[];
  if(health.status.failed)messages.push('The latest status check failed; last known states are retained.');
  if(health.history.failed)messages.push('Couldn’t refresh Occupancy from Vast. Showing saved history until the next successful refresh.');
  else if(health.history.partial)messages.push('Some device history could not be refreshed; saved history is retained.');
  return messages.join(' ');
}
