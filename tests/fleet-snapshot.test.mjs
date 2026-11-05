import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetSnapshot} from '../public/model.js';
const now=Date.parse('2026-10-28T22:00:00Z');
const box=extra=>({lastSample:{at:new Date(now).toISOString(),connection:'online',listed:true,maintenanceWindows:[],runningInstances:1,storedInstances:2,allocatedStorageGb:40,...extra}});
test('fleet snapshot counts boxes separately from instances and respects offline and active maintenance',()=>{
 const value=fleetSnapshot([box({runningInstances:3}),box({connection:'offline',listed:false,runningInstances:9}),box({runningInstances:0,maintenanceWindows:[{start:'2026-10-28T21:00:00Z',end:'2026-10-28T23:00:00Z'}],listingEndsAt:'2026-10-28T21:30:00Z'})],now);
 assert.deepEqual(value,{total:3,online:2,listed:1,maintenance:1,running:1,runningInstances:3,stored:6,storage:120,overdue:0});
});
test('unknown snapshots do not silently become zero totals; stale snapshots retain known state',()=>{
 const unknown=fleetSnapshot([box({}),{}],now);
 for(const key of ['online','listed','maintenance','running','runningInstances','stored','storage'])assert.equal(unknown[key],null,key);
 assert.equal(unknown.total,2);assert.equal(unknown.overdue,1);
 const stale=fleetSnapshot([box({at:'2026-10-28T19:00:00Z'})],now);
 assert.equal(stale.overdue,1);assert.equal(stale.online,1);assert.equal(stale.running,1);
 const empty=fleetSnapshot([],now);assert.equal(empty.total,0);assert.equal(empty.online,null);assert.equal(empty.stored,null);
});
