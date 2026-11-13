import {cachedAPI,fleetURL} from './api.js?v=1.3.2';
export function statusSource({fetchImpl=fetch,now=Date.now,endpoint='/api/status'}={}){
  const get=cachedAPI({fetchImpl});
  const scopes=new Map();
  return async({force=false}={})=>{
    const key=fleetURL(endpoint);
    if(!scopes.has(key))scopes.set(key,{cached:null,pending:null,checked:-Infinity});
    const state=scopes.get(key);
    if(state.pending)return state.pending;
    if(!force&&now()-state.checked<30000)return state.cached;
    state.checked=now();
    state.pending=(async()=>{
      try{
        const value=await get(endpoint);
        if(value.version!==1||!Array.isArray(value.boxes)||((value.boxes.length>0||value.updatedAt!=null)&&!Number.isFinite(Date.parse(value.updatedAt)))||value.boxes.some(b=>typeof b.name!=='string'||!/^device-[a-f0-9]{32}$/.test(b.deviceKey)))throw Error('Invalid status');
        state.cached=value;
      }catch{/* Preserve the actual last timestamp on failure. */}
      return state.cached;
    })();
    try{return await state.pending;}finally{state.pending=null;}
  };
}
