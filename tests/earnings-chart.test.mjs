import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EarningsSeries,machineDay} from '../server/earnings-series.mjs';
import {chartDateRange,chartDays,chartScale,earningsChartSeries,rankedPoints,rangeTotal} from '../public/earnings-chart-model.js';

const now=Date.parse('2026-11-07T12:00Z'),a='device-'+'a'.repeat(32),b='device-'+'b'.repeat(32);
const devices=[{deviceKey:a,id:'101',name:'Alpha'},{deviceKey:b,id:'202',name:'Beta'}];
function response(start,end){return {sday:start/86400000,eday:end/86400000-1,username:'PRIVATE',per_machine:[{machine_id:101,gpu_earn:6,sto_earn:.6,bwu_earn:1.2,bwd_earn:1.8},{machine_id:202,gpu_earn:4,sto_earn:.4,bwu_earn:.8,bwd_earn:1.2}],summary:{total_gpu:10,total_stor:1,total_bwu:2,total_bwd:3},per_day:[{day:start/86400000,gpu_earn:10,sto_earn:1,bwu_earn:2,bwd_earn:3}]};}

test('chart ranges stay in UTC, clamp future dates and reject invalid/custom oversized ranges',()=>{
  assert.deepEqual(chartDateRange('7',{now}),{from:'2026-11-01',to:'2026-11-07'});
  assert.deepEqual(chartDateRange('year',{now,availableFrom:'2026-02-01'}),{from:'2026-02-01',to:'2026-11-07'});
  assert.deepEqual(chartDateRange('custom',{now,from:'2026-11-01',to:'2027-01-01'}),{from:'2026-11-01',to:'2026-11-07'});
  for(const [from,to] of [['2026-02-30','2026-03-01'],['2026-11-07','2026-11-01'],['2020-01-01','2026-11-07']])assert.throws(()=>chartDateRange('custom',{now,from,to}));
  assert.equal(chartDays({from:'2026-10-24',to:'2026-10-26'}).length,3);
});

test('chart series keep unreported days as gaps, preserve zero/negative amounts and keep fleet total independent',()=>{
  const daily=[{day:'2026-11-01',computeUsd:10,bandwidthUsd:2,storageUsd:1,totalUsd:13},{day:'2026-11-03',computeUsd:0,bandwidthUsd:0,storageUsd:0,totalUsd:0},{day:'2026-11-04',computeUsd:-1,bandwidthUsd:0,storageUsd:0,totalUsd:-1}];
  const range={from:'2026-11-01',to:'2026-11-04'};
  const source=earningsChartSeries({daily,range,enabled:['bandwidthUsd','totalUsd']});
  assert.deepEqual(source[0].points.map(p=>p.value),[2,null,0,0]);assert.deepEqual(source[1].points.map(p=>p.value),[13,null,0,-1]);
  const machine=earningsChartSeries({daily,range,mode:'machine',enabled:[a,'totalUsd'],devices:[{deviceKey:a,name:'Alpha',daily:[{day:'2026-11-01',totalUsd:5}]}]});
  assert.equal(machine[0].points[0].value,5);assert.equal(machine[1].points[0].value,13);assert.equal(machine[0].points[2].value,null);
  assert.deepEqual(rankedPoints(machine,0).map(point=>point.value),[13,5]);
  assert.equal(rangeTotal(daily,'totalUsd',{from:'2026-11-02',to:'2026-11-04'}),-1);
  assert.equal(rangeTotal(daily,'totalUsd',{from:'2026-11-02',to:'2026-11-02'}),null);
});

test('currency axes cover the data and retain distinct fractional tick labels',()=>{
  for(const values of [[.02,.48],[-.2,.07],[0,0],[41,18]]){
    const scale=chartScale(values);assert.ok(scale.min<=Math.min(...values));assert.ok(scale.max>=Math.max(...values));
    const labels=[];for(let value=scale.min;value<=scale.max+scale.step*.001;value+=scale.step)labels.push(value.toFixed(scale.decimals));
    assert.equal(new Set(labels).size,labels.length);assert.ok(labels.length<=8);
  }
});

test('one daily backfill serves every device, coalesces requests, paces dates and survives restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vaststats-machine-series-'));let time=now,calls=0,series;
  const settings={root,now:()=>time,wait:async ms=>{time+=ms;},apiFactory:()=>({earnings:async(start,end,id)=>{calls++;assert.equal(id,undefined);return response(start,end);}})};
  const range={from:'2026-11-06',to:'2026-11-06'};
  try{
    series=await new EarningsSeries(settings).open();await series.setDevices(devices);
    await Promise.all([series.selected([a],range),series.selected([a,b],range)]);await series.chain;
    const values=await series.selected([a,b],range);assert.equal(calls,1);assert.equal(values.progress.loaded,1);assert.ok(Math.abs(values.series[0].daily[0].totalUsd-9.6)<1e-9);assert.ok(Math.abs(values.series[1].daily[0].totalUsd-6.4)<1e-9);
    assert.equal(JSON.stringify(values).includes('machine_id'),false);assert.equal(JSON.stringify(values).includes('PRIVATE'),false);
    await series.setDevices(devices.map(device=>({...device,gpuModel:device.deviceKey===a?'GB10':null})));
    const grouped=await series.selected(['gpu:GB10'],range,'gpu');
    assert.equal(grouped.series.length,1);assert.ok(Math.abs(grouped.series[0].daily[0].totalUsd-9.6)<1e-9);
    assert.ok(Math.abs(grouped.totals['gpu-unknown']-6.4)<1e-9);assert.equal(calls,1);
    assert.deepEqual(grouped.hours,{'gpu:GB10':24,'gpu-unknown':24});
    await series.setDevices(devices.map(device=>({...device,gpuModel:'GB10'})));
    await series.setDevices(devices); // A retired device keeps its last known GPU model.
    const combined=await series.selected(['gpu:GB10'],range,'gpu');
    assert.equal(combined.series[0].daily[0].totalUsd,16);assert.deepEqual(combined.totals,{'gpu:GB10':16});assert.equal(calls,1);
    await series.selected([a,b],{from:'2026-11-05',to:'2026-11-06'});await series.chain;assert.equal(calls,2);assert.equal(time,now+2500);
    await series.close();series=await new EarningsSeries(settings).open();await series.selected([b],range);assert.equal(calls,2);
    const today={from:'2026-11-07',to:'2026-11-07'};
    await series.selected([a],today);await series.chain;
    const partial=await series.selected([a],today);
    assert.ok(Math.abs(partial.hours[a]-(12+2.5/3600))<1e-9);
    await assert.rejects(series.selected(['unknown'],range));await assert.rejects(series.selected(Array(9).fill(a),range));await assert.rejects(series.selected([a],{from:'2020-01-01',to:'2026-11-07'}));
  }finally{await series?.close();await rm(root,{recursive:true,force:true});}
});

test('failed daily refreshes keep cached device data, back off, and reject incomplete matrices',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vaststats-machine-failure-'));let time=now,fail=false,calls=0,series;
  const range={from:'2026-11-06',to:'2026-11-06'};
  try{
    series=await new EarningsSeries({root,now:()=>time,wait:async()=>{},apiFactory:()=>({earnings:async(start,end)=>{calls++;if(fail)throw Error('PRIVATE');return response(start,end);}})}).open();await series.setDevices(devices);
    await series.selected([a],range);await series.chain;time+=7*3600000;fail=true;
    await series.selected([a],range);await series.chain;const retained=await series.selected([a],range);assert.equal(retained.series[0].stale,true);assert.equal(retained.series[0].daily.length,1);assert.equal(calls,2);
    const bad=response(Date.parse('2026-11-06T00:00Z'),Date.parse('2026-11-07T00:00Z'));bad.per_machine[0].gpu_earn=100;assert.throws(()=>machineDay(bad,'2026-11-06',devices,now));
  }finally{await series?.close();await rm(root,{recursive:true,force:true});}
});
