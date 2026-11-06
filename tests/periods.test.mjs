import {test} from 'node:test';
import assert from 'node:assert/strict';
import {periodWindow,periodBins,movePeriod} from '../public/periods.js';
import {midnight} from '../public/model.js';

test('24h has 24 clock-hour circles, including the current unfinished hour',()=>{
  const now=Date.parse('2026-11-06T14:25Z'),window=periodWindow('day',now),bins=periodBins(window);
  assert.equal(bins.length,24);assert.equal(window.start,Date.parse('2026-11-05T15:00Z'));
  assert.equal(bins.at(-1).start,Date.parse('2026-11-06T14:00Z'));
  for(const change of ['2026-03-29T01:25Z','2026-10-25T01:25Z'])assert.equal(periodBins(periodWindow('day',Date.parse(change))).length,24);
});

test('week is Monday to Sunday including future days, preserving clock changes',()=>{
  const window=periodWindow('week',Date.parse('2026-10-25T12:00Z')),bins=periodBins(window);
  assert.equal(bins.length,7);assert.equal(bins[0].key,'2026-10-19');assert.equal(bins.at(-1).key,'2026-10-25');
  assert.equal(window.end-window.start,169*3600000);
  const current=periodWindow('week',Date.parse('2026-11-04T12:00Z')),days=periodBins(current);
  assert.equal(days[0].key,'2026-11-02');assert.equal(days.at(-1).key,'2026-11-08');
  assert.ok(days.at(-1).start>Date.parse('2026-11-04T12:00Z'));
});

test('calendar months and years include future circles but have correct boundaries',()=>{
  const month=periodWindow('month',Date.parse('2028-02-12T12:00Z'));
  assert.equal(periodBins(month).length,29);assert.equal(month.start,midnight('2028-02-01'));assert.equal(month.end,midnight('2028-03-01'));
  const year=periodWindow('year',Date.parse('2026-11-06T12:00Z')),bins=periodBins(year);
  assert.equal(bins.length,12);assert.equal(bins[0].key,'2026-01-01');assert.equal(bins.at(-1).key,'2026-12-01');assert.equal(year.end,midnight('2027-01-01'));
});

test('period navigation is contiguous, reversible and cannot pass the latest period',()=>{
  const now=Date.parse('2026-11-06T14:25Z');
  for(const period of ['day','week','month','year']){
    const current=periodWindow(period,now),previousReference=movePeriod(period,now,-1,now),previous=periodWindow(period,previousReference);
    assert.equal(previous.end,current.start,period+' pages are contiguous');
    const next=periodWindow(period,movePeriod(period,previousReference,1,now));
    assert.equal(next.start,current.start);assert.equal(next.end,current.end);
    assert.equal(periodWindow(period,movePeriod(period,now,1,now)).end,current.end);
  }
});
