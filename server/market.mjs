import {machineState} from '../scripts/collect.mjs';
import {discoverMachines} from '../scripts/history-discovery.mjs';

const MIN_HOSTS=3, SAMPLE_LIMIT=60, REFRESH_MS=15*60_000, RETRY_MS=5*60_000, CATALOGUE_MS=24*60*60_000;
export const marketWatchLimit=8;
const positive=value=>Number.isFinite(value)&&value>0;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const country=value=>typeof value==='string'?/(?:^|,\s*)([A-Z]{2})$/.exec(value.trim())?.[1]??null:null;
const architecture=value=>['aarch64','arm64'].includes(value)?'arm64':['x86_64','amd64'].includes(value)?'amd64':null;
const knownVerification=value=>['verified','unverified','deverified'].includes(value)?value:null;
const modelKey=name=>name.trim().replace(/[ _]+/g,' ').toLowerCase();
const quantile=(sorted,p)=>{
  const at=(sorted.length-1)*p,low=Math.floor(at);
  return sorted[low]+(sorted[Math.ceil(at)]-sorted[low])*(at-low);
};
function distribution(values){
  const sorted=values.filter(value=>Number.isFinite(value)&&value>=0).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  return {samples:sorted.length,min:sorted[0],p25:quantile(sorted,.25),median:quantile(sorted,.5),p75:quantile(sorted,.75),max:sorted.at(-1)};
}

function offerRows(response){
  if(!Array.isArray(response?.offers))throw Error('Invalid offer response');
  return response.offers.flatMap(row=>{
    const machine=String(row.machine_id),gpus=count(row.num_gpus);
    if(!/^\d+$/.test(machine)||!gpus||!positive(row.dph_base)||typeof row.gpu_name!=='string'||!row.gpu_name.trim())return [];
    return [{machine,host:row.host_id==null?'machine:'+machine:'host:'+row.host_id,model:row.gpu_name.replaceAll('_',' ').slice(0,96),gpus,
      usd:row.dph_base/gpus,dlperf:positive(row.dlperf)?row.dlperf/gpus:null,ram:positive(row.gpu_ram)?row.gpu_ram:null,
      arch:architecture(row.cpu_arch),verification:knownVerification(row.verification),country:country(row.geolocation),
      reliability:Number.isFinite(row.reliability)&&row.reliability>=0&&row.reliability<=1?row.reliability:null,
      available:row.rentable===true&&row.rented===false}];
  });
}

function offerPrices(offers,price=offer=>offer.usd){
  const byHost=new Map();
  for(const offer of offers){
    if(!byHost.has(offer.host))byHost.set(offer.host,[]);
    byHost.get(offer.host).push(price(offer));
  }
  return distribution([...byHost.values()].map(values=>distribution(values)?.median));
}

function marketMetrics(verifiedRow,unverifiedRow){
  const row=verifiedRow??unverifiedRow;
  if(!row)return null;
  // The split counts are present on either filtered response. Historical
  // usage applies only to the verification filter of that response.
  const value=key=>count(row[key+'_gpus']??row[key]);
  const usage30=source=>Number.isFinite(source?.usage_30d)&&source.usage_30d>=0&&source.usage_30d<=100?source.usage_30d/100:null;
  const cohort=(key,source)=>({rented:value('rented_'+key),available:value('avail_'+key),unavailable:value('unavail_'+key),usage30:usage30(source)});
  const verified=cohort('verified',verifiedRow),unverified=cohort('unverified',unverifiedRow);
  const sum=(...counts)=>counts.every(Number.isFinite)?counts.reduce((a,b)=>a+b,0):null;
  const rented=sum(verified.rented,unverified.rented),available=sum(verified.available,unverified.available);
  const unavailable=sum(verified.unavailable,unverified.unavailable),total=sum(rented,available,unavailable);
  return {total,rented,available,unavailable,verified,unverified,rentedShare:total&&rented!==null?rented/total:null};
}

function ownProfiles(raw,status,seed,now,suspended){
  const rows=Array.isArray(raw)?raw:raw.machines;
  const byId=new Map(rows.map(row=>[String(row.id),row]));
  const byKey=new Map((status?.boxes||[]).map(box=>[box.deviceKey,box.lastSample]));
  const fresh=now-Date.parse(status?.updatedAt)<15*60_000;
  const groups=new Map();
  for(const device of discoverMachines(raw,{seed,previous:status?.boxes||[]})){
    if(!device.gpuModel||suspended?.has(device.deviceKey))continue;
    const row=byId.get(device.id),gpus=count(row.num_gpus);
    if(!gpus)continue;
    const bundle=count(row.listed_min_gpu_count)||gpus;
    const verification=knownVerification(row.verification),arch=architecture(row.cpu_arch);
    // The GB10 exposes shared memory as system RAM on the owner endpoint.
    const shared=modelKey(device.gpuModel)==='gb10';
    const ram=positive(row.gpu_ram)?row.gpu_ram:shared&&positive(row.cpu_ram)?row.cpu_ram:null;
    const key=JSON.stringify([modelKey(device.gpuModel),Math.min(bundle,gpus),arch,verification,ram&&Math.round(ram/4096)]);
    if(!groups.has(key))groups.set(key,{model:device.gpuModel,bundle:Math.min(bundle,gpus),arch,verification,shared,devices:[]});
    const sample=byKey.get(device.deviceKey),state=machineState(row,now);
    const active=state.connection==='offline'?0:fresh?count(sample?.earnings?.runningGpuCount):null;
    const compute=sample?.earnings?.computeUsdPerHour;
    groups.get(key).devices.push({id:device.id,name:device.name,gpus,ram,country:country(row.geolocation),listed:state.listed,
      reliability:Number.isFinite(row.reliability2)&&row.reliability2>=0&&row.reliability2<=1?row.reliability2:null,
      ask:Number.isFinite(row.listed_gpu_cost)&&row.listed_gpu_cost>=0?row.listed_gpu_cost:null,
      active,booked:active>0&&Number.isFinite(compute)&&compute>=0?compute/active:null});
  }
  return {groups:[...groups.values()],ids:new Set(byId.keys())};
}

const bounds=(value,low,high)=>({gte:value*low,lte:value*high});
const peerMemory=[.6,1.6],peerPerformance=[.55,1.7];
const laptop=model=>/\blaptop\b/.test(modelKey(model));
const within=(value,target,[low,high])=>value>=target*low&&value<=target*high;
const sameModelWeight=exact=>exact.samples/(exact.samples+1);
function qualityMatch(offer,profile,reliabilityFloor){
  return (!profile.verification||offer.verification===profile.verification)&&offer.reliability!==null&&offer.reliability>=reliabilityFloor;
}

function estimatePeers(offers,target,exact){
  const isLaptop=laptop(target.model);
  const slowerThanTarget=offer=>offer.dlperf<target.dlperf;
  const fasterThanTarget=offer=>offer.dlperf>target.dlperf;
  const candidates=offers.map(offer=>{
    const mixedClass=laptop(offer.model)!==isLaptop;
    const crossArch=!!target.arch&&offer.arch!==target.arch;
    const otherVerification=target.verification&&offer.verification!==target.verification;
    const distance=Math.abs(Math.log(offer.ram/target.ram))+Math.abs(Math.log(offer.dlperf/target.dlperf))
      +(mixedClass ? .25 : 0)+(crossArch ? .35 : 0)+(otherVerification ? .15 : 0);
    return {offer,distance,mixedClass,crossArch};
  }).sort((a,b)=>a.distance-b.distance);
  const byHost=new Map();
  for(const item of candidates){
    if(!byHost.has(item.offer.host))byHost.set(item.offer.host,item);
  }
  let distinct=[...byHost.values()];
  const sameArchitecture=distinct.filter(item=>target.arch&&!item.crossArch);
  // Keep access to both sides of a price bracket when the closer architecture
  // alone only has offers on one side.
  if(sameArchitecture.length>=MIN_HOSTS&&[slowerThanTarget,fasterThanTarget].every(side=>
    !distinct.some(item=>side(item.offer))||sameArchitecture.some(item=>side(item.offer))))distinct=sameArchitecture;
  if(distinct.length<MIN_HOSTS)return null;
  const closest=distinct.filter(item=>item.distance<=distinct[MIN_HOSTS-1].distance+1e-8);
  for(const side of [slowerThanTarget,fasterThanTarget]){
    if(closest.some(item=>side(item.offer)))continue;
    const nearest=distinct.find(item=>side(item.offer));
    if(nearest)closest.push(nearest);
  }
  const peers=closest.map(item=>item.offer);
  const slower=peers.filter(slowerThanTarget),faster=peers.filter(fasterThanTarget);
  let method='near',prices;
  if(slower.length&&faster.length){
    method='interpolated';
    const lowerScore=distribution(slower.map(offer=>offer.dlperf)).median;
    const upperScore=distribution(faster.map(offer=>offer.dlperf)).median;
    const weight=(target.dlperf-lowerScore)/(upperScore-lowerScore);
    const lower=offerPrices(slower),upper=offerPrices(faster);
    prices={samples:peers.length};
    for(const key of ['min','p25','median','p75','max'])prices[key]=lower[key]*(1-weight)+upper[key]*weight;
  }else{
    if(peers.some(offer=>!within(offer.dlperf,target.dlperf,[.97,1.03])))method='extrapolated';
    prices=offerPrices(peers,offer=>offer.usd*target.dlperf/offer.dlperf);
  }
  if(exact){
    const weight=sameModelWeight(exact);
    for(const key of ['min','p25','median','p75','max'])prices[key]=prices[key]*(1-weight)+exact[key]*weight;
  }
  const spread=method==='extrapolated' ? .15 : .05;
  const models=new Map();
  for(const offer of peers){
    const rows=models.get(offer.model)??[];
    rows.push(offer);
    models.set(offer.model,rows);
  }
  return {prices,method,exactHosts:exact?.samples??0,range:{low:Math.min(prices.p25,prices.median*(1-spread)),high:Math.max(prices.p75,prices.median*(1+spread))},
    mixedClass:closest.some(item=>item.mixedClass),crossArch:closest.some(item=>item.crossArch),
    models:[...models].map(([name,rows])=>({name,prices:offerPrices(rows)})).sort((a,b)=>b.prices.samples-a.prices.samples)};
}

async function samplePeers(api,target,excludedIds,floor=null,exact=null){
  const limit=SAMPLE_LIMIT/2,score=target.dlperf*target.bundle;
  const filters={limit,num_gpus:{eq:target.bundle},rentable:{eq:true},rented:{eq:false},
    gpu_ram:bounds(target.ram,...peerMemory),
    ...(floor!==null?{reliability:{gte:floor},...(target.verification?{verification:{eq:target.verification}}:{})}:{})};
  const below=await api.offers({...filters,dlperf:{gte:score*peerPerformance[0],lte:score},order:[['dlperf','desc']]});
  const above=await api.offers({...filters,dlperf:{gt:score,lte:score*peerPerformance[1]},order:[['dlperf','asc']]});
  const offers=[...offerRows(below),...offerRows(above)].filter(offer=>offer.available&&!excludedIds.has(offer.machine)
    &&modelKey(offer.model)!==modelKey(target.model)&&offer.gpus===target.bundle
    &&(floor===null||qualityMatch(offer,target,floor))
    &&within(offer.ram,target.ram,peerMemory)&&within(offer.dlperf,target.dlperf,peerPerformance));
  return {estimate:estimatePeers(offers,target,exact),limited:[below,above].some(raw=>raw.truncated===true||raw.offers.length>=limit)};
}

// Vast describes live renter GPU prices as typically about 25% above host earnings.
// https://vast.ai/article/how-much-money-can-you-earn-renting-out-your-gpu-on-vast-ai
const typicalRenterMultiplier=1.25;
export function priceSuggestion({exact,peers,crossArch=false}){
  const usePeers=(exact?.samples??0)<MIN_HOSTS&&!!peers;
  const market=usePeers?peers:exact;
  if((market?.samples??0)<MIN_HOSTS||(usePeers&&crossArch&&!positive(exact?.median)))return null;
  let {p25:low,median:high}=market;
  if(usePeers&&exact){
    const weight=sameModelWeight(exact);
    low=low*(1-weight)+exact.p25*weight;
    high=high*(1-weight)+exact.median*weight;
  }
  if(!positive(high))return null;
  // Avoid presenting a single data point as a precise target range.
  if(high-low<high*.05)low=high*.95;
  return {host:{low:low/typicalRenterMultiplier,high:high/typicalRenterMultiplier},
    exact:!!exact,peers:usePeers,confidence:usePeers?'Limited':'Moderate'};
}

function snapshotCache(collect,now,refreshMs=REFRESH_MS){
  let snapshot=null,pending=null,next=0,failed=false;
  return {
    read(){
      if(!pending&&now()>=next){
        pending=collect().then(value=>{
          if(!snapshot||!value.unavailable)snapshot=value;
          failed=value.unavailable;
          next=now()+(value.partial?RETRY_MS:refreshMs);
        },()=>{
          failed=true;next=now()+RETRY_MS;
        }).finally(()=>{pending=null;});
      }
      return {snapshot,refreshing:!!pending,failed};
    },
    async close(){await pending;}
  };
}

export function createMarket({api,machines,status,seed,now=Date.now}){
  const gpuNames=snapshotCache(async()=>{
    const response=await api.gpuNames();
    if(response?.success===false||!Array.isArray(response?.gpu_names))throw Error('Invalid GPU catalogue');
    const models=response.gpu_names.filter(name=>typeof name==='string'&&name.trim()&&name.length<=96);
    if(!models.length)throw Error('Empty GPU catalogue');
    return {models};
  },now,CATALOGUE_MS);
  const makeFleetCache=suspended=>snapshotCache(async()=>{
    const started=now(),fleet=await machines(),current=status();
    const {groups,ids}=ownProfiles(fleet,current,seed,started,suspended);
    let partial=false,succeeded=0;
    async function read(task,parse){
      try{const value=parse(await task());succeeded++;return value;}catch{partial=true;return null;}
    }
    const readMetrics=verification=>read(()=>api.gpuMetrics(verification),response=>{
      if(!Array.isArray(response?.gpus)||response.success===false)throw Error('Invalid GPU metrics');
      return new Map(response.gpus.filter(row=>typeof row.gpu_name==='string').map(row=>[modelKey(row.gpu_name),row]));
    });
    const verifiedMetrics=await readMetrics('yes');
    const unverifiedMetrics=await readMetrics('no');
    const catalogue=new Map();
    for(const key of new Set([...(verifiedMetrics?.keys()??[]),...(unverifiedMetrics?.keys()??[])])){
      const verified=verifiedMetrics?.get(key),unverified=unverifiedMetrics?.get(key);
      const model=(verified??unverified).gpu_name;
      if(key&&model.length<=96)catalogue.set(key,{model,market:marketMetrics(verified,unverified)});
    }
    const exactByProfile=new Map(),quotes=new Map();
    const allProfiles=[];
    for(const profile of groups){
      const model=modelKey(profile.model),queryKey=JSON.stringify([model,profile.bundle]);
      if(!exactByProfile.has(queryKey))exactByProfile.set(queryKey,await read(
        ()=>api.offers({limit:SAMPLE_LIMIT,gpu_name:{eq:profile.model.replaceAll('_',' ')},num_gpus:{eq:profile.bundle},rentable:{eq:true},rented:{eq:false}}),
        raw=>({offers:offerRows(raw).filter(row=>row.available&&modelKey(row.model)===model&&row.gpus===profile.bundle&&!ids.has(row.machine)),limited:raw.truncated===true||raw.offers.length>=SAMPLE_LIMIT})
      ));
      allProfiles.push({profile,model,direct:exactByProfile.get(queryKey)});
    }
    // One bounded own-offer lookup also works for some fully booked hosts.
    const listedIds=groups.flatMap(p=>p.devices.filter(d=>d.listed&&positive(d.ask)).map(d=>Number(d.id))).filter(Number.isSafeInteger).slice(0,SAMPLE_LIMIT);
    if(listedIds.length){
      const own=await read(()=>api.offers({limit:SAMPLE_LIMIT,machine_id:{in:listedIds}}),offerRows);
      for(const offer of own||[])if(ids.has(offer.machine))quotes.set(offer.machine,[...(quotes.get(offer.machine)||[]),offer]);
    }
    const cards=[];
    for(const {profile,model,direct} of allProfiles){
      const verifiedRow=verifiedMetrics?.get(model),unverifiedRow=unverifiedMetrics?.get(model);
      const rawMetrics=profile.verification==='verified'?verifiedRow??unverifiedRow:unverifiedRow??verifiedRow;
      const ownQuotes=new Map(profile.devices.map(device=>[device.id,quotes.get(device.id)?.find(o=>modelKey(o.model)===model&&o.gpus===profile.bundle)??null]));
      const offers=direct?.offers??[];
      const hardwareMatches=offers.filter(offer=>!profile.arch||offer.arch===profile.arch);
      const ram=distribution(profile.devices.map(device=>device.ram))?.median
        ??distribution(hardwareMatches.map(offer=>offer.ram))?.median;
      const dlperf=distribution(hardwareMatches.map(offer=>offer.dlperf))?.median
        ??(positive(rawMetrics?.dlperf)?rawMetrics.dlperf:null);
      const reliability=distribution(profile.devices.map(d=>d.reliability));
      const floor=Math.max(.95,(reliability?.median??.97)-.02);
      const matches=hardwareMatches.filter(offer=>qualityMatch(offer,profile,floor)
        &&(!ram||(offer.ram>=ram*.8&&offer.ram<=ram*1.25)));
      const countries=new Set(profile.devices.map(d=>d.country).filter(Boolean));
      const local=matches.filter(o=>countries.has(o.country)),localPrices=offerPrices(local);
      const preferLocal=(localPrices?.samples??0)>=MIN_HOSTS;
      const exact=preferLocal?localPrices:offerPrices(matches);
      let peerResult=null;
      if((exact?.samples??0)<MIN_HOSTS&&positive(ram)&&positive(dlperf)){
        peerResult=await read(()=>samplePeers(api,{...profile,ram,dlperf},ids,floor),value=>value);
      }
      const peerEstimate=peerResult?.estimate;
      const peerPrices=peerEstimate?.prices??null;
      const crossArch=!!peerEstimate&&(!profile.arch||peerEstimate.crossArch);
      const suggestion=priceSuggestion({exact,peers:peerPrices,crossArch});
      const fleetQuotes=distribution([...ownQuotes.values()].map(offer=>offer?.usd));
      const devices=profile.devices.map(({id,name,gpus,listed,reliability,ask,active,booked,country})=>({
        name,gpus,listed,reliability,ask,active,booked,country,quote:ownQuotes.get(id)?.usd??null
      }));
      cards.push({model:profile.model,bundle:profile.bundle,arch:profile.arch,verification:profile.verification,shared:profile.shared,
        ram,dlperf,floor,market:marketMetrics(verifiedRow,unverifiedRow),devices,fleetQuotes,
        asking:offerPrices(offers),exact,scope:preferLocal?[...countries].join(', '):'Global',sampleLimited:direct?.limited??false,offersFailed:direct===null,
        peers:peerPrices,peerScope:crossArch?'Mixed CPU architectures':profile.arch,
        peerStatus:peerResult?'checked':(exact?.samples??0)>=MIN_HOSTS?'not needed':positive(ram)&&positive(dlperf)?'unavailable':'missing specs',
        peerLimited:peerResult?.limited??false,peerModels:peerEstimate?.models.slice(0,5)??[],
        peerMethod:peerEstimate?.method??null,peerMixedClass:peerEstimate?.mixedClass??false,suggestion});
    }
    return {updatedAt:new Date(now()).toISOString(),fleetUpdatedAt:current?.updatedAt??null,groups:cards,catalogue,partial,unavailable:succeeded===0};
  },now);
  const base=makeFleetCache();
  let activeScope,activeCache;
  const retired=new Set();

  const quoteCaches=new Map();
  let quoteQueue=Promise.resolve();
  function watchedPrices(key,model){
    if(!quoteCaches.has(key))quoteCaches.set(key,snapshotCache(()=>{
      // Separate models get separate bounded samples, queued one at a time.
      const request=quoteQueue.then(async()=>{
        const raw=await api.offers({limit:SAMPLE_LIMIT,gpu_name:{eq:model},rentable:{eq:true},rented:{eq:false}});
        const offers=offerRows(raw).filter(offer=>offer.available&&modelKey(offer.model)===key);
        const all=offerPrices(offers);
        let peers=null;
        if((all?.samples??0)<MIN_HOSTS){
          const reference=offers.filter(offer=>positive(offer.ram)&&positive(offer.dlperf)).sort((a,b)=>a.gpus-b.gpus)[0];
          if(reference){
            const target={...reference,bundle:reference.gpus};
            const exact=offerPrices(offers.filter(offer=>offer.gpus===target.bundle));
            try{peers=await samplePeers(api,target,new Set(),null,exact);}catch{peers={failed:true};}
          }
        }
        return {
          updatedAt:new Date(now()).toISOString(),all,peers,
          verified:offerPrices(offers.filter(offer=>offer.verification==='verified')),
          unverified:offerPrices(offers.filter(offer=>offer.verification==='unverified'||offer.verification==='deverified')),
          limited:raw.truncated===true||raw.offers.length>=SAMPLE_LIMIT
        };
      });
      quoteQueue=request.catch(()=>{});
      return request;
    },now));
    return quoteCaches.get(key).read();
  }

  return {
    read(models=[],suspended){
      if(suspended?.size&&activeScope!==suspended){
        if(activeCache){
          const closing=activeCache.close();
          retired.add(closing);
          closing.finally(()=>retired.delete(closing));
        }
        activeScope=suspended;
        activeCache=makeFleetCache(suspended);
      }
      const result=(suspended?.size?activeCache:base).read();
      const names=gpuNames.read();
      const refreshing=result.refreshing||names.refreshing;
      if(!result.snapshot)return {...result,refreshing,watchLimit:marketWatchLimit,watched:[]};
      const {catalogue:metricsCatalogue,...snapshot}=result.snapshot;
      const catalogue=new Map(metricsCatalogue);
      for(const model of names.snapshot?.models??[]){
        const key=modelKey(model);
        catalogue.set(key,{model,market:metricsCatalogue.get(key)?.market??null});
      }
      const owned=new Set(snapshot.groups.map(group=>modelKey(group.model)));
      const watched=[],seen=new Set();
      for(const model of models.slice(0,marketWatchLimit)){
        if(typeof model!=='string'||!model.trim()||model.length>96)continue;
        const key=modelKey(model);
        if(seen.has(key)||owned.has(key))continue;
        seen.add(key);
        const entry=catalogue.get(key);
        const quotes=entry?watchedPrices(key,entry.model):null;
        watched.push({model:entry?.model??model,market:entry?.market??null,prices:quotes?.snapshot??null,
          refreshing:quotes?.refreshing??false,failed:quotes?.failed??false});
      }
      snapshot.models=[...catalogue.values()].map(item=>item.model).sort((a,b)=>a.localeCompare(b));
      return {...result,snapshot,watched,watchLimit:marketWatchLimit,refreshing:refreshing||watched.some(item=>item.refreshing)};
    },
    async close(){
      await Promise.all([base.close(),activeCache?.close(),gpuNames.close(),...retired]);
      await Promise.all([...quoteCaches.values()].map(cache=>cache.close()));
    }
  };
}
