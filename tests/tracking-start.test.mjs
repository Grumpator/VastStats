import {test} from 'node:test';
import assert from 'node:assert/strict';
import {aggregate,circleSegments} from '../public/model.js';
const hour=3600000,start=Date.parse('2026-10-18T00:00Z');
test('time before available history is inapplicable, while subsequent gaps stay missing',()=>{
  const historyStart=start+hour/2;
  assert.equal(aggregate([],start-hour,start,start+2*hour,historyStart).state,'not-tracked');
  assert.equal(aggregate([],start-hour,start,start+2*hour,historyStart).elapsed,0);
  const gap=aggregate([],start+hour,start+2*hour,start+2*hour,historyStart);
  assert.equal(gap.state,'unknown');assert.equal(gap.elapsed,3600);assert.equal(gap.coverage,0);
  assert.equal(aggregate([],start+3*hour,start+4*hour,start+2*hour,historyStart).state,'future');
});
test('the first partial hour uses tracked time without prorating its already clipped summaries again',()=>{
  const rows=[{start:new Date(start).toISOString(),end:new Date(start+hour).toISOString(),observedSeconds:1800,occupiedSeconds:1800}];
  const value=aggregate(rows,start-hour,start+hour,start+2*hour,start+hour/2);
  assert.equal(value.elapsed,1800);assert.equal(value.observed,1800);assert.equal(value.coverage,1);assert.equal(circleSegments(value).running,100);
  const unknownBoundary=aggregate(rows,start-hour,start+hour,start+2*hour,NaN);
  assert.equal(unknownBoundary.elapsed,7200);assert.equal(unknownBoundary.coverage,.25);
});
test('fleet coverage weights each device only from its individual history boundary',()=>{
  const now=start+24*hour;
  const older=aggregate([{start:new Date(start).toISOString(),end:new Date(now).toISOString(),observedSeconds:86400,occupiedSeconds:43200}],start,now,now,start);
  const newer=aggregate([{start:new Date(start+12*hour).toISOString(),end:new Date(now).toISOString(),observedSeconds:43200,occupiedSeconds:21600}],start,now,now,start+12*hour);
  assert.equal((older.observed+newer.observed)/(older.elapsed+newer.elapsed),1);
});
