import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {atomicJson,readJson} from './store.mjs';
import {dailyEarnings,earningsRange} from './earnings.mjs';
import {chartDays,gpuGroups,reportedDayHours} from '../public/earnings-chart-model.js';
const DAY=86400000,valid=n=>typeof n==='number'&&Number.isFinite(n);
export function machineDay(raw,day,devices,now=Date.now()){
  const start=Date.parse(day+'T00:00Z'),range={start,end:start+DAY};
  const fleet=dailyEarnings(raw,range);if(!Array.isArray(raw.per_machine))throw Error('Missing device breakdown');
  const byId=new Map(devices.map(d=>[String(d.id),d.deviceKey])),seen=new Set(),byDevice={};
  const totals={gpu_earn:0,sto_earn:0,bwu_earn:0,bwd_earn:0};
  for(const row of raw.per_machine){
    const id=String(row.machine_id);if(!/^\d+$/.test(id)||seen.has(id)||!Object.keys(totals).every(k=>valid(row[k])))throw Error('Invalid device breakdown');seen.add(id);
    for(const field of Object.keys(totals))totals[field]+=row[field];
    const key=byId.get(id);if(key){const computeUsd=row.gpu_earn,storageUsd=row.sto_earn,bandwidthUsd=row.bwu_earn+row.bwd_earn;byDevice[key]={day,computeUsd,storageUsd,bandwidthUsd,totalUsd:computeUsd+storageUsd+bandwidthUsd};}
  }
  for(const [field,total] of [['gpu_earn','total_gpu'],['sto_earn','total_stor'],['bwu_earn','total_bwu'],['bwd_earn','total_bwd']])if(Math.abs(totals[field]-raw.summary[total])>Math.max(.03,seen.size*.011))throw Error('Incomplete device breakdown');
  return {version:3,day,updatedAt:new Date(now).toISOString(),reported:fleet.length>0,byDevice};
}
export class EarningsSeries {
  constructor({root,apiFactory,now=Date.now,signal,enabled=true,wait=ms=>pause(ms,undefined,{signal})}){Object.assign(this,{root:path.join(root,'earnings-series'),apiFactory,now,signal,enabled,wait});this.devices=new Map();this.cache=new Map();this.pending=new Map();this.failures=new Map();this.chain=Promise.resolve();this.lastRequest=-Infinity;this.closed=false;}
  async open(){const saved=await readJson(path.join(this.root,'registry.json'));if(saved?.version===1)for(const d of saved.devices||[])if(/^device-[a-f0-9]{32}$/.test(d.deviceKey)&&/^\d+$/.test(d.id))this.devices.set(d.deviceKey,d);return this;}
  async setDevices(devices){this.devices=new Map(devices.map(d=>[d.deviceKey,{id:String(d.id),deviceKey:d.deviceKey,name:d.name,gpuModel:d.gpuModel??this.devices.get(d.deviceKey)?.gpuModel??null}]));await atomicJson(path.join(this.root,'registry.json'),{version:1,devices:[...this.devices.values()]});}
  publicDevices(){return [...this.devices.values()].map(({deviceKey,name,gpuModel})=>({deviceKey,name,gpuModel:gpuModel??null}));}
  fresh(value){const age=Math.floor(this.now()/DAY)-Date.parse(value.day+'T00:00Z')/DAY,ttl=age===0?1800000:age<=3?6*3600000:7*DAY;return this.now()-Date.parse(value.updatedAt)<ttl;}
  schedule(day){
    if(!this.enabled||this.closed||this.pending.has(day)||this.now()-(this.failures.get(day)??-Infinity)<300000)return;
    const request=this.chain.then(async()=>{
      if(this.closed||this.signal?.aborted)return;
      const delay=2500-(this.now()-this.lastRequest);if(delay>0)await this.wait(delay);this.lastRequest=this.now();
      try{const start=Date.parse(day+'T00:00Z'),raw=await this.apiFactory().earnings(start,start+DAY),value=machineDay(raw,day,[...this.devices.values()],this.now());await atomicJson(path.join(this.root,'day-'+day+'.json'),value);this.cache.set(day,value);this.failures.delete(day);}catch{this.failures.set(day,this.now());}
    });this.pending.set(day,request);this.chain=request.catch(()=>{});request.finally(()=>this.pending.delete(day)).catch(()=>{});
  }
  async selected(keys,range,group='machine'){
    if(!['machine','gpu'].includes(group))throw Error('Invalid grouping');
    const devices=this.publicDevices(),groups=group==='gpu'?gpuGroups(devices):devices.map(device=>({...device,members:[device]}));
    const byKey=new Map(groups.map(item=>[item.deviceKey,item]));
    if(!Array.isArray(keys)||keys.length>8||new Set(keys).size!==keys.length||keys.some(key=>!byKey.has(key)))throw Error('Select up to eight known series');
    const bounds=earningsRange(this.now()),validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T00:00Z'))&&new Date(v+'T00:00Z').toISOString().slice(0,10)===v;
    if(!range||!validDate(range.from)||!validDate(range.to)||range.from>range.to||Date.parse(range.from+'T00:00Z')<bounds.start||Date.parse(range.to+'T00:00Z')>=bounds.end)throw Error('Invalid daily range');
    const days=chartDays(range);
    await Promise.all(days.map(async day=>{if(!this.cache.has(day)){const value=await readJson(path.join(this.root,'day-'+day+'.json'));if(value?.version===3&&value.day===day)this.cache.set(day,value);}}));
    const stale=days.some(day=>this.cache.has(day)&&!this.fresh(this.cache.get(day)));
    if(groups.length)for(const day of [...days].reverse())if(!this.cache.has(day)||!this.fresh(this.cache.get(day)))this.schedule(day);
    const loaded=days.filter(day=>this.cache.has(day)),pending=days.filter(day=>this.pending.has(day)).length,failed=days.filter(day=>this.failures.has(day)||(!this.enabled&&!this.cache.has(day))).length;
    const selected=new Set(keys),totals={},hours={},series=[],updatedAt=loaded.length?loaded.map(day=>this.cache.get(day).updatedAt).sort()[0]:null;
    for(const {deviceKey,name,members} of groups){
      let total=null,reportedHours=0;const daily=[];
      for(const day of loaded){
        const value=this.cache.get(day);if(!value.reported)continue;
        let amount=null;
        for(const device of members){const row=value.byDevice[device.deviceKey];if(row)amount=(amount??0)+row.totalUsd;}
        if(amount===null)continue;
        total=(total??0)+amount;
        reportedHours+=reportedDayHours(day,value.updatedAt);
        if(selected.has(deviceKey))daily.push({day,totalUsd:amount});
      }
      totals[deviceKey]=total;
      hours[deviceKey]=reportedHours;
      if(selected.has(deviceKey))series.push({deviceKey,name,daily,updatedAt,stale});
    }
    return {version:3,series,totals,hours,pending:pending>0,progress:{loaded:loaded.length,total:days.length,pending,failed}};
  }
  async close(){this.closed=true;await this.chain;}
}
