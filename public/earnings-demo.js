import {billingWindow} from './earnings-model.js?v=1.3.2';
export function demoEarnings(now=Date.now()){
  const day=Math.floor(now/86400000),window=billingWindow(now);
  const daily=Array.from({length:120},(_,i)=>{const computeUsd=18+Math.sin(i*.3)*6,storageUsd=2.1+Math.sin(i*.12)*.3,bandwidthUsd=.4+Math.cos(i*.6)*.2;return {day:new Date((day-119+i)*86400000).toISOString().slice(0,10),computeUsd,storageUsd,bandwidthUsd,totalUsd:computeUsd+storageUsd+bandwidthUsd};});
  const periods=Object.fromEntries(['today','week','month'].map(key=>{const rows=daily.filter(r=>Date.parse(r.day+'T00:00Z')>=window.starts[key]*86400000),sum=field=>rows.reduce((n,r)=>n+r[field],0);return [key,{from:new Date(window.starts[key]*86400000).toISOString(),to:new Date(now).toISOString(),reported:true,computeUsd:sum('computeUsd'),storageUsd:sum('storageUsd'),bandwidthUsd:sum('bandwidthUsd'),totalUsd:sum('totalUsd')}];}));
  const shares=[.5,.3,.2],currentRate={computeUsdPerHour:1.46,storageUsdPerHour:.24,totalUsdPerHour:1.7};
  const machines=['Alpha','Beta','Gamma'].map((name,i)=>({name,deviceKey:'sample-'+i,gpuCount:i===1?2:1,gpuModel:i===2?'RTX 4090':'GB10',daily:daily.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,key==='day'?value:value*shares[i]])))}));
  const currentDevices=machines.map(({name,deviceKey,gpuModel},i)=>({name,deviceKey,gpuModel,rate:Object.fromEntries(Object.entries(currentRate).map(([key,value])=>[key,value*shares[i]]))}));
  return {version:1,report:{version:2,demo:true,updatedAt:new Date(now).toISOString(),from:daily[0].day,to:daily.at(-1).day,lastReportedDay:daily.at(-1).day,timezone:'UTC',daily,machines,periods},currentRate,currentDevices,statusUpdatedAt:new Date(now).toISOString()};
}
