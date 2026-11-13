import {billingWindow} from '../public/earnings-model.js';
export {billingWindow} from '../public/earnings-model.js';
const DAY=86400000,valid=n=>typeof n==='number'&&Number.isFinite(n);
export function earningsRange(now=Date.now()){return {start:(Math.floor(now/DAY)-365)*DAY,end:(Math.floor(now/DAY)+1)*DAY};}
export function dailyEarnings(raw,range){
  const start=range.start/DAY,end=range.end/DAY;
  if(!raw||raw.success===false||!Array.isArray(raw.per_day)||!raw.summary||raw.sday!==start||raw.eday!==end-1)throw Error('Invalid earnings report');
  const seen=new Set(),days=[];
  for(const row of raw.per_day){
    if(!Number.isInteger(row.day)||row.day<start||row.day>=end||seen.has(row.day)||!['gpu_earn','sto_earn','bwu_earn','bwd_earn'].every(k=>valid(row[k])))throw Error('Invalid daily earnings');
    seen.add(row.day);const computeUsd=row.gpu_earn,storageUsd=row.sto_earn,bandwidthUsd=row.bwu_earn+row.bwd_earn;
    days.push({day:new Date(row.day*DAY).toISOString().slice(0,10),computeUsd,storageUsd,bandwidthUsd,totalUsd:computeUsd+storageUsd+bandwidthUsd});
  }
  for(const [fields,key] of [[['total_gpu'],'computeUsd'],[['total_stor'],'storageUsd'],[['total_bwu','total_bwd'],'bandwidthUsd']]){
    if(!fields.every(k=>valid(raw.summary[k]))||Math.abs(days.reduce((n,row)=>n+row[key],0)-fields.reduce((n,k)=>n+raw.summary[k],0))>Math.max(.03,days.length*.011))throw Error('Incomplete earnings report');
  }
  return days.sort((a,b)=>a.day.localeCompare(b.day));
}
export function earningsPeriods(daily,now){
  const window=billingWindow(now);
  return Object.fromEntries(Object.entries(window.starts).map(([key,first])=>{
    const last=key==='yesterday'?first+1:window.end/DAY,rows=daily.filter(row=>Date.parse(row.day+'T00:00Z')/DAY>=first&&Date.parse(row.day+'T00:00Z')/DAY<last);
    const computeUsd=rows.reduce((n,row)=>n+row.computeUsd,0),storageUsd=rows.reduce((n,row)=>n+row.storageUsd,0),bandwidthUsd=rows.reduce((n,row)=>n+row.bandwidthUsd,0);
    return [key,{from:new Date(first*DAY).toISOString(),to:new Date(Math.min(last*DAY,now)).toISOString(),reported:rows.length>0,computeUsd,storageUsd,bandwidthUsd,totalUsd:computeUsd+storageUsd+bandwidthUsd}];
  }));
}
export function earningsReport(raw,now=Date.now(),range=billingWindow(now)){
  const daily=dailyEarnings(raw,range),periods=earningsPeriods(daily,now);
  return {version:2,source:'vast-daily-earnings',currency:'USD',timezone:'UTC',updatedAt:new Date(now).toISOString(),from:new Date(range.start).toISOString().slice(0,10),to:new Date(range.end-DAY).toISOString().slice(0,10),lastReportedDay:daily.at(-1)?.day??null,daily,periods};
}
export function machineEarningsTotals(rows,devices){
  const keys=new Map(devices.map(device=>[String(device.id),device.deviceKey]));
  const totals={},seen=new Set();
  for(const row of rows){
    const key=keys.get(String(row.machine_id));
    if(!key)continue;
    if(seen.has(key)){delete totals[key];continue;}
    seen.add(key);
    const amounts=[row.gpu_earn,row.sto_earn,row.bwu_earn,row.bwd_earn];
    if(amounts.every(valid))totals[key]=amounts.reduce((sum,value)=>sum+value,0);
  }
  return totals;
}
export async function collectHistoricalEarnings({api,now=Date.now(),onMachines}={}){
  const range=earningsRange(now),raw=await api.earnings(range.start,range.end),report=earningsReport(raw,now,range);
  if(onMachines)report.machines=await onMachines(raw.per_machine||[]);
  return report;
}
