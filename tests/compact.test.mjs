import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactEnd,compactBins,moveCompact,compactCount,recordsForBin,isoWeek} from '../public/compact.js';
import {midnight} from '../public/model.js';
import {periodRunCount,loadHistoryData} from '../public/history-data.js';
import {summarizeHistory} from '../scripts/history-model.mjs';

test('ISO week labels use the week-year across New Year',()=>{
  assert.deepEqual(isoWeek('2021-01-01'),{week:53,year:2020});
  assert.deepEqual(isoWeek('2025-12-29'),{week:1,year:2026});
  assert.deepEqual(isoWeek('2026-10-26'),{week:44,year:2026});
});

test('compact pages are contiguous and preserve repeated London clock-change hours',()=>{
  const end=compactEnd('2026-10-25','hours',Date.parse('2026-10-29T12:00Z'));
  const bins=compactBins(end,'hours',25);
  assert.equal(bins[0].start,midnight('2026-10-25'));
  assert.equal(bins.at(-1).end,midnight('2026-10-26'));
  assert.equal(compactBins(moveCompact(end,'hours',25,-1),'hours',25).at(-1).end,bins[0].start);
  const days=compactBins(compactEnd('2026-10-26','days'),'days',3);
  assert.equal(days[1].end-days[1].start,25*3600000);
});

test('compact weeks start Monday and monthly pages respect leap years and year boundaries',()=>{
  const weeks=compactBins(compactEnd('2026-10-29','weeks'),'weeks',2);
  assert.equal(weeks.at(-1).key,'2026-10-26');
  const end=compactEnd('2028-03-12','months');
  const months=compactBins(end,'months',3);
  assert.deepEqual(months.map(b=>b.key),['2028-01-01','2028-02-01','2028-03-01']);
  assert.equal(months[1].end-months[1].start,29*86400000);
  assert.equal(moveCompact(moveCompact(end,'months',3,-1),'months',3,1),end);
  for(const width of [320,375,900,1440]){const meta=width<=700?(width<=360?226:248):340,count=compactCount(width,meta);assert.ok(count*28-4<=width-26-meta-12);}
});

test('run counters count restarts and carry-in once, including starts during coverage gaps',()=>{
  const start=Date.parse('2026-10-01T00:00Z')/1000,stop=start+3*86400;
  const active=[{id:1,first_seen:start-3600,last_seen:stop,end_witnessed:true,runs:[{start:start-3600,end:stop}]}];
  active.push({id:2,first_seen:start,last_seen:stop,end_witnessed:true,runs:Array.from({length:10},(_,i)=>({start:start+i*7200+60,end:start+i*7200+120}))});
  const t=Array.from({length:3*24*12},(_,i)=>start+i*300);
  const summary=summarizeHistory({name:'Alpha',start,stop,now:stop*1000,responses:[{sections:{metric:{step:300,t,channels:{cpu:{avg:t.map(()=>1)}}},conts:{active}}}]});
  assert.equal(periodRunCount(summary,{start:start*1000,end:stop*1000}),11);
  assert.equal(summary.runCounts.reduce((n,r)=>n+r.runStarts,0),10);
  const first=summary.runCounts[0];assert.equal(first.runningAtStart,1);
  assert.equal(periodRunCount({...summary,runCounts:[]},{start:start*1000,end:stop*1000}),null);
  assert.equal(periodRunCount({...summary,runCounts:summary.runCounts.slice(1)},{start:start*1000,end:stop*1000}),null);
  assert.equal(JSON.stringify(summary).includes('"id"'),false);
  const rows=summary.hours.map(r=>({...r,startMs:Date.parse(r.start),endMs:Date.parse(r.end)}));
  assert.equal(recordsForBin(rows,{start:start*1000+3600000,end:start*1000+7200000}).length,1);
  const gap=summarizeHistory({name:'Alpha',start,stop,now:stop*1000,responses:[{sections:{metric:{step:300,t,channels:{cpu:{avg:t.map((_,i)=>i<12?null:1)}}},conts:{active}}}]});
  assert.equal(periodRunCount(gap,{start:start*1000,end:stop*1000}),11);
});

test('compact windows load all intersecting months even across a year boundary',async()=>{
  const requested=[],days=['2025-12-31','2026-01-01'];
  const fetchImpl=async url=>{const path=new URL(url).pathname;requested.push(path);const month=path.includes('2025-12')?'2025-12':'2026-01';return new Response(JSON.stringify(path.endsWith('index.json')?{version:2,boxes:[{name:'Alpha',months:['2025-12','2026-01','2026-02']}]}:{version:2,name:'Alpha',month,hours:[],snapshots:[],runCounts:[]}));};
  await loadHistoryData('https://example.test/data/','2026-01-01','week',{fetchImpl,days});
  assert.deepEqual(requested,['/data/index.json','/data/Alpha/2025-12.json','/data/Alpha/2026-01.json']);
});
