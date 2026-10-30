import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregate,circleSegments} from '../public/model.js';
test('partial coverage distinguishes confirmed running, confirmed idle and unknown elapsed time',()=>{
 const v=circleSegments({elapsed:3600,observed:1888,occupied:1858});
 assert.equal(v.running.toFixed(1),'51.6');assert.equal(v.idle.toFixed(1),'0.8');assert.equal(v.unknown.toFixed(1),'47.6');assert.equal(v.observed.toFixed(1),'52.4');
 assert.equal(v.running+v.idle+v.unknown,100);
 assert.equal(circleSegments({elapsed:3600,observed:1800,occupied:1800}).running,50);
 assert.equal(circleSegments({elapsed:3600,observed:3600,occupied:3600}).running,100);
});
test('current hour sectors keep unknown time grey while occupancy uses observed time',()=>{
 const start=Date.parse('2026-10-27T18:00Z');
 const v=aggregate([{start:new Date(start).toISOString(),end:new Date(start+3600000).toISOString(),observedSeconds:1800,occupiedSeconds:1800}],start,start+3600000,start+1800000);
 assert.equal(v.elapsed,1800);assert.equal(v.percent,100);assert.equal(circleSegments(v).running,50);
 assert.equal(circleSegments({elapsed:1800,observed:1800,occupied:1800}).running,100);
 assert.deepEqual(circleSegments({elapsed:3600,observed:0,occupied:0}),{running:null,idle:0,observed:0,unknown:100});
 assert.deepEqual(circleSegments({elapsed:0,observed:0,occupied:0}),{running:null,idle:0,observed:0,unknown:0});
});

test('partial coverage keeps observed occupancy separate from the green sector',()=>{
 const start=Date.parse('2026-10-27T18:00Z'),end=start+3600000;
 const records=[{start:new Date(start).toISOString(),end:new Date(end).toISOString(),observedSeconds:1888,occupiedSeconds:1858}];
 const value=aggregate(records,start,end,end);
 assert.equal(value.percent.toFixed(1),'98.4');
 assert.equal(circleSegments(value).running.toFixed(1),'51.6');
 const first=aggregate(records,start,end,end,start+1800000);
 assert.equal(first.elapsed,1800);assert.equal(first.percent.toFixed(1),'98.4');
});

test('delayed data lowers coverage without lowering fully occupied observed time',()=>{
 const start=Date.parse('2026-10-30T08:00Z'),hour=3600000;
 const records=[{start:new Date(start).toISOString(),end:new Date(start+hour).toISOString(),observedSeconds:3600,occupiedSeconds:3600}];
 const before=aggregate(records,start,start+3*hour,start+hour);
 const delayed=aggregate(records,start,start+3*hour,start+3*hour);
 assert.equal(before.percent,100);assert.equal(delayed.percent,100);
 assert.equal(before.coverage,1);assert.equal(delayed.coverage,1/3);
 assert.ok(Math.abs(circleSegments(delayed).running-100/3)<1e-9);
 assert.equal(aggregate([],start,start+hour,start+hour).percent,null);
});
