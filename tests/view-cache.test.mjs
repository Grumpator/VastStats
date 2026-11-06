import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,rename,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DataStore,atomicJson} from '../server/store.mjs';
import {createServer} from '../server/app.mjs';
import {aggregate,midnight} from '../public/model.js';
import {periodWindow} from '../public/periods.js';
import {periodRunCount,applySnapshots} from '../public/history-data.js';
import {combineSummaries,summaryValue,compactSnapshots} from '../public/summary-model.js';
import {detailsClient} from '../public/api.js';

const now=Date.parse('2026-11-06T12:30Z'),key='device-'+'a'.repeat(32);
const hours=[
  {start:'2026-11-01T23:00:00Z',end:'2026-11-02T00:00:00Z',observedSeconds:3600,occupiedSeconds:3600,runningSessions:1},
  {start:'2026-11-02T00:00:00Z',end:'2026-11-02T01:00:00Z',observedSeconds:3600,occupiedSeconds:3600,runningSessions:3},
  {start:'2026-11-02T01:00:00Z',end:'2026-11-02T02:00:00Z',observedSeconds:3600,occupiedSeconds:0,runningSessions:0},
  {start:'2026-11-06T12:00:00Z',end:'2026-11-06T12:30:00Z',observedSeconds:900,occupiedSeconds:600,runningSessions:2}
];
const source={version:2,name:'Box',month:'2026-11',hours,snapshots:[],
  days:[{start:'2026-11-01T00:00:00Z',observedSeconds:3600,runningSessions:1},{start:'2026-11-02T00:00:00Z',observedSeconds:7200,runningSessions:3},{start:'2026-11-06T00:00:00Z',observedSeconds:900,runningSessions:2}],
  runCounts:hours.map((row,i)=>({...row,runStarts:[0,2,0,2][i],runningAtStart:[1,1,0,0][i]}))};
async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-views-')),store=await new DataStore(root).open(),index=await store.index();
  const box={name:'Box',deviceKey:key,storageKey:key,historyStart:hours[0].start,months:['2026-11']};
  const stage=await store.stage();await atomicJson(path.join(stage,key,'2026-11.json'),source);
  await atomicJson(path.join(stage,'index.json'),{...index,updatedAt:new Date(now).toISOString(),boxes:[box]});await store.publish(stage);
  const sample={at:new Date(now).toISOString(),connection:'online',listed:true,runningInstances:1,storedInstances:2,maintenanceWindows:[]};
  const status={version:1,identityNamespace:index.identityNamespace,updatedAt:sample.at,boxes:[{...box,lastSample:sample}]};
  await store.publishStatus(status);
  return {root,store,box,status,clean:()=>rm(root,{recursive:true,force:true})};
}

test('precomputed circles preserve occupancy, partial coverage, future exclusions and episode counts',async()=>{
  const f=await fixture();
  try{
    for(const period of ['day','week','month','year']){
      const response=f.store.details(period,now,now),box=response.boxes[0],window=periodWindow(period,now);
      assert.equal('hours' in box,false);assert.equal('runCounts' in box,false);
      const summary=combineSummaries(box.summaries.map(row=>row.value).filter(Boolean),window,now,Date.parse(f.box.historyStart));
      const original=aggregate(hours,window.start,window.end,now,Date.parse(f.box.historyStart));
      for(const field of ['percent','occupied','observed','elapsed','coverage'])assert.equal(summary[field],original[field],period+' '+field);
      for(const row of box.summaries){
        const value=summaryValue(row.value,row,now,Date.parse(f.box.historyStart)),original=aggregate(hours,row.start,row.end,now,Date.parse(f.box.historyStart));
        for(const field of ['percent','occupied','observed','elapsed','coverage','state'])assert.equal(value[field],original[field],period+' circle '+field);
        assert.equal(row.runCount,periodRunCount(source,row));
      }
    }
    const november=f.store.details('year',now,now).boxes[0].summaries[10];
    assert.equal(november.runCount,5); // Carry-in once + four starts, not summed hourly/day counts.
    const next=summaryValue(november.value,november,now+600000,Date.parse(f.box.historyStart));
    assert.equal(next.occupied,7800);assert.equal(next.observed,11700); // Time passing adds no observations.
    const dst={start:midnight('2026-10-25'),end:midnight('2026-10-26')};
    assert.equal(summaryValue({observed:90000,occupied:90000},dst,now).coverage,1);
  }finally{await f.store.close();await f.clean();}
});

test('materialized views survive restart, serve without raw-file reads and invalidate on publication',async()=>{
  const f=await fixture();let store=f.store;
  try{
    const file=path.join(store.historyPath(),key,'2026-11.json'),saved=file+'.saved';
    const disk=JSON.parse(await readFile(path.join(store.historyPath(),'views.json'),'utf8'));assert.equal(disk.version,1);
    const first=store.details('month',now,now);assert.equal(store.details('month',now,now),first);
    await rename(file,saved); // Hot views and restart use persisted summaries, not the original hours.
    assert.equal((await store.occupancy(now)).windows.get(key).month.occupied,7800);
    await store.close();store=await new DataStore(f.root).open();assert.equal(store.details('month',now,now).boxes[0].summaries[0].runCount,1);
    const changed={...f.status,updatedAt:new Date(now+300000).toISOString(),boxes:[{...f.status.boxes[0],lastSample:{...f.status.boxes[0].lastSample,at:new Date(now+300000).toISOString(),connection:'offline'}}]};
    const before=store.details('month',now,now);await store.publishStatus(changed);
    const after=store.details('month',now,now+300000);assert.notEqual(after.revision,before.revision);
    const sixth=after.boxes[0].summaries[5],value=applySnapshots(summaryValue(sixth.value,sixth,now+300000),{snapshots:sixth.snapshots},sixth,now+300000);
    assert.equal(value.statusEvidence.offline,changed.updatedAt);assert.equal(sixth.value.occupied,600);
    await rename(saved,file);
    const stage=await store.stage();await atomicJson(path.join(stage,key,'2026-11.json'),{...source,hours:hours.map(row=>({...row,occupiedSeconds:0}))});await store.publish(stage);
    assert.equal((await store.occupancy(now)).windows.get(key).month.occupied,0);
    assert.equal(store.details('month',now,now).boxes[0].summaries[5].value.occupied,0);
    const current=store.details('month',now,now),bad=await store.stage();await atomicJson(path.join(bad,key,'2026-11.json'),{...source,name:'Wrong'});
    await assert.rejects(store.publish(bad),/Invalid history month/);assert.equal(store.details('month',now,now),current);
    const cachePath=path.join(store.historyPath(),'views.json');await store.close();store=null;
    await rm(cachePath);
    store=await new DataStore(f.root).open();assert.equal(store.details('month',now,now).boxes.length,1); // Upgrade/no-cache rebuild.
  }finally{await store?.close();await f.clean();}
});

test('compact snapshots retain every status evidence category and latest sighting',()=>{
  const samples=Array.from({length:100},(_,i)=>({at:new Date(now+i*1000).toISOString(),connection:i===1?'offline':'online',maintenance:i===2,listed:i!==3}));
  const compact=compactSnapshots(samples),bin={start:now,end:now+3600000};
  assert.ok(compact.length<=5);
  const result=rows=>applySnapshots(aggregate([],bin.start,bin.end,now+200000),{snapshots:rows},bin,now+200000);
  assert.deepEqual(result(compact),result(samples));
});

test('details API serves stable ETags, bounded summaries and no raw hours',async()=>{
  const f=await fixture();let server;
  try{
    server=await createServer({runtime:{store:f.store,health:()=>({configured:true})},publicDir:path.resolve('public'),now:()=>now});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
    const status=await (await fetch(base+'/api/status')).json();assert.equal(status.historyRevision,f.store.revision());
    const url=base+'/api/details?period=year&at='+now,response=await fetch(url),body=await response.json();
    assert.equal(body.boxes[0].summaries.length,12);assert.equal(body.representation,'summaries');assert.equal('hours' in body.boxes[0],false);
    assert.equal((await fetch(url,{headers:{'If-None-Match':response.headers.get('etag')}})).status,304);
    for(const query of ['period=century','period=day&at=NaN','period=year&at=-1'])assert.equal((await fetch(base+'/api/details?'+query)).status,400);
  }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await f.store.close();await f.clean();}
});

test('browser switches back without HTTP, refreshes Now independently and reloads changed revisions',async()=>{
  const calls=[];let revision='first',running=1;
  const client=detailsClient({now:()=>now,fetchImpl:async url=>{
    calls.push(url);
    const common={identityNamespace:'same',updatedAt:new Date(now).toISOString()};
    if(url==='/api/status')return new Response(JSON.stringify({...common,version:1,historyRevision:revision,boxes:[{deviceKey:key,name:'Box',lastSample:{at:new Date(now).toISOString(),runningInstances:running}}]}));
    return new Response(JSON.stringify({...common,version:2,representation:'summaries',revision,boxes:[{deviceKey:key,name:'Box',summaries:[]}]}));
  }});
  await Promise.all([client.load('month'),client.load('month')]);assert.equal(calls.length,2);
  await client.load('day');assert.equal(calls.length,3);await client.load('month');assert.equal(calls.length,3);
  running=2;const refreshed=await client.load('month',null,{refreshStatus:true});assert.equal(calls.length,4);assert.equal(refreshed.boxes[0].lastSample.runningInstances,2);
  revision='second';await client.load('month',null,{refreshStatus:true});assert.equal(calls.length,6);
});
