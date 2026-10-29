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
test('current hour sectors use elapsed time, while summary occupancy still excludes unknown data',()=>{
 const start=Date.parse('2026-10-27T18:00Z');
 const v=aggregate([{start:new Date(start).toISOString(),end:new Date(start+3600000).toISOString(),observedSeconds:1800,occupiedSeconds:1800}],start,start+3600000,start+1800000);
 assert.equal(v.elapsed,1800);assert.equal(v.percent,100);assert.equal(circleSegments(v).running,50);
 assert.equal(circleSegments({elapsed:1800,observed:1800,occupied:1800}).running,100);
 assert.deepEqual(circleSegments({elapsed:3600,observed:0,occupied:0}),{running:null,idle:0,observed:0,unknown:100});
 assert.deepEqual(circleSegments({elapsed:0,observed:0,occupied:0}),{running:null,idle:0,observed:0,unknown:0});
});
