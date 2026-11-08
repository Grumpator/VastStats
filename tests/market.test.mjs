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
  const metricsCalls=[];
  let queries=0,currentTime=time;
  const api={
    async gpuNames(){return {gpu_names:['GB10']};},
    async gpuMetrics(verification){
      metricsCalls.push(verification);
      return {gpus:[{gpu_name:'GB10',total:100,available:5,unavailable:1,rented_verified:80,rented_unverified:14,
        avail_verified:3,avail_unverified:2,unavail_verified:0,unavail_unverified:1,usage_30d:verification==='yes'?82:56.5,dlperf:26.9}]};
    },
    async offers(filters){
      queries++;
      if(filters.machine_id)return {offers:[offer(101,901,.6,{rentable:false})]};
      if(filters.gpu_name)return {offers:[offer(101,901,.6),offer(201,801,.4),offer(202,801,.6),
        offer(203,802,.15,{verification:'unverified'}),offer(204,803,.14,{reliability:.8})]};
      assert.equal(filters.gpu_ram.gte,124608*.6);
      if(filters.dlperf.gt){assert.equal(filters.dlperf.gt,26.9);assert.equal(filters.dlperf.lte,26.9*1.7);return {offers:[]};}
      assert.equal(filters.dlperf.lte,26.9);
      const alternative={gpu_name:'Similar GPU'};
      return {offers:[offer(301,701,.35,alternative),offer(302,702,.45,alternative),offer(303,703,.5,alternative),
        offer(304,704,.1,{...alternative,gpu_ram:24000}),offer(305,705,.1,{...alternative,dlperf:60})]};
    }
  };
  const market=createMarket({api,machines:async()=>raw,status:()=>status,seed,now:()=>currentTime});
  assert.equal(market.read().refreshing,true);
  assert.equal(market.read().refreshing,true);
  await market.close();
  const result=market.read(),group=result.snapshot.groups[0];
  assert.deepEqual(metricsCalls,['yes','no']);assert.equal(queries,4);assert.equal(result.refreshing,false);
  assert.equal(group.market.total,100);assert.equal(group.market.rented,94);
  assert.deepEqual(group.market.verified,{rented:80,available:3,unavailable:0,usage30:.82});
  assert.deepEqual(group.market.unverified,{rented:14,available:2,unavailable:1,usage30:.565});
  assert.equal(group.exact.samples,1);assert.equal(group.exact.median,.5);
  assert.equal(group.peers.samples,3);assert.equal(group.peerModels[0].name,'Similar GPU');
  assert.equal(group.suggestion.peers,true);
  assert.ok(Math.abs(group.suggestion.host.high-(.45+.5)/2/1.25)<1e-9);
  assert.equal(group.devices[0].booked,.33);
  const publicData=JSON.stringify(result);
  for(const field of ['machine_id','host_id','private','secret'])assert.equal(publicData.includes(field),false);
  for(const device of raw.machines){device.listed=false;device.listed_gpu_cost=undefined;}
  for(const box of status.boxes)box.lastSample.earnings={runningGpuCount:0,computeUsdPerHour:0};
  currentTime+=15*60_000;
  market.read();await market.close();
  const unlisted=market.read().snapshot.groups[0];
  assert.equal(unlisted.fleetQuotes,null);
  assert.deepEqual(unlisted.suggestion,group.suggestion);
});

test('market host estimates use comparable offers and the typical renter markup',()=>{
  const peers={samples:5,p25:.3,median:.4};
  assert.equal(priceSuggestion({peers,crossArch:true}),null);
  const onlyPeers=priceSuggestion({peers});
  assert.deepEqual(onlyPeers.host,{low:.24,high:.32});
  assert.equal(onlyPeers.confidence,'Limited');
  assert.equal(priceSuggestion({exact:{...peers,samples:2}}),null);
  assert.equal(priceSuggestion({exact:peers}).confidence,'Moderate');
  const defaults=readConfig({});
  assert.equal(defaults.marketEnabled,true);
  assert.equal(defaults.deviceRatesEnabled,true);
  const disabled=readConfig({MARKET_ENABLED:'0',DEVICES_PRIVATE:'0'});
  assert.equal(disabled.marketEnabled,false);
  assert.equal(disabled.deviceRatesEnabled,false);
});

test('watching a model reuses the catalogue and coalesces one offer sample per cache window',async()=>{
  let currentTime=time,metricsCalls=0,catalogueCalls=0;
  const offers=[];
  const api={
    async gpuNames(){
      catalogueCalls++;
      return {gpu_names:['RTX 4090','RTX 4070 laptop']};
    },
    async gpuMetrics(){
      metricsCalls++;
      return {gpus:[{gpu_name:'RTX 4090',rented_verified:100,avail_verified:4,unavail_verified:0,
        rented_unverified:10,avail_unverified:3,unavail_unverified:0,usage_30d:80}]};
    },
    async offers(filters){
      const model=filters.gpu_name.eq;
      offers.push(model);
      assert.equal(filters.limit,60);
      return {offers:[{machine_id:31,host_id:41,gpu_name:model,num_gpus:2,dph_base:.8,
        rentable:true,rented:false,verification:'verified'}]};
    }
  };
  const market=createMarket({api,machines:async()=>({machines:[]}),status:()=>null,seed,now:()=>currentTime});
  market.read();await market.close();
  assert.deepEqual(market.read().snapshot.models,['RTX 4070 laptop','RTX 4090']);
  assert.equal(metricsCalls,2);assert.equal(catalogueCalls,1);assert.deepEqual(offers,[]);
  const selected=['RTX 4090','rtx_4090','RTX 4070 laptop','Unknown'];
  assert.equal(market.read(selected).refreshing,true);
  market.read(selected);await market.close();
  const [watched,laptop,unknown]=market.read(selected).watched;
  assert.equal(watched.market.verified.available,4);
  assert.equal(watched.prices.verified.median,.4);
  assert.equal(laptop.market,null);
  assert.equal(laptop.prices.verified.median,.4);
  assert.equal(unknown.prices,null);
  assert.equal(metricsCalls,2);assert.deepEqual(offers,['RTX 4090','RTX 4070 laptop']);
  currentTime+=15*60_000;
  market.read();await market.close();
  assert.equal(offers.length,2);assert.equal(catalogueCalls,1);
  market.read(['RTX 4090']);await market.close();
  assert.equal(offers.length,3);
  currentTime=time+24*60*60_000;
  market.read();await market.close();
  assert.equal(catalogueCalls,2);
});

test('sparse laptop pricing searches both directions, retains a farther faster match, and anchors to direct asks',async()=>{
  const model='RTX 4070 laptop';
  let searches=0,currentTime=time,hasFasterPeer=true;
  const offer=(name,host,dlperf,usd,ram=8192)=>({
    gpu_name:name,host_id:host,machine_id:host,num_gpus:1,gpu_ram:ram,dlperf,dph_base:usd,
    cpu_arch:'amd64',verification:'verified',rentable:true,rented:false
  });
  const api={
    async gpuNames(){return {gpu_names:[model]};},
    async gpuMetrics(){return {gpus:[]};},
    async offers(filters){
      searches++;
      if(filters.gpu_name)return {offers:[offer(model,1,10,.15)]};
      assert.equal(filters.limit,30);
      if(filters.dlperf.gt){
        assert.equal(filters.dlperf.gt,10);
        assert.deepEqual(filters.order,[['dlperf','asc']]);
        return {offers:hasFasterPeer?[offer('RTX 4060',4,14,.24)]:[]};
      }
      assert.equal(filters.dlperf.lte,10);
      assert.deepEqual(filters.order,[['dlperf','desc']]);
      return {offers:[
        offer('RTX 4060 laptop',2,8,.12),offer('RTX 4060 laptop',2,7,.10),
        offer('RTX 3060 Ti',3,8,.16),offer('RTX 3060 laptop',7,9,.14),
        offer('RTX 2060',5,6,.1),offer('RTX 3060',6,10,.4,24000)
      ]};
    }
  };
  const market=createMarket({api,machines:async()=>({machines:[]}),status:()=>null,seed,now:()=>currentTime});
  market.read();await market.close();
  market.read([model]);market.read([model]);await market.close();
  const prices=market.read([model]).watched[0].prices;
  assert.equal(searches,3);
  assert.equal(prices.all.median,.15);
  const estimate=prices.peers.estimate;
  assert.equal(estimate.prices.samples,4);
  assert.equal(estimate.method,'interpolated');
  assert.equal(estimate.mixedClass,true);
  assert.equal(estimate.exactHosts,1);
  assert.deepEqual(estimate.models.map(peer=>peer.name).sort(),['RTX 3060 Ti','RTX 3060 laptop','RTX 4060','RTX 4060 laptop']);
  assert.ok(Math.abs(estimate.prices.median-(.15+(.14*2+.24)/3)/2)<1e-9);
  hasFasterPeer=false;
  currentTime+=15*60_000;
  market.read([model]);await market.close();
  const extrapolated=market.read([model]).watched[0].prices.peers.estimate;
  assert.equal(searches,6);
  assert.equal(extrapolated.method,'extrapolated');
  assert.ok(extrapolated.range.high-extrapolated.range.low>estimate.range.high-estimate.range.low);
});
