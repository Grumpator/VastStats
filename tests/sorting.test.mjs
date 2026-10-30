import test from 'node:test';
import assert from 'node:assert/strict';
import {sortDevices} from '../public/model.js';
const now=Date.parse('2026-10-30T17:00Z');
const box=(name,connection,running,listed)=>({name,lastSample:{at:new Date(now).toISOString(),connection,running,listed}});
const devices=[box('device10','online',false,false),box('device2','online',false,true),box('device3','online',true,true),box('device1','offline',true,true),{name:'device4'}];
const names=rows=>rows.map(b=>b.name);
test('device sorting is natural, reversible and leaves source data untouched',()=>{
 assert.deepEqual(names(sortDevices(devices)),['device1','device2','device3','device4','device10']);
 assert.deepEqual(names(sortDevices(devices,{key:'name',direction:'desc'})),['device10','device4','device3','device2','device1']);
 assert.equal(devices[0].name,'device10');
});
test('state sorting uses the displayed primary status with unavailable last in both directions',()=>{
 assert.deepEqual(names(sortDevices(devices,{key:'state'},{now})),['device1','device3','device2','device10','device4']);
 assert.deepEqual(names(sortDevices(devices,{key:'state',direction:'desc'},{now})),['device10','device2','device3','device1','device4']);
});
test('occupancy sorting is numeric for the selected period and keeps missing values last',()=>{
 const scores={device1:0,device2:100,device3:9.5,device10:50};
 const options={occupancy:b=>scores[b.name]??null};
 assert.deepEqual(names(sortDevices(devices,{key:'occupancy',direction:'desc'},options)),['device2','device10','device3','device1','device4']);
 assert.deepEqual(names(sortDevices(devices,{key:'occupancy'},options)),['device1','device3','device10','device2','device4']);
 scores.device1=90;
 assert.equal(sortDevices(devices,{key:'occupancy',direction:'desc'},options)[1].name,'device1');
});
