import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMarket,priceSuggestion} from '../server/market.mjs';
import {discoverMachines} from '../scripts/history-discovery.mjs';
import {readConfig} from '../server/config.mjs';

const seed='market-test-identity-secret';
const time=Date.parse('2026-11-07T14:00:00Z');

test('market shares a snapshot, excludes own offers and falls back to comparable GPUs when same-model offers are scarce',async()=>{
  const raw={machines:[101,102].map(id=>({
    id,hostname:'Fleet '+id,num_gpus:1,gpu_name:'GB10',gpu_ram:0,cpu_ram:124608,cpu_arch:'arm64',verification:'verified',
    listed:true,listed_min_gpu_count:1,listed_gpu_cost:.45,timeout:2,reliability2:.99,geolocation:'London, GB',private:'secret'
  }))};
  const status={updatedAt:new Date(time).toISOString(),boxes:discoverMachines(raw,{seed}).map(({deviceKey})=>({
    deviceKey,lastSample:{earnings:{runningGpuCount:1,computeUsdPerHour:.33}}
  }))};
  const offer=(machine,host,price,overrides={})=>({
    machine_id:machine,host_id:host,num_gpus:1,gpu_name:'GB10',gpu_ram:121856,dlperf:26.9,dph_base:price,
    cpu_arch:'arm64',verification:'verified',rentable:true,rented:false,reliability:.99,geolocation:'London, GB',
    private:'secret',...overrides
  });
  let metricsCalls=0,queries=0;
  const api={
    async gpuMetrics(){
      metricsCalls++;
      return {gpus:[{gpu_name:'GB10',total:100,available:5,unavailable:1,rented_verified:80,rented_unverified:14,
        avail_verified:3,avail_unverified:2,unavail_verified:0,unavail_unverified:1,usage_30d:75,dlperf:26.9}]};
    },
    async offers(filters){
      queries++;
      if(filters.machine_id)return {offers:[offer(101,901,.6,{rentable:false})]};
      if(filters.gpu_name)return {offers:[offer(101,901,.6),offer(201,801,.4),offer(202,801,.6),
        offer(203,802,.15,{verification:'unverified'}),offer(204,803,.14,{reliability:.8})]};
      assert.equal(filters.gpu_ram.gte,124608*.8);
      assert.equal(filters.dlperf.lte,26.9*1.3);
      const alternative={gpu_name:'Similar GPU'};
      return {offers:[offer(301,701,.35,alternative),offer(302,702,.45,alternative),offer(303,703,.5,alternative),
        offer(304,704,.1,{...alternative,gpu_ram:24000}),offer(305,705,.1,{...alternative,dlperf:60})]};
    }
  };
  const market=createMarket({api,machines:async()=>raw,status:()=>status,seed,now:()=>time});
  assert.equal(market.read().refreshing,true);
  assert.equal(market.read().refreshing,true);
  await market.close();
  const result=market.read(),group=result.snapshot.groups[0];
  assert.equal(metricsCalls,1);assert.equal(queries,3);assert.equal(result.refreshing,false);
  assert.equal(group.market.rented,94);assert.equal(group.market.verified.rented,80);assert.equal(group.market.usage30,.75);
  assert.equal(group.exact.samples,1);assert.equal(group.exact.median,.5);
  assert.equal(group.peers.samples,3);assert.equal(group.peerModels[0].name,'Similar GPU');
  assert.equal(group.suggestion.peers,true);assert.equal(group.suggestion.booked,true);
  assert.ok(Math.abs(group.suggestion.renter.high/group.suggestion.host.high-4/3)<1e-9);
  assert.equal(group.devices[0].booked,.33);
  const publicData=JSON.stringify(result);
  for(const field of ['machine_id','host_id','private','secret'])assert.equal(publicData.includes(field),false);
});

test('market keeps unsupported conversions and thin cross-architecture signals out of the host recommendation',()=>{
  const peers={samples:5,p25:.3,median:.4};
  assert.equal(priceSuggestion({peers,crossArch:true}),null);
  const onlyPeers=priceSuggestion({peers});
  assert.equal(onlyPeers.host,null);
  assert.deepEqual(onlyPeers.renter,{low:.3,high:.4});
  const booked=priceSuggestion({booked:{samples:2,p25:.29,median:.3}});
  assert.equal(booked.renter,null);assert.equal(booked.host.high,.3);
  assert.equal(readConfig({MARKET_ENABLED:'1'}).marketEnabled,false);
  assert.equal(readConfig({MARKET_ENABLED:'1',HOST:'127.0.0.1'}).marketEnabled,true);
});
