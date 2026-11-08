import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ScheduledJob} from '../server/scheduler.mjs';
import {DataStore,atomicJson} from '../server/store.mjs';
import {createRuntime} from '../server/runtime.mjs';
import {createServer,dateWindow} from '../server/app.mjs';
import {readConfig} from '../server/config.mjs';
import {identityNamespace,discoverMachines} from '../scripts/history-discovery.mjs';
import {cachedAPI,loadHistoryWindow} from '../public/api.js';

const seedSecret='a'.repeat(64),namespace=identityNamespace(seedSecret);
const now=Date.parse('2026-11-04T12:00Z'),stamp=new Date(now).toISOString();
const key=discoverMachines({machines:[{id:123,hostname:'Box'}]},{seed:seedSecret})[0].deviceKey;
const sample={at:stamp,connection:'online',listed:true,running:true,runningInstances:1,storedInstances:2,gpuCount:1,allocatedStorageGb:20,maintenanceWindows:[],reliability:.99,verification:'verified'};
const box={name:'Box',deviceKey:key,storageKey:'Box',months:['2026-11'],historyStart:'2026-11-01T00:00:00Z',lastSample:sample};
const index={version:2,identityNamespace:namespace,updatedAt:stamp,boxes:[box]};
const status={version:1,identityNamespace:namespace,source:'machines',updatedAt:stamp,snapshotMaxAgeSeconds:900,boxes:[{...box,firstSeenAt:box.historyStart}]};
const hour={start:'2026-11-04T11:00:00Z',end:stamp,observedSeconds:3600,occupiedSeconds:3600,runningSessions:1};
const month={version:2,aggregationVersion:5,name:'Box',month:'2026-11',hours:[hour],days:[],runCounts:[],snapshots:[]};
async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'vaststats-node-')),seed=path.join(root,'seed'),dataDir=path.join(root,'data');
  await atomicJson(path.join(seed,'index.json'),{version:2,boxes:[{name:'Do not import'}]});
  await atomicJson(path.join(dataDir,'identity.json'),{version:1,secret:seedSecret});
  const store=await new DataStore(dataDir).open(),stage=await store.stage();
  await atomicJson(path.join(stage,'index.json'),index);await atomicJson(path.join(stage,'Box','2026-11.json'),month);
  await store.publish(stage);await store.publishStatus(status);await store.close();
  return {root,seed,dataDir,clean:()=>rm(root,{recursive:true,force:true})};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fakeClock(){
  let time=now,id=0;const tasks=new Map();
  return {now:()=>time,timers:{setTimeout:(fn,delay)=>{tasks.set(++id,{fn,at:time+delay});return id;},clearTimeout:id=>tasks.delete(id)},
    async advance(ms){time+=ms;const due=[...tasks].filter(([,job])=>job.at<=time);for(const [id,job] of due){tasks.delete(id);job.fn();}await Promise.resolve();await Promise.resolve();},tasks};
}
test('five-minute and thirty-minute jobs run independently, coalesce missed ticks and never overlap themselves',async()=>{
  const clock=fakeClock(),gate=deferred();let quick=0,slow=0;
  const statusJob=new ScheduledJob({...clock,interval:300000,task:async()=>{quick++;}}),historyJob=new ScheduledJob({...clock,interval:1800000,task:async()=>{slow++;await gate.promise;}});
  statusJob.start();historyJob.start();await statusJob.run();const first=historyJob.run();
  await clock.advance(300000);assert.equal(quick,2);assert.equal(slow,1);
  await clock.advance(1800000);assert.equal(slow,1);assert.equal(quick,3);
  gate.resolve();await first;await clock.advance(1800000);assert.equal(slow,2);
  await Promise.all([statusJob.stop(),historyJob.stop()]);await clock.advance(3600000);assert.equal(quick,4);assert.equal(clock.tasks.size,0);
});
test('job failures preserve last success and recover without leaking error messages',async()=>{
  const clock=fakeClock();let fail=false;
  const job=new ScheduledJob({...clock,interval:300000,task:async()=>{if(fail)throw Error('SECRET');}});
  await job.run();const success=job.state.lastSuccess;fail=true;await clock.advance(300000);await job.run();
  assert.equal(job.state.lastSuccess,success);assert.equal(job.state.failed,true);assert.equal(JSON.stringify(job.state).includes('SECRET'),false);
  fail=false;await job.run();assert.equal(job.state.failed,false);await job.stop();
});
test('storage persists across restarts, archives status and rejects a second writer',async()=>{
  const f=await fixture();let store;
  try{
    store=await new DataStore(f.dataDir).open();
    await assert.rejects(new DataStore(f.dataDir).open(),/already using/);
    const newer={...status,updatedAt:new Date(now+300000).toISOString(),boxes:[{...status.boxes[0],lastSample:{...sample,at:new Date(now+300000).toISOString(),listed:false}}]};
    await store.publishStatus(newer);let history=await store.history('2026-11-04','2026-11-04');
    assert.equal(history.boxes[0].snapshots.length,2);assert.equal(history.boxes[0].snapshots.at(-1).listed,false);assert.equal(history.boxes[0].hours[0].occupiedSeconds,3600);
    await store.close();store=null;
    await atomicJson(path.join(f.seed,'index.json'),{version:2,boxes:[]});
    store=await new DataStore(f.dataDir).open();assert.equal(store.status.updatedAt,newer.updatedAt);assert.equal((await store.index()).boxes.length,1);
    history=await store.history('2026-11-03','2026-11-03');assert.equal(history.boxes[0].hours.length,0);assert.equal(history.boxes[0].snapshots.length,0);
  }finally{await store?.close();await f.clean();}
});
test('staged history is invisible until valid publication and cannot overwrite status observations',async()=>{
  const f=await fixture();let store;
  try{
    store=await new DataStore(f.dataDir).open();const stage=await store.stage();
    await atomicJson(path.join(stage,'Box','2026-11.json'),{...month,hours:[{...hour,occupiedSeconds:1800}]});
    assert.equal((await store.history('2026-11-04','2026-11-04')).boxes[0].hours[0].occupiedSeconds,3600);
    await store.publishStatus({...status,updatedAt:new Date(now+300000).toISOString(),boxes:[{...status.boxes[0],lastSample:{...sample,at:new Date(now+300000).toISOString(),connection:'offline'}}]});
    await store.publish(stage);
    const history=await store.history('2026-11-04','2026-11-04');assert.equal(history.boxes[0].hours[0].occupiedSeconds,1800);assert.equal(history.boxes[0].snapshots.at(-1).connection,'offline');
    const bad=await store.stage();await atomicJson(path.join(bad,'Box','2026-11.json'),{...month,name:'wrong'});
    await assert.rejects(store.publish(bad),/Invalid history month/);assert.equal((await store.history('2026-11-04','2026-11-04')).boxes[0].hours[0].occupiedSeconds,1800);
  }finally{await store?.close();await f.clean();}
});
test('runtime startup reads machines once, shares the fleet with history and retains caches after failures',async()=>{
  const f=await fixture(),clock=fakeClock();let runtime,calls=0,historyCalls=0,fail=false;
  const config={...readConfig({DATA_DIR:f.dataDir}),key:'PRIVATE_KEY'};
  try{
    runtime=await createRuntime({config,...clock,apiFactory:()=>({machines:async()=>{calls++;if(fail)throw Error('RAW_PRIVATE_ERROR');return {machines:[{id:123,hostname:'Box',timeout:0,listed:true,current_rentals_running:1,current_rentals_resident:2,num_gpus:1,alloc_disk_space:20,machine_maintenance:[],ip:'PRIVATE_IP'}]};}}),
      historyCollector:async({api,root,overlapSeconds})=>{historyCalls++;await api.machines();assert.equal(overlapSeconds,72*3600);return {...index,updatedAt:new Date(clock.now()).toISOString()};}});
    await runtime.start();assert.equal(calls,1);assert.equal(historyCalls,1);assert.equal(runtime.health().status.failed,false);
    const old=runtime.store.status.updatedAt;fail=true;await clock.advance(300000);await runtime.statusJob.pending;assert.equal(runtime.store.status.updatedAt,old);assert.equal(runtime.health().status.failed,true);
    assert.equal(JSON.stringify(runtime.health()).includes('PRIVATE'),false);
  }finally{await runtime?.close();await f.clean();}
});
test('unconfigured runtime serves its own saved data without collection, and damaged identities fail safely',async()=>{
  const f=await fixture();let runtime;
  try{
    const config=readConfig({DATA_DIR:f.dataDir});runtime=await createRuntime({config,apiFactory:()=>{throw Error('Must not call');}});await runtime.start();assert.equal(runtime.health().mode,'cache-only');await runtime.close();runtime=null;
    await atomicJson(path.join(f.dataDir,'identity.json'),{version:1,secret:'b'.repeat(64)});
    await assert.rejects(createRuntime({config}),/does not match/);
    await atomicJson(path.join(f.dataDir,'identity.json'),{version:1,secret:seedSecret});
    runtime=await createRuntime({config});
  }finally{await runtime?.close();await f.clean();}
});
test('status keeps collecting during a slow history import and shutdown waits for it to settle',async()=>{
  const f=await fixture(),clock=fakeClock(),entered=deferred(),gate=deferred();let runtime,calls=0;
  try{
    runtime=await createRuntime({config:{...readConfig({DATA_DIR:f.dataDir}),key:'test'},...clock,
      apiFactory:()=>({machines:async()=>{calls++;return {machines:[{id:123,hostname:'Box',timeout:0,listed:true,current_rentals_running:1,current_rentals_resident:2,num_gpus:1,machine_maintenance:[]}]};}}),
      historyCollector:async()=>{entered.resolve();await gate.promise;return index;}});
    const start=runtime.start();await entered.promise;
    assert.equal(runtime.historyJob.state.running,true);await clock.advance(300000);await runtime.statusJob.pending;
    assert.equal(calls,2);assert.equal(runtime.store.status.updatedAt,new Date(clock.now()).toISOString());
    gate.resolve();await start;assert.equal((await runtime.store.history('2026-11-04','2026-11-04')).boxes[0].snapshots.length,2);
  }finally{gate.resolve();await runtime?.close();await f.clean();}
});
test('routine history uses a smaller overlap, daily reconciliation persists, and failed staging stays unpublished',async()=>{
  const f=await fixture(),clock=fakeClock();let runtime,fail=false;const overlaps=[];
  try{
    runtime=await createRuntime({config:{...readConfig({DATA_DIR:f.dataDir}),key:'test'},...clock,
      apiFactory:()=>({machines:async()=>({machines:[]})}),historyCollector:async({root,overlapSeconds})=>{
        overlaps.push(overlapSeconds);if(fail){await atomicJson(new URL('index.json',root),{version:2,boxes:[]});throw Error('Private failure');}
        return {...index,updatedAt:new Date(clock.now()).toISOString()};
      }});
    await runtime.start();const generation=runtime.store.generation;
    await runtime.historyJob.run();assert.deepEqual(overlaps,[72*3600,6*3600]);
    const active=runtime.store.generation;fail=true;await runtime.historyJob.run();assert.equal(runtime.store.generation,active);assert.equal((await runtime.store.index()).boxes.length,1);assert.equal(runtime.historyJob.state.failed,true);
    fail=false;await clock.advance(86400000);await runtime.historyJob.pending;assert.equal(overlaps.at(-1),72*3600);
    assert.notEqual(runtime.store.generation,generation);
  }finally{await runtime?.close();await f.clean();}
});
test('read-only API serves bounded coherent history and never exposes disk/config or calls collectors',async()=>{
  const f=await fixture();let runtime,server;
  try{
    runtime=await createRuntime({config:readConfig({DATA_DIR:f.dataDir})});
    server=await createServer({runtime,publicDir:path.resolve('public')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const response=await fetch(base+'/api/status'),body=await response.json();assert.equal(body.boxes.length,1);assert.equal(body.collection.configured,false);
    assert.equal((await fetch(base+'/api/status',{headers:{'If-None-Match':response.headers.get('etag')}})).status,304);
    const devices=await (await fetch(base+'/api/devices')).json();
    assert.equal(devices.privateRates,false);
    assert.ok(devices.boxes[0].occupancy.all);
    assert.equal(devices.boxes[0].workedSeconds,3600);
    const deviceKey=devices.boxes[0].deviceKey;
    runtime.deviceRates=()=>new Map([[deviceKey,{ask:{gpu:.45}}]]);
    runtime.store.earningsReport={updatedAt:'2026-11-05T12:00:00Z',daily:[{day:'2026-11-04'},{day:'2026-11-05'}],machineTotals:{[deviceKey]:18}};
    const localDevices=await (await fetch(base+'/api/devices')).json();
    assert.equal(localDevices.boxes[0].rates.ask.gpu,.45);
    assert.equal(localDevices.boxes[0].earnedUsd,18);
    assert.equal(localDevices.boxes[0].averageUsdPerHour,.5);
    assert.equal(localDevices.earningsWindow.hours,36);
    assert.equal(localDevices.boxes[0].workedSeconds,3600);
    runtime.store.earningsReport={...runtime.store.earningsReport,updatedAt:'2026-11-04T11:30:00Z',daily:[{day:'2026-11-04'}]};
    assert.equal((await (await fetch(base+'/api/devices')).json()).boxes[0].workedSeconds,null);
    const forwardedDevices=await (await fetch(base+'/api/devices',{headers:{'X-Forwarded-Host':'example.com'}})).json();
    assert.equal(forwardedDevices.privateRates,false);
    assert.equal(Object.hasOwn(forwardedDevices.boxes[0],'rates'),false);
    assert.equal(Object.hasOwn(forwardedDevices.boxes[0],'earnedUsd'),false);
    const earnings=await (await fetch(base+'/api/earnings')).json();
    assert.equal(Object.hasOwn(earnings.report,'machineTotals'),false);
    const history=await (await fetch(base+'/api/history?from=2026-11-04&to=2026-11-04')).json();assert.equal(history.boxes[0].hours.length,1);
    for(const route of ['/data/index.json','/.env','/server.mjs','/server/config.mjs','/api/collect','/%2e%2e%2f.env'])assert.equal((await fetch(base+route)).status,404);
    assert.equal((await fetch(base+'/api/status',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/api/history?from=2026-02-30&to=2026-11-04')).status,400);
    assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/details.html')).status,200);assert.equal((await fetch(base+'/healthz')).status,200);
  }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await runtime?.close();await f.clean();}
});
test('API client makes one same-origin history request per window and supports ETag responses',async()=>{
  let calls=0;const urls=[];
  const get=cachedAPI({fetchImpl:async(url,options)=>{urls.push(url);calls++;return calls===1?new Response(JSON.stringify({version:2,boxes:[]}),{headers:{etag:'"test"'}}):new Response(null,{status:options.headers['If-None-Match']==='"test"'?304:500});}});
  const first=await loadHistoryWindow(['2026-11-04','2026-11-03'],{get});assert.equal(await loadHistoryWindow(['2026-11-03','2026-11-04'],{get}),first);
  assert.deepEqual(urls,['/api/history?from=2026-11-03&to=2026-11-04','/api/history?from=2026-11-03&to=2026-11-04']);
});
test('history windows reject invalid dates, reversed ranges and unbounded requests',()=>{
  for(const query of ['','from=2026-11-05&to=2026-11-04','from=2026-02-30&to=2026-03-01','from=2000-01-01&to=2026-11-04'])assert.throws(()=>dateWindow(new URL('http://localhost/?'+query)));
  assert.deepEqual(dateWindow(new URL('http://localhost/?from=2026-10-25&to=2026-10-25')),{from:'2026-10-25',to:'2026-10-25'});
});
