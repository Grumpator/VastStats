import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadHistoryData,applySnapshots} from '../public/history-data.js';
test('week navigation requests only the per-box files for both months it crosses',async()=>{
  const requested=[];
  const fetchImpl=async url=>{const p=new URL(url).pathname;requested.push(p);return new Response(JSON.stringify(p.endsWith('index.json')?{version:2,boxes:[{name:'Alpha',months:['2026-09','2026-10','2026-11']}]}:{version:2,name:'Alpha',month:p.includes('2026-10')?'2026-10':'2026-11',hours:[],snapshots:[]}));};
  const data=await loadHistoryData('https://example.test/data/','2026-10-28','week',{fetchImpl});
  assert.equal(data.boxes.length,1);assert.deepEqual(requested,['/data/index.json','/data/Alpha/2026-10.json','/data/Alpha/2026-11.json']);
});
test('a missing month fails explicitly instead of displaying fabricated empty history',async()=>{
  const fetchImpl=async url=>new URL(url).pathname.endsWith('index.json')?new Response('{"version":2,"boxes":[{"name":"Alpha","months":["2026-10"]}]}'):new Response('',{status:404});
  await assert.rejects(loadHistoryData('https://example.test/data/','2026-10-28','month',{fetchImpl}),/unavailable/);
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
