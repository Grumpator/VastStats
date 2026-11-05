import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tileState,tileLayout,mergeStatus} from '../public/overview-model.js';
import {collectStatus} from '../scripts/collect-status.mjs';
import {statusSource} from '../public/status-data.js';
const now=Date.parse('2026-11-01T12:00Z'),at=new Date(now).toISOString();
test('overview distinguishes all requested device states without inventing offline',()=>{
  const sample={at,connection:'online',listed:true,runningInstances:1,maintenanceWindows:[]};
  const state=changes=>tileState({...sample,...changes},now).state;
  assert.equal(state({}),'running');assert.equal(state({runningInstances:0}),'listed');
  assert.equal(state({listed:false,runningInstances:0}),'unlisted');
  const windows=[{start:new Date(now-1000).toISOString(),end:new Date(now+1000).toISOString()}];
  assert.equal(state({maintenanceWindows:windows}),'maintenance-running');
  assert.equal(state({connection:'offline',maintenanceWindows:windows}),'maintenance-offline');
  assert.equal(state({connection:'offline',listed:false}),'offline-unlisted');
  assert.equal(state({connection:'offline'}),'offline');
  assert.equal(state({connection:'unknown'}),'unknown');
  assert.equal(state({listed:false}),'unlisted-running');
  assert.equal(state({maintenanceWindows:windows,runningInstances:1}),'maintenance-running');
  assert.equal(state({maintenanceWindows:windows,runningInstances:0}),'maintenance');
  assert.equal(state({listed:null}),'unknown');
  assert.equal(state({maintenanceWindows:null}),'unknown');
  assert.equal(state({runningInstances:null}),'unknown');
  assert.equal(tileState(sample,now+1000000).state,'running');assert.equal(tileState(sample,now+1000000).stale,true);
  assert.equal(tileState(null,now).state,'unknown');
});

test('all nine known combinations use maintenance/category colours and independent running/offline activity',()=>{
  const window={start:new Date(now-1000).toISOString(),end:new Date(now+1000).toISOString()};
  const expected={listed:['running','listed','offline'],maintenance:['maintenance-running','maintenance','maintenance-offline'],unlisted:['unlisted-running','unlisted','offline-unlisted']};
  for(const category of Object.keys(expected))for(const [i,activity] of ['running','idle','offline'].entries()){
    const sample={at,connection:activity==='offline'?'offline':'online',runningInstances:activity==='idle'?0:2,listed:category!=='unlisted',maintenanceWindows:category==='maintenance'?[window]:[]};
    const result=tileState(sample,now);assert.equal(result.state,expected[category][i]);assert.equal(result.category,category);assert.equal(result.activity,activity);
    if(activity==='offline')assert.equal(result.running,false,'offline wins over reported running instances');
    if(category==='maintenance')assert.equal(tileState({...sample,listed:false},now).state,result.state,'maintenance colour overrides unlisted');
  }
});

test('planned maintenance waits for its start; stale snapshots retain the captured state across later boundaries',()=>{
  const planned={start:new Date(now+600000).toISOString(),end:new Date(now+3600000).toISOString()};
  const sample={at,connection:'online',runningInstances:1,listed:true,listingEndsAt:new Date(now+300000).toISOString(),maintenanceWindows:[planned]};
  assert.equal(tileState(sample,now).state,'running');
  assert.equal(tileState(sample,now+360000).state,'unlisted-running');
  assert.equal(tileState(sample,now+660000).state,'maintenance-running');
  const overdue=tileState(sample,now+1200000);assert.equal(overdue.stale,true);assert.equal(overdue.state,'running');assert.equal(overdue.listed,true);assert.equal(overdue.maintenance,false);
  const active={...sample,listed:false,listingEndsAt:null,maintenanceWindows:[{start:new Date(now-1000).toISOString(),end:new Date(now+1000).toISOString()}]};
  assert.equal(tileState(active,now+1200000).state,'maintenance-running');
});
test('tile sizing fits 4, 40, 400 and 1000 devices within readable bounds',()=>{
  for(const count of [4,40,400,1000]){
    const {size,columns}=tileLayout(count,1100,580);
    assert.ok(size>=22&&size<=64);assert.ok(Math.ceil(count/columns)*(size+5)-5<=580||size===22);
  }
  assert.equal(tileLayout(4,1100,580).size,64);
  assert.equal(tileLayout(1000,320,400).size,22);
});
test('current state overlays leave historical occupancy unchanged and respect namespace',()=>{
  const hours=[{occupiedSeconds:3600}],box={name:'Old',deviceKey:'a',lastSample:{at:new Date(now-1000).toISOString()},hours};
  const history={identityNamespace:'same',boxes:[box]},status={identityNamespace:'same',snapshotMaxAgeSeconds:900,boxes:[{name:'New',deviceKey:'a',lastSample:{at}}]};
  const result=mergeStatus(history,status);assert.equal(result.boxes[0].name,'New');assert.equal(result.boxes[0].hours,hours);assert.equal(box.name,'Old');
  assert.equal(mergeStatus(history,{...status,identityNamespace:'different'}),history);
});
test('status collection reads the fleet once, sanitizes 400 devices and preserves snapshot on failure',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'vaststats-status-')),root=pathToFileURL(folder+'/');
  let calls=0;
  const api={machines:async()=>{calls++;return {machines:Array.from({length:400},(_,i)=>({id:900000+i,hostname:'spark-'+i,timeout:0,listed:true,current_rentals_running:1,current_rentals_resident:2,num_gpus:2,machine_maintenance:[],alloc_disk_space:80,api_key:'PRIVATE',ip:'PRIVATE_IP'}))};}};
  try{
    const result=await collectStatus({api,root,now,identitySeed:'stable-private-identity-seed'});
    assert.equal(calls,1);assert.equal(result.boxes.length,400);
    const saved=await readFile(new URL('status.json',root),'utf8');
    for(const needle of ['PRIVATE','"id":','"machine_id":','900000'])assert.equal(saved.includes(needle),false);
    assert.equal(result.boxes[0].lastSample.runningInstances,1);
    await assert.rejects(collectStatus({api:{machines:async()=>{throw Error('No connection');}},root,now:now+1000,identitySeed:'stable-private-identity-seed'}));
    assert.equal(await readFile(new URL('status.json',root),'utf8'),saved);
    await assert.rejects(collectStatus({api,root,identitySeed:'different-private-identity-seed'}),/identity seed/);
    assert.equal(calls,1);
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('public status polling coalesces calls and retains original timestamp after failure',async()=>{
  let clock=now,calls=0;
  const value={version:1,updatedAt:at,boxes:[]};
  const source=statusSource({now:()=>clock,fetchImpl:async()=>{calls++;if(calls>1)throw Error('Offline');return {ok:true,json:async()=>value};}});
  assert.equal(await source(),value);assert.equal(await source(),value);assert.equal(calls,1);
  clock+=60000;assert.equal(await source(),value);assert.equal(calls,2);assert.equal(value.updatedAt,at);
});
