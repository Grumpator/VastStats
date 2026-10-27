import {test} from 'node:test';
import assert from 'node:assert/strict';
import {machineState,sanitizeMachines,updateHistory,parseMap} from '../scripts/collect.mjs';
import {midnight,addDays,binsForDay,aggregate,periodDays,currentStatus} from '../public/model.js';
test('exports only names and counts, even when response contains secrets',()=>{
  const result=sanitizeMachines({machines:[{id:123,name:'private',hostname:'private-host',api_key:'secret',public_ipaddr:'192.0.2.1',timeout:0,machine_maintenance:null,current_rentals_running:1,current_rentals_resident:2}]},{123:'Alpha'});
  assert.deepEqual(result,[{name:'Alpha',running:true,runningInstances:1,storedInstances:2,allocatedStorageGb:null,connection:'online',maintenanceWindows:[],listed:null,listingEndsAt:null}]);
  assert.deepEqual(sanitizeMachines({machines:[]},{123:'Alpha'})[0],{name:'Alpha',running:null,runningInstances:null,storedInstances:null,allocatedStorageGb:null,connection:'unknown',maintenanceWindows:null,listed:null,listingEndsAt:null});
  assert.throws(()=>parseMap('{"123":"Alpha","456":"Alpha"}'));
});
test('listing expires independently of running rentals and splits history between checks',()=>{
  const start=Date.parse('2026-10-26T10:00Z'),expiry=start+120000;
  const state=machineState({timeout:0,listed:true,end_date:expiry/1000,machine_maintenance:null},start);
  assert.equal(state.listed,true);
  assert.equal(machineState({timeout:0,listed:true,end_date:expiry/1000},expiry).listed,false);
  assert.equal(machineState({timeout:0,listed:0}).listed,false);
  const sample={name:'Alpha',running:true,storedInstances:1,...state};
  let data=updateHistory({boxes:[]},[sample],start);
  data=updateHistory(data,[sample],start+300000);
  const value=aggregate(data.boxes[0].hours,start,start+3600000,start+300000);
  assert.equal(value.listed,120);assert.equal(value.unlisted,180);assert.equal(value.percent,100);
  assert.equal(value.borderState,'unlisted');
  assert.equal(currentStatus({at:new Date(start).toISOString(),...state},expiry).listed,false);
});
test('one border uses offline, maintenance, unlisted, listed priority',()=>{
  const start=Date.parse('2026-10-26T10:00Z'),end=start+3600000;
  const row={start:new Date(start).toISOString(),end:new Date(end).toISOString(),observedSeconds:3600,occupiedSeconds:0,listedSeconds:3600,unlistedSeconds:0,maintenanceSeconds:0,offlineSeconds:0};
  const state=()=>aggregate([row],start,end,end).borderState;
  assert.equal(state(),'listed');row.unlistedSeconds=1;assert.equal(state(),'unlisted');row.maintenanceSeconds=1;assert.equal(state(),'maintenance');row.offlineSeconds=1;assert.equal(state(),'offline');
});
test('uses Vast heartbeat threshold; offline never inherits stale running counts',()=>{
  assert.equal(machineState({timeout:9,machine_maintenance:null}).connection,'online');
  assert.equal(machineState({timeout:10,machine_maintenance:null}).connection,'offline');
  assert.equal(machineState({timeout:null}).connection,'unknown');
  const sample=sanitizeMachines([{id:123,timeout:600,current_rentals_running:1,current_rentals_resident:2}],{123:'Alpha'})[0];
  assert.equal(sample.running,false);assert.equal(sample.runningInstances,1);assert.equal(sample.storedInstances,2);
});

test('preserves allocated GB and instance counts without treating missing or invalid storage as zero',()=>{
  const start=Date.parse('2026-10-26T10:00Z');
  for(const [raw,expected] of [[125.5,125.5],[0,0],[undefined,null],[null,null],[-1,null],['125',null]]){
    const sample=sanitizeMachines([{id:123,timeout:0,current_rentals_running:3,current_rentals_resident:4,alloc_disk_space:raw}],{123:'Alpha'})[0];
    const snapshot=updateHistory({boxes:[]},[sample],start).boxes[0].lastSample;
    assert.equal(snapshot.allocatedStorageGb,expected);assert.equal(snapshot.runningInstances,3);assert.equal(snapshot.storedInstances,4);
  }
});
test('scheduled maintenance respects starts, ends and cancellation, without exporting reasons',()=>{
  const now=Date.parse('2026-10-26T10:00Z');
  const state=machineState({timeout:0,machine_maintenance:[{start_time:now/1000+60,duration_hours:1,maintenance_category:'private reason'},{start_time:now/1000-100,duration_hours:1,cancelled_at:now/1000}]},now);
  assert.equal(state.maintenanceWindows.length,1);
  assert.equal(JSON.stringify(state).includes('private reason'),false);
  const sample={at:new Date(now).toISOString(),...state};
  assert.equal(currentStatus(sample,now).maintenance,false);
  assert.ok(currentStatus(sample,now).next);
  assert.equal(currentStatus(sample,now+60000).maintenance,true);
  assert.equal(currentStatus(sample,now+21*60000).connection,'stale');
});
test('offline is zero occupancy with coverage; missing status remains unknown',()=>{
  const start=Date.parse('2026-10-26T10:00Z');
  let data=updateHistory({boxes:[]},[{name:'Alpha',running:false,storedInstances:1,connection:'offline',maintenanceWindows:[{start:new Date(start+120000).toISOString(),end:new Date(start+240000).toISOString()}]}],start);
  data=updateHistory(data,[{name:'Alpha',running:null,storedInstances:null,connection:'unknown',maintenanceWindows:null}],start+300000);
  const result=aggregate(data.boxes[0].hours,start,start+3600000,start+300000);
  assert.equal(result.percent,0);assert.equal(result.offline,300);assert.equal(result.maintenance,120);assert.equal(result.coverage,1);
  data=updateHistory(data,[{name:'Alpha',running:null,storedInstances:null,connection:'unknown',maintenanceWindows:null}],start+600000);
  const missing=aggregate(data.boxes[0].hours,start,start+3600000,start+600000);
  assert.equal(missing.observed,300);assert.equal(missing.coverage,.5);
});
test('handles actual 23 and 25 hour London days',()=>{
  assert.equal(binsForDay('2026-03-29',true).length,23);
  assert.equal(binsForDay('2026-10-25',true).length,25);
  assert.equal(midnight('2026-10-25'),Date.parse('2026-10-24T23:00Z'));
  assert.equal(periodDays('2024-02-15','month').length,29);
  assert.equal(periodDays('2024-02-15','year').length,366);
});
const sample=(running,storedInstances=1)=>[{name:'Alpha',running,storedInstances}];
test('square stored count is the last observed count, not the maximum within the hour',()=>{
  const start=Date.parse('2026-10-26T10:00Z');
  let data={boxes:[]};
  [1,2,1,0].forEach((count,index)=>{data=updateHistory(data,sample(false,count),start+index*300000);});
  const hour=()=>aggregate(data.boxes[0].hours,start,start+3600000,start+3600000);
  assert.equal(hour().stored,0);
  for(let minute=20;minute<=55;minute+=5)data=updateHistory(data,sample(false,0),start+minute*60000);
  data=updateHistory(data,sample(false,3),start+3600000);
  assert.equal(hour().stored,0);
});
test('selected-period occupancy excludes missing history and future time',()=>{
  const now=Date.parse('2026-10-27T12:00Z');
  const rows=[
    {start:'2026-10-20T10:00Z',end:'2026-10-20T13:00Z',observedSeconds:10800,occupiedSeconds:0},
    {start:'2026-10-26T10:00Z',end:'2026-10-26T12:00Z',observedSeconds:7200,occupiedSeconds:7200}
  ];
  const forView=view=>{
    const days=periodDays('2026-10-27',view);
    return aggregate(rows,midnight(days[0]),midnight(addDays(days.at(-1),1)),now);
  };
  assert.equal(forView('week').percent,100);
  assert.equal(forView('month').percent,40);
  assert.equal(forView('year').percent,40);
  assert.equal(forView('month').observed,18000);
  assert.equal(forView('month').occupied,7200);
  const future=aggregate(rows,midnight('2026-10-28'),midnight('2026-10-29'),now);
  assert.equal(future.percent,null);assert.equal(future.observed,0);
  const missing=aggregate(rows,midnight('2026-10-01'),midnight('2026-10-02'),now);
  assert.equal(missing.percent,null);assert.equal(missing.observed,0);
});
test('integrates sampled running state across hour boundaries without inventing first-run history',()=>{
  let data=updateHistory({boxes:[]},sample(true),Date.parse('2026-10-26T09:58Z'));
  assert.equal(data.boxes[0].hours.length,0);
  data=updateHistory(data,sample(false,2),Date.parse('2026-10-26T10:03Z'));
  assert.equal(data.boxes[0].hours.length,2);
  assert.equal(data.boxes[0].hours[0].occupiedSeconds,120);
  assert.equal(data.boxes[0].hours[1].occupiedSeconds,180);
  data=updateHistory(data,sample(false,2),Date.parse('2026-10-26T10:08Z'));
  const result=aggregate(data.boxes[0].hours,Date.parse('2026-10-26T10:00Z'),Date.parse('2026-10-26T11:00Z'),Date.parse('2026-10-26T11:00Z'));
  assert.equal(result.percent,37.5);assert.equal(result.observed,480);assert.equal(result.stored,2);
  assert.equal(result.income,null);assert.equal(result.coverage,480/3600);
});
test('long gaps remain unknown and repeated collection does not double-count',()=>{
  let data=updateHistory({boxes:[]},sample(true),Date.parse('2026-10-26T10:00Z'));
  data=updateHistory(data,sample(true),Date.parse('2026-10-26T11:00Z'));
  assert.equal(data.boxes[0].hours.length,0);
  data=updateHistory(data,sample(true),Date.parse('2026-10-26T11:05Z'));
  data=updateHistory(data,sample(true),Date.parse('2026-10-26T11:05Z'));
  assert.equal(data.boxes[0].hours[0].observedSeconds,300);
  const missing=aggregate([],Date.parse('2026-10-26T10:00Z'),Date.parse('2026-10-26T11:00Z'));
  assert.equal(missing.state,'unknown');assert.equal(missing.percent,null);
});
