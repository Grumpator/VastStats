import {cachedAPI} from './api.js?v=1.1.0';
export function statusSource({fetchImpl=fetch,now=Date.now,endpoint='/api/status'}={}){
  const get=cachedAPI({fetchImpl});
  let cached=null,pending=null,checked=-Infinity;
  return async({force=false}={})=>{
    if(pending)return pending;
    if(!force&&now()-checked<30000)return cached;
    checked=now();
    pending=(async()=>{
      try{
        const value=await get(endpoint);
        if(value.version!==1||!Array.isArray(value.boxes)||((value.boxes.length>0||value.updatedAt!=null)&&!Number.isFinite(Date.parse(value.updatedAt)))||value.boxes.some(b=>typeof b.name!=='string'||!/^device-[a-f0-9]{32}$/.test(b.deviceKey)))throw Error('Invalid status');
        cached=value;
      }catch{/* Preserve the actual last timestamp on failure. */}
      return cached;
    })();
    try{return await pending;}finally{pending=null;}
  };
}
