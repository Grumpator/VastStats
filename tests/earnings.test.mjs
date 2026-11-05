import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {contractEarnings,fleetEarnings} from '../scripts/earnings.mjs';
import {collectStatus} from '../scripts/collect-status.mjs';
import {HistoryApi} from '../scripts/history-api.mjs';
import {mergeStatus} from '../public/overview-model.js';
import {hourlyUsd} from '../public/now.js';

const contract=(extra={})=>({contract_id:1,state:'running',charge_types:['gpu','disk'],num_gpus:2,gpu_price_dph:.3,disk_size_gb:100,disk_price_dpgbm:.144,...extra});
const response=contracts=>({contracts,truncated:false,omitted_count:0,billing_degraded:false,aggregation_degraded:false});
const near=(value,expected)=>assert.ok(Math.abs(value-expected)<1e-12,`${value} != ${expected}`);

test('hourly rate uses actual per-GPU contract prices, allocated storage and a 30-day month without fee adjustment',()=>{
  const result=contractEarnings(response([contract({listed_gpu_cost:99,earn_hour:999,inet_up_cost:999})]));
  near(result.computeUsdPerHour,.6);near(result.storageUsdPerHour,.02);near(result.totalUsdPerHour,.62);
});
test('stopped instances earn storage only; offline contracts earn nothing; standalone volumes count once',()=>{
  const result=contractEarnings(response([
    contract({state:'stopped'}),
    contract({contract_id:2,state:'offline'}),
    contract({contract_id:3,charge_types:['volume'],num_gpus:0,vol_size_gb:200,vol_price_dpgbm:.36})
  ]));
  near(result.computeUsdPerHour,0);near(result.storageUsdPerHour,.12);near(result.totalUsdPerHour,.12);
  assert.deepEqual(contractEarnings(response([])),{computeUsdPerHour:0,storageUsdPerHour:0,totalUsdPerHour:0});
});
test('incomplete responses and invalid or unsupported contract rates never become a partial earnings total',()=>{
  for(const extra of [{truncated:true},{omitted_count:1},{billing_degraded:true},{aggregation_degraded:true},{contracts:null}])assert.throws(()=>contractEarnings({...response([contract()]),...extra}));
  for(const extra of [{state:'unknown'},{charge_types:['unknown']},{num_gpus:1.5},{gpu_price_dph:null},{disk_size_gb:null},{disk_price_dpgbm:-1}])assert.throws(()=>contractEarnings(response([contract(extra)])));
  assert.throws(()=>contractEarnings(response([contract(),contract()])));
  near(contractEarnings(response([contract({disk_size_gb:0,disk_price_dpgbm:null,gpu_price_dph:0})])).totalUsdPerHour,0);
});
test('fleet rate is complete or explicitly unavailable, with zero different from missing data',()=>{
  const boxes=[{lastSample:{earnings:{computeUsdPerHour:.6,storageUsdPerHour:.02}}},{lastSample:{earnings:{computeUsdPerHour:0,storageUsdPerHour:.08}}}];
  near(fleetEarnings(boxes).totalUsdPerHour,.7);
  assert.equal(fleetEarnings([...boxes,{lastSample:{earnings:null}}]).totalUsdPerHour,null);
  assert.equal(fleetEarnings([...boxes,{lastSample:{}}]).unavailableDevices,1);
  assert.equal(fleetEarnings([]).totalUsdPerHour,null);
});
test('contract reads use the existing authenticated read-only endpoint',async()=>{
  const api=new HistoryApi('PRIVATE_TEST_KEY',{fetchImpl:async(url,options)=>{
    assert.equal(url,'https://console.vast.ai/api/v0/machines/123/contracts/');assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer PRIVATE_TEST_KEY');return new Response(JSON.stringify(response([])));
  }});
  assert.deepEqual(await api.contracts(123),response([]));
});
test('Now collects per-device rates privately; an earnings failure still publishes fresh device states and recovers',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-earnings-'));
  let fail=false,calls=[];
  const now=Date.parse('2026-11-05T10:00Z'),api={
    machines:async()=>({machines:[1,2,3].map(id=>({id,hostname:'Box-'+id,timeout:id===3?10:0,listed:true,machine_maintenance:[],current_rentals_running:1,current_rentals_resident:1}))}),
    contracts:async id=>{calls.push(id);if(fail&&String(id)==='2')throw Error('PRIVATE_RAW_ERROR');return response([contract({contract_id:987654321,api_key:'PRIVATE_CUSTOMER_SECRET',customer_email:'PRIVATE_EMAIL'})]);}
  };
  try{
    const opts={api,root:pathToFileURL(root+path.sep),now,identitySeed:'a'.repeat(64)};
    const first=await collectStatus(opts);assert.deepEqual(calls,['1','2']);near(first.earnings.totalUsdPerHour,1.24);
    assert.equal(first.boxes[2].lastSample.earnings.totalUsdPerHour,0);
    const saved=await readFile(path.join(root,'status.json'),'utf8');
    for(const secret of ['PRIVATE_CUSTOMER_SECRET','PRIVATE_EMAIL','987654321','gpu_price_dph','contracts'])assert.equal(saved.includes(secret),false);
    fail=true;calls=[];const second=await collectStatus({...opts,now:now+300000});
    assert.deepEqual(calls,['1','2']);assert.equal(second.updatedAt,new Date(now+300000).toISOString());assert.equal(second.boxes[1].lastSample.connection,'online');
    assert.equal(second.earnings.totalUsdPerHour,null);assert.equal(second.earnings.unavailableDevices,1);assert.equal(JSON.stringify(second).includes('PRIVATE_RAW_ERROR'),false);
    fail=false;const third=await collectStatus({...opts,now:now+600000});near(third.earnings.totalUsdPerHour,1.24);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Details keeps the current fleet rate independently of its historical window and history timestamp',()=>{
  const earnings={computeUsdPerHour:.6,storageUsdPerHour:.02,totalUsdPerHour:.62,unavailableDevices:0};
  const merged=mergeStatus({identityNamespace:'test',updatedAt:'2026-11-05T10:01Z',boxes:[]},{identityNamespace:'test',updatedAt:'2026-11-05T10:00Z',earnings,boxes:[]});
  assert.deepEqual(merged.earnings,earnings);
});
test('hourly rate formatting distinguishes unavailable, zero and small storage-only earnings',()=>{
  assert.equal(hourlyUsd(null),'—');assert.equal(hourlyUsd(0),'$0.00');assert.equal(hourlyUsd(1.46694),'$1.47');assert.equal(hourlyUsd(.0002),'$0.0002');
});
