import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HistoryApi} from '../scripts/history-api.mjs';
import {summarizeHistory,coverageIntervals,mergeIntervals,mergeRuns} from '../scripts/history-model.mjs';
const start=Date.parse('2026-10-01T00:00Z')/1000;
const metric=(count=240)=>({step:15,t:Array.from({length:count},(_,i)=>start+i*15),channels:{cpu:{avg:Array(count).fill(1)}}});
const container=(id,runs)=>({id,first_seen:start,last_seen:start+3600,runs:runs.map(([a,b])=>({start:start+a,end:start+b})),hostname:'private',api_key:'secret'});
const summarize=(rows,m=metric())=>summarizeHistory({name:'Alpha',start,stop:start+7200,now:(start+7200)*1000,responses:[{sections:{metric:m,conts:{active:rows}}}]});

test('square counts runs, including stopped instances and restarts, rather than last stored count',()=>{
  const row=container(123,[[0,600],[1200,1800]]);row.last_seen=start+1800;row.end_witnessed=true;
  const result=summarize([row]);assert.equal(result.hours[0].storedInstances,0);assert.equal(result.hours[0].runningSessions,2);assert.equal(result.hours[0].occupiedSeconds,1200);
  const full=summarize([container(123,[[0,1800]]),container(456,[[1800,3600]])]);
  assert.equal(full.hours[0].runningSessions,2);assert.equal(full.hours[0].occupiedSeconds,3600);
  assert.equal(summarize([]).hours[0].runningSessions,0);
});

test('a continuing run counts once per hour and once per day, despite duplicate API records',()=>{
  const row=container(123,[[0,7200]]);row.last_seen=start+7200;
  const result=summarize([row,row],metric(480));
  assert.deepEqual(result.hours.map(h=>h.runningSessions),[1,1]);assert.equal(result.days[0].runningSessions,1);
  assert.equal(mergeRuns([{start:0,end:60,openEnd:true},{start:60,end:120,openStart:true}]).length,1);
  assert.equal(mergeRuns([{start:0,end:60},{start:60,end:120}]).length,2);
  const gap=metric();gap.channels.cpu.avg.fill(null,40,80);
  assert.equal(summarize([container(123,[[0,3600]])],gap).hours[0].runningSessions,1);
});
test('historical intervals backfill an hour regardless of collection gap and merge simultaneous rentals',()=>{
  const result=summarize([container(123,[[0,1800]]),container(456,[[900,2700]])]);
  assert.equal(result.hours[0].occupiedSeconds,2700);assert.equal(result.hours[0].observedSeconds,3600);
  assert.equal(result.hours.length,1);assert.equal(result.hours[0].storedInstances,2);
  assert.equal(JSON.stringify(result).includes('123'),false);assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('missing metric samples, future periods and coarse charts do not become idle observations',()=>{
  const m=metric();m.channels.cpu.avg.fill(null,120);
  const result=summarize([container(123,[[0,3600]])],m);
  assert.equal(result.hours[0].observedSeconds,1800);assert.equal(result.hours[0].occupiedSeconds,1800);
  assert.deepEqual(coverageIntervals({...metric(),step:3600},start,start+3600),[]);
  assert.equal(summarizeHistory({name:'Alpha',start,stop:start+3600,now:start*1000,responses:[]}).hours.length,0);
});
test('approximate or fragmented intervals remain unknown instead of continuous occupancy',()=>{
  const row=container(123,[[0,3600]]);row.runs[0].fragmented=true;
  assert.equal(summarize([row]).hours.length,0);
  row.runs[0].fragmented=false;row.approx=true;assert.equal(summarize([row]).hours.length,0);
});
test('invalid container sections cannot silently produce idle hours',()=>{
  assert.throws(()=>summarizeHistory({name:'Alpha',start,stop:start+3600,responses:[{sections:{metric:metric(),conts:{error:'missing'}}}]}));
  assert.deepEqual(mergeIntervals([[3,4],[0,2],[1,3],[5,5]]),[[0,4]]);
});

test('numeric string container identifiers match numeric identifiers without being exported',()=>{
  const a=container('123',[[0,1800]]),b=container(123,[[1800,3600]]);
  const result=summarize([a,b]);assert.equal(result.hours[0].storedInstances,1);
  assert.equal(result.hours[0].occupiedSeconds,3600);
  assert.equal(JSON.stringify(result).includes('123'),false);
  assert.throws(()=>summarize([container('invalid',[])]),/identifier/);
});
test('native coarse buckets leave gaps visible and raw samples represent one second each',()=>{
  const m={step:128,t:[start,start+256],channels:{cpu:{avg:[1,1]}},raw:false};
  assert.deepEqual(coverageIntervals(m,start,start+3600),[[start,start+128],[start+256,start+384]]);
  assert.deepEqual(coverageIntervals({...m,raw:true},start,start+3600),[[start,start+1],[start+256,start+257]]);
});

test('an open running interval stays full with its stored count when hardware buckets extend past its last observation',()=>{
  const row=container('123',[[0,2997]]);row.last_seen=start+2997;row.end_witnessed=false;row.runs[0].open_end=true;
  const result=summarize([row],{step:128,raw:false,t:Array.from({length:25},(_,i)=>start+i*128),channels:{cpu:{avg:Array(25).fill(1)}}});
  assert.equal(result.hours[0].observedSeconds,2997);assert.equal(result.hours[0].occupiedSeconds,2997);assert.equal(result.hours[0].storedInstances,1);
  assert.equal(result.dataThrough,new Date((start+2997)*1000).toISOString());
  row.end_witnessed=true;row.runs[0].open_end=false;
  const ended=summarize([row]);assert.equal(ended.hours[0].observedSeconds,3600);assert.equal(ended.hours[0].occupiedSeconds,2997);assert.equal(ended.hours[0].storedInstances,0);
});
test('telemetry tokens are sent only to allowlisted HTTPS origins',async()=>{
  const api=new HistoryApi('private',{fetchImpl:async()=>new Response(JSON.stringify({token:'hidden',telemetry_url:'https://untrusted.example'})),pause:async()=>{}});
  await assert.rejects(api.connect(),/Untrusted/);
});
test('rate limits retry with Retry-After and failures never expose the request URL or credentials',async()=>{
  let calls=0,delays=[];
  const api=new HistoryApi('secret',{fetchImpl:async()=>++calls===1?new Response('',{status:429,headers:{'Retry-After':'2'}}):new Response('{"ok":true}'),pause:async ms=>delays.push(ms)});
  assert.deepEqual(await api.request('https://telemetry.vast.ai/private-id','secret'),{ok:true});assert.deepEqual(delays,[2000]);
  api.fetch=async()=>new Response('secret private-id',{status:401});
  await assert.rejects(api.request('https://telemetry.vast.ai/private-id','secret'),error=>error.message==='Vast request failed (HTTP 401)');
});
