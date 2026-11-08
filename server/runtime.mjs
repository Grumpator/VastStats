import path from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {HistoryApi} from '../scripts/history-api.mjs';
import {collectStatus} from '../scripts/collect-status.mjs';
import {collectHistory} from '../scripts/collect-history.mjs';
import {DataStore,atomicJson,folderURL} from './store.mjs';
import {ScheduledJob} from './scheduler.mjs';
import {collectHistoricalEarnings,machineEarningsTotals} from './earnings.mjs';
import {EarningsSeries} from './earnings-series.mjs';
import {discoverMachines} from '../scripts/history-discovery.mjs';
import {createMarket} from './market.mjs';

export async function createRuntime({config,now=Date.now,timers=globalThis,statusCollector=collectStatus,historyCollector=collectHistory,apiFactory}={}){
  const abort=new AbortController();apiFactory??=()=>new HistoryApi(config.key,{signal:abort.signal});
  const store=await new DataStore(config.dataDir).open();
  const earningsSeries=await new EarningsSeries({root:store.root,apiFactory,now,enabled:!!config.key,signal:abort.signal}).open();
  const index=await store.index();
  let cachedFleet=null,fleetTime=-Infinity,fleetPending=null,stopping=false,historyUpdatedAt=index.updatedAt??null;
  const machines=async(force=false)=>{
    if(fleetPending)return fleetPending;
    if(!force&&cachedFleet&&now()-fleetTime<240000)return cachedFleet;
    fleetPending=(async()=>{const raw=await apiFactory().machines();cachedFleet=raw;fleetTime=now();return raw;})();
    try{return await fleetPending;}finally{fleetPending=null;}
  };
  const market=config.key&&config.marketEnabled
    ?createMarket({api:apiFactory(),machines,status:()=>store.status,seed:store.identitySeed,now})
    :null;
  let rateSnapshot=null;
  const statusTask=async()=>{
    const work=path.join(store.root,'status-stage-'+randomUUID());await mkdir(work,{recursive:true});
    try{
      await atomicJson(path.join(work,'index.json'),await store.index());
      if(store.status)await atomicJson(path.join(work,'status.json'),store.status);
      const rates=config.deviceRatesEnabled?new Map():null;
      const result=await statusCollector({api:{machines:()=>machines(true),contracts:id=>apiFactory().contracts(id)},root:folderURL(work),now:now(),identitySeed:store.identitySeed,
        onDeviceRates:rates?(key,value)=>rates.set(key,value):undefined});
      await store.publishStatus(result);
      if(rates)rateSnapshot={updatedAt:result.updatedAt,rates};
    }finally{await rm(work,{recursive:true,force:true});}
  };
  const historyTask=async()=>{
    let stage,phase='prepare saved history';
    try{
      stage=await store.stage();
      const old=await store.index(),wide=!old.wideReconciledAt||now()-Date.parse(old.wideReconciledAt)>=86400000;
      const api=apiFactory();api.machines=()=>machines();
      phase='fetch and process Vast telemetry';
      const collected=await historyCollector({api,root:folderURL(stage),now:now(),identitySeed:store.identitySeed,overlapSeconds:(wide?72:6)*3600,rebuild:false});
      const result={...collected,wideReconciledAt:wide?new Date(now()).toISOString():old.wideReconciledAt};
      // The machine snapshot cadence comes from the independent status feed.
      phase='publish refreshed history';
      await atomicJson(path.join(stage,'index.json'),result);await store.publish(stage);historyUpdatedAt=result.updatedAt??null;
      return {partial:result.boxes.some(b=>b.historyError)};
    }catch(error){
      if(!stopping){
        const message=error?.message??'',reason=/^Vast request failed \(HTTP \d{3}\)$/.test(message)||['Vast connection failed','Invalid Vast JSON response','No box history could be refreshed','Invalid history index','Invalid history month'].includes(message)?message:'unexpected error';
        console.warn('Occupancy history refresh could not '+phase+': '+reason+'.');
      }
      throw error;
    }finally{if(stage)await rm(stage,{recursive:true,force:true});}
  };
  const statusJob=new ScheduledJob({interval:config.statusInterval,task:statusTask,now,timers}),historyJob=new ScheduledJob({interval:config.historyInterval,task:historyTask,now,timers});
  const earningsJob=new ScheduledJob({interval:1800000,task:async()=>{
    let machineTotals;
    const report=await collectHistoricalEarnings({api:apiFactory(),now:now(),onMachines:async rows=>{
      const raw=await machines(),current=Array.isArray(raw)?raw:raw.machines,all=new Map(current.map(row=>[String(row.id),row]));
      for(const row of rows){const id=String(row.machine_id);if(!/^\d+$/.test(id))throw Error('Invalid earnings device');if(!all.has(id))all.set(id,{id});}
      const previous=[...(await store.index()).boxes,...(store.status?.boxes||[])];
      const devices=discoverMachines({machines:[...all.values()]},{seed:store.identitySeed,previous}).map(d=>({
        ...d,name:d.name.startsWith('Unnamed-')?d.previous?.name??d.name:d.name,
        gpuCount:d.gpuCount??d.previous?.lastSample?.gpuCount??null
      }));
      machineTotals=machineEarningsTotals(rows,devices);
      await earningsSeries.setDevices(devices);return earningsSeries.publicDevices();
    }});await store.publishEarnings({...report,machineTotals});
  },now,timers});
  const health=()=>({ok:true,version:config.version??null,release:config.release??null,configured:!!config.key,mode:config.key?'collecting':'cache-only',status:{...statusJob.state,updatedAt:store.status?.updatedAt??null},history:{...historyJob.state,updatedAt:historyUpdatedAt},earnings:{...earningsJob.state,updatedAt:store.earningsReport?.updatedAt??null}});
  let startup=null;
  return {store,statusJob,historyJob,earningsJob,health,market,
    deviceRates:config.deviceRatesEnabled?(stamp)=>rateSnapshot?.updatedAt===stamp?rateSnapshot.rates:null:null,
    machineEarnings:(keys,range,group)=>earningsSeries.selected(keys,range,group),
    start(){if(startup||!config.key)return startup;startup=(async()=>{statusJob.start();await statusJob.run();if(stopping)return;historyJob.start();earningsJob.start();await Promise.all([historyJob.run(),earningsJob.run()]);})();return startup;},
    async close(){stopping=true;abort.abort();await Promise.all([statusJob.stop(),historyJob.stop(),earningsJob.stop(),earningsSeries.close(),market?.close()]);await startup;await store.close();cachedFleet=null;}
  };
}
