export function cachedAPI({fetchImpl=fetch,limit=6}={}){
  const entries=new Map(),pending=new Map();
  return async url=>{
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
export function collectionNotice(data){
  const health=data.collection;
  if(!health)return '';
  if(!health.configured)return 'Collection is not configured. Set VAST_API_KEY to start.';
  const messages=[];
  if(health.status.failed)messages.push('The latest status check failed; last known states are retained.');
  if(health.history.failed)messages.push('The latest history import failed; saved history is retained.');
  else if(health.history.partial)messages.push('Some device history could not be refreshed; saved history is retained.');
  return messages.join(' ');
}
