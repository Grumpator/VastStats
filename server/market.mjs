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

function ownProfiles(raw,status,seed,now){
  const rows=Array.isArray(raw)?raw:raw.machines;
  const byId=new Map(rows.map(row=>[String(row.id),row]));
  const byKey=new Map((status?.boxes||[]).map(box=>[box.deviceKey,box.lastSample]));
  const fresh=now-Date.parse(status?.updatedAt)<15*60_000;
  const groups=new Map();
  for(const device of discoverMachines(raw,{seed,previous:status?.boxes||[]})){
    if(!device.gpuModel)continue;
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
function qualityMatch(offer,profile,reliabilityFloor){
  return (!profile.verification||offer.verification===profile.verification)&&offer.reliability!==null&&offer.reliability>=reliabilityFloor;
}

// Quotes use renter prices. Compare host and renter prices only where a
// matching fleet quote lets us observe the conversion for this cohort.
export function priceSuggestion({exact,peers,booked,conversion,crossArch=false}){
  const usePeers=(exact?.samples??0)<MIN_HOSTS&&!!peers;
  const market=usePeers?peers:exact;
  const sufficient=(market?.samples??0)>=MIN_HOSTS;
  const bookedMedian=conversion&&booked?.samples>=2?booked.median*conversion:null;
  if((!sufficient||usePeers&&crossArch&&(!exact||!positive(exact.median)))&&bookedMedian===null){
    if(booked?.samples<2||!positive(booked?.median))return null;
    return {renter:null,host:{low:Math.min(booked.p25,booked.median*.95),high:booked.median},
      exact:false,peers:false,booked:true,confidence:'Limited'};
  }
  let low=market?.p25??bookedMedian,high=market?.median??bookedMedian;
  if(bookedMedian!==null&&market){
    const weight=sufficient?2/3:1/3;
    low=low*weight+bookedMedian*(1-weight);
    high=high*weight+bookedMedian*(1-weight);
  }
  if(usePeers&&exact){
    low=low*.8+exact.p25*.2;
    high=high*.8+exact.median*.2;
  }
  if(!positive(high))return null;
  // Avoid presenting a single data point as a precise target range.
  if(high-low<high*.05)low=high*.95;
  return {renter:{low,high},host:conversion?{low:low/conversion,high:high/conversion}:null,
    exact:!!exact&&(!usePeers||exact.samples>0),peers:usePeers,booked:bookedMedian!==null,
    confidence:!usePeers&&sufficient&&bookedMedian!==null?'Moderate':'Limited'};
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
  const base=snapshotCache(async()=>{
    const started=now(),fleet=await machines(),current=status();
    const {groups,ids}=ownProfiles(fleet,current,seed,started);
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
      const ratios=profile.devices.flatMap(device=>{
        const quote=ownQuotes.get(device.id);
        return quote&&positive(device.ask)?[quote.usd/device.ask]:[];
      });
      const ratio=distribution(ratios);
      const conversion=ratio&&ratio.min>=1&&ratio.max<=2&&ratio.max/ratio.min<=1.05?ratio.median:null;
      const ram=distribution(profile.devices.map(device=>device.ram))?.median
        ??distribution([...ownQuotes.values()].map(o=>o?.ram))?.median;
      const dlperf=distribution([...ownQuotes.values()].map(o=>o?.dlperf))?.median??(positive(rawMetrics?.dlperf)?rawMetrics.dlperf:null);
      const reliability=distribution(profile.devices.map(d=>d.reliability));
      const floor=Math.max(.95,(reliability?.median??.97)-.02);
      const offers=direct?.offers??[],matches=offers.filter(offer=>qualityMatch(offer,profile,floor)
        &&(!profile.arch||offer.arch===profile.arch)&&(!ram||(offer.ram>=ram*.8&&offer.ram<=ram*1.25)));
      const countries=new Set(profile.devices.map(d=>d.country).filter(Boolean));
      const local=matches.filter(o=>countries.has(o.country)),localPrices=offerPrices(local);
      const preferLocal=(localPrices?.samples??0)>=MIN_HOSTS;
      const exact=preferLocal?localPrices:offerPrices(matches);
      let peerResult=null;
      if((exact?.samples??0)<MIN_HOSTS&&positive(ram)&&positive(dlperf)){
        peerResult=await read(
          ()=>api.offers({limit:SAMPLE_LIMIT,num_gpus:{eq:profile.bundle},rentable:{eq:true},rented:{eq:false},gpu_ram:bounds(ram,.8,1.25),dlperf:bounds(dlperf*profile.bundle,.7,1.3),reliability:{gte:floor},...(profile.verification?{verification:{eq:profile.verification}}:{})}),
          raw=>({offers:offerRows(raw).filter(o=>o.available&&!ids.has(o.machine)&&modelKey(o.model)!==model&&o.gpus===profile.bundle
            &&qualityMatch(o,profile,floor)&&o.ram>=ram*.8&&o.ram<=ram*1.25&&o.dlperf>=dlperf*.7&&o.dlperf<=dlperf*1.3),
            limited:raw.truncated===true||raw.offers.length>=SAMPLE_LIMIT})
        );
      }
      const similar=peerResult?.offers??[],sameArch=similar.filter(o=>o.arch&&o.arch===profile.arch);
      const useSameArch=(offerPrices(sameArch)?.samples??0)>=MIN_HOSTS;
      const peerPool=useSameArch?sameArch:similar;
      const crossArch=peerPool.some(o=>!profile.arch||o.arch!==profile.arch);
      const peerModels=new Map();
      for(const offer of peerPool)peerModels.set(offer.model,[...(peerModels.get(offer.model)||[]),offer]);
      const peerPrices=offerPrices(peerPool,offer=>offer.usd*dlperf/offer.dlperf);
      const booked=distribution(profile.devices.map(d=>d.booked));
      const suggestion=priceSuggestion({exact,peers:peerPrices,booked,conversion,crossArch});
      const fleetQuotes=distribution([...ownQuotes.values()].map(offer=>offer?.usd));
      const devices=profile.devices.map(({id,name,gpus,listed,reliability,ask,active,booked,country})=>({
        name,gpus,listed,reliability,ask,active,booked,country,quote:ownQuotes.get(id)?.usd??null
      }));
      cards.push({model:profile.model,bundle:profile.bundle,arch:profile.arch,verification:profile.verification,shared:profile.shared,
        ram,dlperf,floor,market:marketMetrics(verifiedRow,unverifiedRow),devices,fleetQuotes,quoteSamples:ratio?.samples??0,
        asking:offerPrices(offers),exact,scope:preferLocal?[...countries].join(', '):'Global',sampleLimited:direct?.limited??false,offersFailed:direct===null,
        peers:peerPrices,peerScope:crossArch?'Mixed CPU architectures':profile.arch,
        peerStatus:peerResult?'checked':(exact?.samples??0)>=MIN_HOSTS?'not needed':positive(ram)&&positive(dlperf)?'unavailable':'missing specs',
        peerLimited:peerResult?.limited??false,peerModels:[...peerModels].map(([name,rows])=>({name,prices:offerPrices(rows)}))
          .sort((a,b)=>b.prices.samples-a.prices.samples).slice(0,5),suggestion});
    }
    return {updatedAt:new Date(now()).toISOString(),fleetUpdatedAt:current?.updatedAt??null,groups:cards,catalogue,partial,unavailable:succeeded===0};
  },now);

  const quoteCaches=new Map();
  let quoteQueue=Promise.resolve();
  function watchedPrices(key,model){
    if(!quoteCaches.has(key))quoteCaches.set(key,snapshotCache(()=>{
      // Separate models get separate bounded samples, queued one at a time.
      const request=quoteQueue.then(async()=>{
        const raw=await api.offers({limit:SAMPLE_LIMIT,gpu_name:{eq:model},rentable:{eq:true},rented:{eq:false}});
        const offers=offerRows(raw).filter(offer=>offer.available&&modelKey(offer.model)===key);
        return {
          updatedAt:new Date(now()).toISOString(),all:offerPrices(offers),
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
    read(models=[]){
      const result=base.read();
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
      await Promise.all([base.close(),gpuNames.close()]);
      await Promise.all([...quoteCaches.values()].map(cache=>cache.close()));
    }
  };
}
