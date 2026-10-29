import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadHistoryData,applySnapshots,githubDataSource,periodRunCount} from '../public/history-data.js';

test('hour and day squares use their own run counts, without summing hour counts or substituting stored counts',()=>{
  const start=Date.parse('2026-10-28T00:00Z'),row={start:new Date(start).toISOString(),observedSeconds:3600,runningSessions:2,storedInstances:0};
  const box={hours:[row],days:[{...row,runningSessions:3}],lastSample:{runningInstances:1,storedInstances:4}};
  assert.equal(periodRunCount(box,{start,end:start+3600000}),2);
  assert.equal(periodRunCount(box,{start,end:start+86400000}),3);
  assert.equal(periodRunCount(box,{start:start+3600000,end:start+7200000}),null);
});

test('public data is pinned to one commit and rate-limited lookups retain the last resolved version',async()=>{
  let at=0,calls=0,fail=false;const sha='a'.repeat(40);
  const source=githubDataSource({now:()=>at,fetchImpl:async()=>{calls++;return fail?new Response('',{status:403}):new Response(JSON.stringify({object:{type:'commit',sha}}));}});
  assert.equal((await source()).pathname,'/Grumpator/VastStats/'+sha+'/public/data/');
  at=60000;await source();assert.equal(calls,1);
  at=300000;fail=true;assert.equal((await source()).pathname.includes(sha),true);assert.equal(calls,2);
  at=360000;await source();assert.equal(calls,2);
  const invalid=githubDataSource({fetchImpl:async()=>new Response(JSON.stringify({object:{type:'commit',sha:'https://private.example'}}))});
  await assert.rejects(invalid(),/Invalid repository/);
});
test('visible windows request only the per-box files for both months they cross',async()=>{
  const requested=[];
  const fetchImpl=async url=>{const p=new URL(url).pathname;requested.push(p);return new Response(JSON.stringify(p.endsWith('index.json')?{version:2,boxes:[{name:'Alpha',months:['2026-09','2026-10','2026-11']}]}:{version:2,name:'Alpha',month:p.includes('2026-10')?'2026-10':'2026-11',hours:[],snapshots:[]}));};
  const data=await loadHistoryData('https://example.test/data/',['2026-10-28','2026-11-01'],{fetchImpl});
  assert.equal(data.boxes.length,1);assert.deepEqual(requested,['/data/index.json','/data/Alpha/2026-10.json','/data/Alpha/2026-11.json']);
});
test('a missing month fails explicitly instead of displaying fabricated empty history',async()=>{
  const fetchImpl=async url=>new URL(url).pathname.endsWith('index.json')?new Response('{"version":2,"boxes":[{"name":"Alpha","months":["2026-10"]}]}'):new Response('',{status:404});
  await assert.rejects(loadHistoryData('https://example.test/data/',['2026-10-28'],{fetchImpl}),/unavailable/);
});
test('now cell shows a fresh snapshot without adding occupancy or observed duration',()=>{
  const start=Date.parse('2026-10-28T12:00Z'),at=new Date(start+60000).toISOString();
  const value={observed:0,occupied:0,percent:null,stored:null,borderState:'unknown',state:'unknown'};
  const box={snapshots:[],lastSample:{at,storedInstances:2,connection:'online',listed:true,running:true,maintenanceWindows:[]}};
  const result=applySnapshots(value,box,{start,end:start+3600000},start+120000);
  assert.equal(result.stored,2);assert.equal(result.borderState,'listed');assert.equal(result.percent,null);assert.equal(result.observed,0);assert.equal(result.isNow,true);
  assert.equal(result.currentSnapshot.running,true);assert.equal(result.state,'unknown');
  assert.equal(applySnapshots(value,box,{start,end:start+3600000},start+3*3600000).stored,null);
});
