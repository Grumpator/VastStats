import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {DataStore,atomicJson} from '../server/store.mjs';
import {createServer} from '../server/app.mjs';
import {deviceInfoRows,everythingStats} from '../public/device-info.js';
import {currentStatus,aggregate,dayKey} from '../public/model.js';
import {periodWindow} from '../public/periods.js';

const now=Date.parse('2026-11-04T12:00:00Z'),hour=3600000,day=24*hour;
const identity=letter=>'device-'+letter.repeat(32);
const row=(age,occupied,observed=3600)=>({start:new Date(now-age).toISOString(),end:new Date(now-age+hour).toISOString(),observedSeconds:observed,occupiedSeconds:occupied});
test('fleet windows use weighted observed time; Everything uses all history and refreshes after publication',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-occupancy-'));let store,server;
  try{
    store=await new DataStore(root).open();const initial=await store.index(),stage=await store.stage();
    const boxes=['a','b','c'].map(letter=>({name:letter,deviceKey:identity(letter),storageKey:identity(letter),historyStart:new Date(now-40*day).toISOString(),months:letter==='a'?['2026-09','2026-10','2026-11']:['2026-11']}));
    const rows={a:[row(2*hour,3600),row(48*hour,0),row(10*day,1800),row(40*day,0)],b:[row(2*hour,0,1800)],c:[row(2*hour,3600)]};
    for(const box of boxes)for(const month of box.months)await atomicJson(path.join(stage,box.storageKey,month+'.json'),{version:2,name:box.name,month,hours:rows[box.name].filter(r=>r.start.slice(0,7)===month),snapshots:[]});
    await atomicJson(path.join(stage,'index.json'),{...initial,updatedAt:new Date(now+1000).toISOString(),boxes});await store.publish(stage);
    const sample={at:new Date(now).toISOString(),connection:'online',listed:true,runningInstances:1,maintenanceWindows:[]};
    await store.publishStatus({version:1,source:'machines',identityNamespace:initial.identityNamespace,updatedAt:sample.at,boxes:boxes.slice(0,2).map(box=>({...box,lastSample:sample}))});
    const first=await store.occupancy(now);assert.equal(first.devices.get(identity('a')).percent,37.5);assert.equal(first.windows.get(identity('a')).day.occupied,3600);
    const later=await store.occupancy(now+60000);assert.equal(later.devices.get(identity('a')).percent,37.5);
    const runtime={store,health:()=>({configured:true})};server=await createServer({runtime,publicDir:path.resolve('public'),now:()=>now});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port,response=await fetch(base+'/api/overview'),value=await response.json();
    assert.equal(response.status,200);assert.equal(value.boxes.length,2);
    assert.equal(value.source,'machines');assert.equal(value.updatedAt,sample.at); // History publication cannot replace the Now clock.
    assert.equal(value.occupancy.day.percent,80);
    assert.ok(Math.abs(value.occupancy.week.percent-7200/12600*100)<1e-9);
    assert.equal(value.occupancy.month.percent,value.occupancy.week.percent); // October is not part of calendar November.
    for(const key of ['day','week','month']){
      const window=periodWindow(key,now),from=dayKey(new Date(window.start)),to=dayKey(new Date(now));
      const details=await (await fetch(base+'/api/history?from='+from+'&to='+to)).json();
      const stats=details.boxes.map(box=>aggregate(box.hours,window.start,window.end,now,Date.parse(box.historyStart)));
      const occupied=stats.reduce((n,s)=>n+s.occupied,0),observed=stats.reduce((n,s)=>n+s.observed,0);
      assert.ok(Math.abs(value.occupancy[key].percent-occupied/observed*100)<1e-9,key+' matches Details');
    }
    assert.equal(value.boxes[0].totalOccupancy.percent,37.5);assert.equal(value.boxes[0].historyStart,boxes[0].historyStart);
    assert.equal('hours' in value.boxes[0],false); // Compact summary, not a history transfer.
    const next=await store.stage();await atomicJson(path.join(next,identity('a'),'2026-11.json'),{version:2,name:'a',month:'2026-11',hours:[row(2*hour,0),row(48*hour,0)],snapshots:[]});await store.publish(next);
    const refreshed=await (await fetch(base+'/api/overview')).json();assert.equal(refreshed.occupancy.day.percent,40);assert.equal(refreshed.boxes[0].totalOccupancy.percent,12.5);
  }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await store?.close();await rm(root,{recursive:true,force:true});}
});

test('empty fleet history remains unknown, with no assumed zero occupancy',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-no-occupancy-'));let store;
  try{store=await new DataStore(root).open();const result=await store.occupancy(now);assert.equal(result.devices.size,0);assert.equal(result.windows.size,0);}
  finally{await store?.close();await rm(root,{recursive:true,force:true});}
});

test('both device hover panels share fields; only period statistics and label change',()=>{
  const box={name:'Box',lastSample:{at:new Date(now).toISOString(),connection:'online',listed:true,runningInstances:1,storedInstances:2,gpuCount:2,allocatedStorageGb:80,maintenanceWindows:[]},totalOccupancy:{percent:75,observedSeconds:14400,occupiedSeconds:10800,elapsedSeconds:18000,coverage:.8}};
  const status=currentStatus(box.lastSample,now),overview=deviceInfoRows(box,everythingStats(box),status,{period:'Everything',now});
  const detail=deviceInfoRows(box,{percent:50,observed:3600,occupied:1800,elapsed:3600,coverage:1},status,{period:'Selected day',now});
  assert.deepEqual(overview.map(([key])=>key),detail.map(([key])=>key));
  const all=Object.fromEntries(overview),selected=Object.fromEntries(detail);
  assert.equal(all.Period,'Everything');assert.equal(selected.Period,'Selected day');assert.equal(all.Occupancy,'75.0%');assert.equal(selected.Occupancy,'50.0%');
  for(const field of ['Connection','Listing','Maintenance','Instances','Storage','GPUs','Verification','Reliability','Status checked','History through'])assert.equal(all[field],selected[field]);
  assert.equal(all.Instances,'1 running · 2 stored');assert.equal(all.Storage,'80 GB allocated');
  const unknown=Object.fromEntries(deviceInfoRows(box,everythingStats({}),status,{now}));assert.equal(unknown.Occupancy,'—');assert.equal(unknown['Data coverage'],'—');
});
