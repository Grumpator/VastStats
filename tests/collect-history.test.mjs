import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectHistory,monthWindow,mergeHours,coverageQuery} from '../scripts/collect-history.mjs';
test('London month boundaries include the actual daylight saving change',()=>{
  const [start,stop]=monthWindow('2026-10');assert.equal((stop-start)/3600,745);
});
test('late partial responses preserve previously recovered hours',()=>{
  const old={start:'2026-10-01T00:00Z',observedSeconds:3600,occupiedSeconds:1200};
  assert.deepEqual(mergeHours([old],[{...old,observedSeconds:30}]),[old]);
  assert.equal(mergeHours([old],[{...old,occupiedSeconds:1800}])[0].occupiedSeconds,1800);
  const corrected={...old,observedSeconds:2997,occupiedSeconds:2997,storedInstances:1,calculationVersion:2};
  assert.deepEqual(mergeHours([old],[corrected]),[corrected]);
  assert.deepEqual(mergeHours([corrected],[{...corrected,observedSeconds:30}]),[corrected]);
});
test('collector creates per-box/month files and keeps cached history when one box fails',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'vaststats-history-')),root=pathToFileURL(folder+'/');
  const now=Date.parse('2026-10-02T12:00Z'),first=Date.parse('2026-10-01T00:00Z')/1000;
  let failAlpha=false;
  const api={
    machines:async()=>({machines:[123,456].map(id=>({id,num_gpus:4,timeout:0,current_rentals_running:1,current_rentals_resident:1,alloc_disk_space:20,hostname:'private-host',api_key:'secret'}))}),
    connect:async()=>{},meta:async id=>{if(id==='123'&&failAlpha)throw Error('private error');return {extent:{t0:first}};},
    query:async(id,start,stop,sections)=>({sections:{metric:{raw:false,step:15,t:[start],channels:{cpu:{avg:[1]}}},...(sections.conts?{conts:{active:[{id:999,first_seen:start,last_seen:stop,end_witnessed:true,runs:[{start,end:Math.min(stop,start+15)}]}]}}:{})}})
  };
  try{
    const result=await collectHistory({api,root,now,mapping:{123:'Alpha',456:'Beta'}});
    assert.equal(result.boxes[0].lastSample.gpuCount,4);assert.equal(result.version,2);assert.deepEqual(result.boxes.map(b=>b.months),[['2026-10'],['2026-10']]);
    const file=new URL('Alpha/2026-10.json',root),saved=await readFile(file,'utf8');
    assert.ok(JSON.parse(saved).hours.length);for(const needle of ['private-host','secret','999','123'])assert.equal(saved.includes(needle),false);
    failAlpha=true;
    const refreshed=await collectHistory({api,root,now:now+3600000,mapping:{123:'Alpha',456:'Beta'}});
    assert.equal(refreshed.boxes[0].historyError,true);assert.equal(await readFile(file,'utf8'),saved);
    assert.equal(refreshed.boxes[1].historyError,undefined);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('aligned queries eliminate the real 98.8% bucket-grid artefact while preserving missing buckets',async()=>{
 const {coverageIntervals,summarizeHistory}=await import('../scripts/history-model.mjs');
 const start=Date.parse('2026-10-25T00:00Z')/1000,stop=start+86400;
 const nativeTimes=Array.from({length:675},(_,i)=>start+i*128);
 // Actual API behaviour: native 128s buckets are stamped on the requested grid.
 // 5,760 points is capped to 4,000, resulting in a 21.6s output grid.
 const responseFor=(a,b,points,missing=-1)=>{
  const grid=(b-a)/Math.min(points,4000);
  const t=nativeTimes.filter((_,i)=>i!==missing).map(t=>Math.floor(a+Math.floor((t-a)/grid)*grid));
  return {view:[a,b],step:128,raw:false,t,channels:{cpu:{avg:t.map(()=>1)}}};
 };
 const seen=(m,a=start,b=stop)=>coverageIntervals(m,a,b).reduce((n,[x,y])=>n+y-x,0);
 const old=responseFor(start,stop,5760);
 assert.equal(seen(old,start+2*3600,start+3*3600),3558);
 const q=coverageQuery(start,stop);assert.equal(q.points,2700);assert.equal(q.start,start);assert.equal(q.stop,stop);
 assert.equal(seen(responseFor(q.start,q.stop,q.points)),86400);
 assert.equal(seen(responseFor(q.start,q.stop,q.points,10)),86400-128);
 const partial=coverageQuery(start+13,start+3617);
 assert.equal(partial.start%32,0);assert.equal(partial.stop%32,0);assert.ok(partial.points<=2700);
 const summary=summarizeHistory({name:'Alpha',start:start+13,stop:start+3617,now:(start+3617)*1000,responses:[{sections:{metric:responseFor(partial.start,partial.stop,partial.points),conts:{active:[]}}}]});
 assert.equal(summary.hours.reduce((n,h)=>n+h.observedSeconds,0),3604);
 assert.equal(summary.aggregationVersion,4);
 assert.equal(mergeHours([{start:'x',observedSeconds:3558,calculationVersion:3}],[{start:'x',observedSeconds:3500,calculationVersion:4}])[0].observedSeconds,3500);
});
