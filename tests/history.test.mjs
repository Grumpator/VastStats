import {windowEndForDate,timelineBins} from '../public/timeline.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {machineState,sanitizeMachines} from '../scripts/collect.mjs';
import {midnight,addDays,aggregate,currentStatus} from '../public/model.js';
test('exports only names and counts, even when response contains secrets',()=>{
  const result=sanitizeMachines({machines:[{id:123,name:'private',hostname:'private-host',api_key:'secret',public_ipaddr:'192.0.2.1',timeout:0,machine_maintenance:null,current_rentals_running:1,current_rentals_resident:2}]},{123:'Alpha'});
  assert.deepEqual(result,[{name:'Alpha',running:true,runningInstances:1,storedInstances:2,allocatedStorageGb:null,gpuCount:null,reliability:null,verification:null,connection:'online',maintenanceWindows:[],listed:null,listingEndsAt:null}]);
  assert.deepEqual(sanitizeMachines({machines:[]},{123:'Alpha'})[0],{name:'Alpha',running:null,runningInstances:null,storedInstances:null,allocatedStorageGb:null,gpuCount:null,reliability:null,verification:null,connection:'unknown',maintenanceWindows:null,listed:null,listingEndsAt:null});
});
test('listing expires independently of running rentals',()=>{
  const start=Date.parse('2026-10-26T10:00Z'),expiry=start+120000;
  const state=machineState({timeout:0,listed:true,end_date:expiry/1000,machine_maintenance:null},start);
  assert.equal(state.listed,true);
  assert.equal(machineState({timeout:0,listed:true,end_date:expiry/1000},expiry).listed,false);
  assert.equal(machineState({timeout:0,listed:0}).listed,false);
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
    const snapshot=sample;
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
  assert.equal(currentStatus(sample,now+21*60000).stale,false);
});

test('hourly status remains known after twenty minutes and is labelled overdue after ninety',()=>{
  const now=Date.parse('2026-10-28T12:00Z'),sample={at:new Date(now).toISOString(),connection:'online',listed:true,running:true,maintenanceWindows:[]};
  assert.equal(currentStatus(sample,now+60*60000).stale,false);
  const overdue=currentStatus(sample,now+91*60000);
  assert.equal(overdue.stale,true);assert.equal(overdue.connection,'online');assert.equal(overdue.listed,true);assert.equal(overdue.running,true);
  assert.equal(currentStatus(sample,now-60000).connection,'unknown');
});
test('handles actual 23 and 25 hour London days',()=>{
  assert.equal((midnight('2026-03-30')-midnight('2026-03-29'))/3600000,23);
  assert.equal((midnight('2026-10-26')-midnight('2026-10-25'))/3600000,25);
  assert.equal(midnight('2026-10-25'),Date.parse('2026-10-24T23:00Z'));
  const leap=timelineBins(windowEndForDate('2024-02-15','months'),'months',1)[0];
  assert.equal((leap.end-leap.start)/86400000,29);
});

test('selected-period occupancy excludes missing history and future time',()=>{
  const now=Date.parse('2026-10-27T12:00Z');
  const rows=[
    {start:'2026-10-20T10:00Z',end:'2026-10-20T13:00Z',observedSeconds:10800,occupiedSeconds:0},
    {start:'2026-10-26T10:00Z',end:'2026-10-26T12:00Z',observedSeconds:7200,occupiedSeconds:7200}
  ];
  const forWindow=(scale,count)=>{
    const bins=timelineBins(windowEndForDate('2026-10-27',scale,now),scale,count);
    return aggregate(rows,bins[0].start,bins.at(-1).end,now);
  };
  assert.equal(forWindow('days',2).percent,100);
  assert.equal(forWindow('months',1).percent,40);
  assert.equal(forWindow('weeks',2).percent,40);
  assert.equal(forWindow('months',1).observed,18000);
  assert.equal(forWindow('months',1).occupied,7200);
  const future=aggregate(rows,midnight('2026-10-28'),midnight('2026-10-29'),now);
  assert.equal(future.percent,null);assert.equal(future.observed,0);
  const missing=aggregate(rows,midnight('2026-10-01'),midnight('2026-10-02'),now);
  assert.equal(missing.percent,null);assert.equal(missing.observed,0);
});
test('GPU count is sanitized and retained in a snapshot without exposing GPU identifiers',()=>{
 for(const [raw,expected] of [[1,1],[4,4],[0,0],[null,null],[undefined,null],[-1,null],[1.5,null],['4',null]]){
  const sample=sanitizeMachines([{id:123,num_gpus:raw,gpu_ids:['private-id']}],{123:'Alpha'})[0];
  assert.equal(sample.gpuCount,expected);
  const snapshot=sample;
  assert.equal(snapshot.gpuCount,expected);assert.ok(!JSON.stringify(snapshot).includes('private-id'));
 }
});
