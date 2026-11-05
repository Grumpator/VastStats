import path from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {HistoryApi} from '../scripts/history-api.mjs';
import {collectStatus} from '../scripts/collect-status.mjs';
import {collectHistory} from '../scripts/collect-history.mjs';
import {DataStore,atomicJson,folderURL} from './store.mjs';
import {ScheduledJob} from './scheduler.mjs';

export async function createRuntime({config,now=Date.now,timers=globalThis,statusCollector=collectStatus,historyCollector=collectHistory,apiFactory}={}){
  const abort=new AbortController();apiFactory??=()=>new HistoryApi(config.key,{signal:abort.signal});
  const store=await new DataStore(config.dataDir).open();
  const index=await store.index();
  let cachedFleet=null,fleetTime=-Infinity,fleetPending=null,stopping=false,historyUpdatedAt=index.updatedAt??null;
  const machines=async(force=false)=>{
    if(fleetPending)return fleetPending;
    if(!force&&cachedFleet&&now()-fleetTime<240000)return cachedFleet;
    fleetPending=(async()=>{const raw=await apiFactory().machines();cachedFleet=raw;fleetTime=now();return raw;})();
    try{return await fleetPending;}finally{fleetPending=null;}
  };
  const statusTask=async()=>{
    const work=path.join(store.root,'status-stage-'+randomUUID());await mkdir(work,{recursive:true});
    try{
      await atomicJson(path.join(work,'index.json'),await store.index());
      if(store.status)await atomicJson(path.join(work,'status.json'),store.status);
      const result=await statusCollector({api:{machines:()=>machines(true),contracts:id=>apiFactory().contracts(id)},root:folderURL(work),now:now(),identitySeed:store.identitySeed});
      await store.publishStatus(result);
    }finally{await rm(work,{recursive:true,force:true});}
  };
  const historyTask=async()=>{
    const stage=await store.stage();
    try{
      const old=await store.index(),wide=!old.wideReconciledAt||now()-Date.parse(old.wideReconciledAt)>=86400000;
      const api=apiFactory();api.machines=()=>machines();
      const collected=await historyCollector({api,root:folderURL(stage),now:now(),identitySeed:store.identitySeed,overlapSeconds:(wide?72:6)*3600,rebuild:false});
      const result={...collected,wideReconciledAt:wide?new Date(now()).toISOString():old.wideReconciledAt};
      // The machine snapshot cadence comes from the independent status feed.
      await atomicJson(path.join(stage,'index.json'),result);await store.publish(stage);historyUpdatedAt=result.updatedAt??null;
      return {partial:result.boxes.some(b=>b.historyError)};
    }finally{await rm(stage,{recursive:true,force:true});}
  };
  const statusJob=new ScheduledJob({interval:config.statusInterval,task:statusTask,now,timers}),historyJob=new ScheduledJob({interval:config.historyInterval,task:historyTask,now,timers});
  const health=()=>({ok:true,version:config.version??null,release:config.release??null,configured:!!config.key,mode:config.key?'collecting':'cache-only',status:{...statusJob.state,updatedAt:store.status?.updatedAt??null},history:{...historyJob.state,updatedAt:historyUpdatedAt}});
  let startup=null;
  return {store,statusJob,historyJob,health,
    start(){if(startup||!config.key)return startup;startup=(async()=>{statusJob.start();await statusJob.run();if(stopping)return;historyJob.start();await historyJob.run();})();return startup;},
    async close(){stopping=true;abort.abort();await Promise.all([statusJob.stop(),historyJob.stop()]);await startup;await store.close();cachedFleet=null;}
  };
}
