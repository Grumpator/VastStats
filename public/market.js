import {element,icon} from './ui.js?v=1.3.7';
import {bindPopover,closePopover} from './popover.js?v=1.3.7';
import {percentLabel,reliabilityLabel} from './model.js?v=1.3.7';
import {fleetURL} from './api.js?v=1.3.7';

const $=selector=>document.querySelector(selector);
const decimal=new Intl.NumberFormat('en-GB',{maximumFractionDigits:1});
const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:3});
const timestamp=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'});
const number=value=>Number.isFinite(value)?decimal.format(value):'—';
const price=value=>Number.isFinite(value)?dollars.format(value):'—';
const percent=value=>Number.isFinite(value)?percentLabel(value*100):'—';
const band=(low,high)=>price(low)+(low===high?'':'–'+price(high));
let lastDraw='',timer,loadGeneration=0,availableModels=[],watchLimit=8;
const expandedGroups=new Set();
const marketGroupKey=group=>JSON.stringify([group.model,group.bundle,group.arch,group.verification,group.ram]);
const watchKey='vaststats.market.watch';
const modelKey=model=>model.trim().replace(/[ _]+/g,' ').toLowerCase();
const addGpu=$('#market-watch-add');
let watchModels=[];
try{
  const saved=JSON.parse(localStorage.getItem(watchKey)??'[]');
  if(Array.isArray(saved))watchModels=saved.filter(model=>typeof model==='string'&&model.trim()&&model.length<=96).slice(0,watchLimit);
}catch{/* The watchlist still works for this tab if storage is unavailable. */}

function updateWatchlist(next){
  watchModels=next;
  try{localStorage.setItem(watchKey,JSON.stringify(next));}catch{/* Keep the in-memory selection. */}
  void load();
}

function selectableModels(){
  const watched=new Set(watchModels.map(modelKey));
  return availableModels.filter(model=>!watched.has(modelKey(model)));
}

bindPopover(addGpu,()=>{
  const content=element('div','market-watch-picker'),select=element('select'),add=element('button','refresh-button','Add to watchlist');
  select.setAttribute('aria-label','GPU model to watch');
  select.append(new Option('Choose a GPU…',''));
  for(const model of selectableModels())select.append(new Option(model,model));
  add.type='button';
  add.disabled=true;
  select.addEventListener('change',()=>{add.disabled=!select.value;});
  add.addEventListener('click',()=>{
    const model=select.value;
    if(!model||watchModels.length>=watchLimit||!selectableModels().includes(model))return;
    closePopover(true);
    updateWatchlist([...watchModels,model]);
  });
  content.append(select,add);
  return {title:'Watch a GPU',copy:'Watch up to '+watchLimit+' models in this browser.',content};
});

bindPopover($('#market-info'),()=>({title:'How Market compares prices',
  copy:'Supply counts GPUs worldwide across all bundle sizes. Price tables sample distinct hosts. Suggestions prioritise at least three same-model hosts, using close hardware and reliability matches first. Other GPU models are a fallback when same-model evidence is scarce. For five or more hosts, prices outside the quartiles by more than the greater of 1.5 times the interquartile range or 20% of the median are excluded from the suggestion. The lower quartile and median of the retained prices form the suggested band. Narrow price bands retain their samples. Tables and histograms show all sampled prices. Host rates are estimated using Vast’s typical renter markup of about 25%; the actual markup can vary. All compute rates are per GPU-hour, excluding storage and bandwidth.'}));

function table(caption,headers,rows){
  const wrapper=element('div','market-table-wrap'),node=element('table','market-table');
  node.setAttribute('aria-label',caption);
  const head=element('thead'),labels=element('tr');
  for(const value of headers){const cell=element('th','',value);cell.scope='col';labels.append(cell);}
  head.append(labels);
  const body=element('tbody');
  for(const values of rows){
    const row=element('tr');
    values.forEach((value,index)=>{
      const cell=element(index?'td':'th','',value);
      if(!index)cell.scope='row';
      row.append(cell);
    });
    body.append(row);
  }
  node.append(head,body);wrapper.append(node);return wrapper;
}

function supply(market){
  const section=element('div','market-supply');
  if(!market){section.append(element('p','market-note','Vast’s supply counts are unavailable for this model.'));return section;}
  const rows=[['Verified',market.verified],['Unverified',market.unverified]].map(([label,cohort])=>{
    const counts=[cohort.rented,cohort.available,cohort.unavailable];
    const total=counts.every(Number.isFinite)?counts.reduce((sum,count)=>sum+count,0):0;
    const rented=number(cohort.rented)+(total>0?' ('+percent(cohort.rented/total)+')':'');
    return [label,rented,number(cohort.available),number(cohort.unavailable),percent(cohort.usage30)];
  });
  section.append(table('Worldwide GPU supply by verification',['Verification','Rented GPUs','Available GPUs','Unavailable GPUs','30-day usage'],rows));
  return section;
}

function priceRow(label,sample,unavailable=false,multiplier=1){
  return [label,number(unavailable?null:sample?.samples??0),sample?price(sample.median/multiplier):'—',sample?band(sample.min/multiplier,sample.max/multiplier):'—'];
}

function priceHistogram(histograms,key,multiplier){
  const bins=histograms?.[key];
  if(!bins?.some(Boolean))return null;
  const chart=element('span','market-histogram');
  chart.setAttribute('role','img');
  const peak=Math.max(...histograms.sameModel,...histograms.comparable,...(histograms.occupied??[]));
  const width=(histograms.high-histograms.low)/bins.length;
  const descriptions=[];
  for(const [index,count] of bins.entries()){
    const bar=element('span','market-histogram-bar');
    bar.style.height=(count?Math.max(2,Math.round(16*count/peak)):0)+'px';
    if(count){
      const low=histograms.low+index*width;
      const high=index===bins.length-1?histograms.high:low+width;
      bar.title=band(low/multiplier,high/multiplier)+' · '+count+(count===1?' host':' hosts');
      descriptions.push(bar.title);
    }
    chart.append(bar);
  }
  chart.setAttribute('aria-label','Estimated host asking price distribution, low to high. '+descriptions.join('. '));
  return chart;
}

function watchPriceSummary(group){
  const box=element('div','market-suggestion');
  box.append(element('h3','','Market asking price'));
  if(group.prices?.all){
    const reading=element('div','market-target');
    const hosts=group.prices.all.samples;
    reading.append(element('strong','',price(group.prices.all.median)),element('span','','median per GPU-hour · '+number(hosts)+(hosts===1?' host':' hosts')));
    box.append(reading);
    if(group.failed)box.append(element('p','market-note','Showing saved offers.'));
  }else{
    const message=group.refreshing?'Checking available offers…':group.prices?'No available offers in the sample.':'Offer prices are unavailable.';
    box.append(element('p','market-note',message));
  }
  const estimate=group.prices?.peers?.estimate;
  if(estimate){
    const range=element('div','market-target market-estimate');
    range.append(element('strong','',band(estimate.range.low,estimate.range.high)),
      element('span','','Estimated market range · '+peerMethodLabel(estimate.method)));
    box.append(range);
  }
  return box;
}

function peerMethodLabel(method){
  return {near:'nearby matches',interpolated:'interpolated',extrapolated:'extrapolated, lower confidence'}[method];
}

function peerEvidence(models,mixedClass,crossArch){
  const names=models.map(peer=>peer.name+' ('+peer.prices.samples+')').join(', ');
  return 'Comparable models and host counts: '+names+'.'
    +(mixedClass?' Uses offers from a different laptop or desktop class.':'')
    +(crossArch?' Uses offers from a different CPU architecture.':'');
}

function watchPriceDetails(group){
  const section=element('div','market-prices');
  section.append(element('h3','','Available on-demand offers'));
  if(!group.prices){
    section.append(element('p','market-note',group.refreshing?'Checking available offers…':'Offer prices are unavailable.'));
    return section;
  }
  section.append(table('Watched GPU asking prices',['Verification','Hosts','Median','Range'],[
    priceRow('All sampled',group.prices.all),priceRow('Verified',group.prices.verified),priceRow('Unverified',group.prices.unverified)
  ]),element('p','market-note',group.prices.limited?'Limited sample of available offers. Prices are per GPU-hour.':'Prices are per GPU-hour across available bundle sizes.'));
  const peers=group.prices.peers;
  if(peers?.estimate){
    const {models,mixedClass,crossArch,exactHosts}=peers.estimate;
    const anchor=exactHosts?' The estimate also weighs '+number(exactHosts)+(exactHosts===1?' same-model host.':' same-model hosts.'):'';
    section.append(element('p','market-note',peerEvidence(models,mixedClass,crossArch)+anchor+(peers.limited?' Comparable offer sample was capped.':'')));
  }else if(peers){
    section.append(element('p','market-note',peers.failed?'The comparable offer search is temporarily unavailable.':'Too few comparable hosts to estimate a range.'));
  }
  return section;
}

function pricing(group){
  const section=element('div','market-prices');
  section.append(element('h3','','On-demand asking prices'));
  const multiplier=group.renterMultiplier??1.25;
  const rows=[priceRow('Same model · '+group.bundle+' '+(group.bundle===1?'GPU':'GPUs')+' per offer',group.asking,group.offersFailed,multiplier),
    priceRow('Comparable · '+group.scope,group.exact,group.offersFailed,multiplier)];
  if(group.occupied)rows.push(priceRow('Occupied machines · asking rates',group.occupied,false,multiplier));
  if(group.peers)rows.push(priceRow('Similar GPUs · '+peerMethodLabel(group.peerMethod),group.peers,false,multiplier));
  if(group.offersFailed)section.append(element('p','market-note','Same-model offer search is temporarily unavailable.'));
  const prices=table('Estimated host compute asking prices',['Estimated host $/GPU-hour','Sampled hosts','Host median','Host range'],rows);
  for(const [index,key] of ['sameModel','comparable',...(group.occupied?['occupied']:[])].entries()){
    const histogram=priceHistogram(group.priceHistograms,key,multiplier);
    if(histogram)prices.querySelector('tbody').rows[index].cells[3].prepend(histogram);
  }
  section.append(prices);
  const floor=percent(group.floor);
  const facts=['Host asking rates are estimated from public renter quotes using Vast’s typical surcharge. The same-model row includes all verification groups. Each host counts once. Comparable offers use a '+floor+' reliability floor.'];
  if(group.sampleLimited||group.peerLimited)facts.push('Search results are capped, so prices describe a sample.');
  if(group.peerStatus==='missing specs')facts.push('Vast did not report enough hardware data to match similar GPUs.');
  else if(group.peerStatus==='unavailable')facts.push('The similar-GPU search is temporarily unavailable.');
  else if(group.peerStatus==='checked'&&!group.peers)facts.push('No similar offers met the memory, DLPerf and quality filters.');
  if(group.peerModels.length)facts.push(peerEvidence(group.peerModels,group.peerMixedClass,group.peerScope==='Mixed CPU architectures'));
  if(group.fleetQuotes&&group.exact?.median>0){
    const difference=group.fleetQuotes.median/group.exact.median-1;
    facts.push('Your median renter quote is '+(Math.abs(difference)<.005?'in line with':percent(Math.abs(difference))+(difference>0?' above':' below'))+' the comparable renter quote median ('+group.fleetQuotes.samples+' fleet '+(group.fleetQuotes.samples===1?'quote).':'quotes).'));
  }
  section.append(element('p','market-note',facts.join(' ')));
  return section;
}

function suggestion(group,stale){
  const box=element('div','market-suggestion'),value=group.suggestion;
  box.append(element('h3','','Estimated host price'));
  if(stale||!value?.host){
    const message=stale?'Waiting for a fresh market snapshot.':'Too little comparable evidence for a range.';
    box.append(element('p','market-note',message));
    return box;
  }
  const reading=element('div','market-target');
  reading.append(element('strong','',band(value.host.low,value.host.high)),element('span','','per GPU-hour · '+value.confidence.toLowerCase()+' market evidence'));
  box.append(reading);
  return box;
}

function suggestionEvidence(group){
  const value=group.suggestion;
  const signals=[];
  if(value.exact)signals.push('same-model asks');
  if(value.occupied)signals.push('asks from occupied machines');
  if(value.peers)signals.push(group.peerScope==='Mixed CPU architectures'?'similar GPU asks across CPU architectures':'similar GPU asks');
  const removed=value.excludedHosts?' '+value.excludedHosts+' outlying host prices excluded from the suggestion.':'';
  return value.confidence+' evidence · '+signals.join(' + ')+'.'+removed+' The suggested band uses the lower quartile to the median of the retained host prices. Tables and histograms include the full sample. Host prices are estimated using Vast’s typical renter markup of about 25%.';
}

function availableOffers(offers,groupKey){
  const section=element('div','market-fleet');
  section.append(element('h3','','Available market devices'));
  if(!offers?.length){
    section.append(element('p','market-note','No available offers in this sample.'));
    return section;
  }
  const component=value=>Number.isFinite(value)?'$'+value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6}):'—';
  const columns=[
    ['id','Device ID','Vast machine ID.'],['gpus','GPUs','GPUs in this offer.'],
    ['country','Location','Country reported by Vast.'],['verification','Verification','Vast verification status.'],
    ['reliability','Reliability','Reliability percentage. Enter percentage bounds, for example 99.'],
    ['gpu','GPU $/GPU-h','Estimated host compute rate.'],['disk','Disk $/GB-month','Estimated host storage rate.'],
    ['upload','Upload $/GB','Estimated host upload rate.'],['download','Download $/GB','Estimated host download rate.']
  ];
  const wrapper=table('Available offers with estimated host asking rates',columns.map(([,label])=>label),
    offers.map(offer=>[number(offer.id),number(offer.gpus),offer.country??'—',offer.verification??'—',reliabilityLabel(offer.reliability),
      price(offer.gpu),component(offer.disk),component(offer.upload),component(offer.download)]));
  section.append(controlledTable(wrapper,columns,offers,groupKey+':available'));
  section.append(element('p','market-note','Estimated host rates from sampled public offers. The actual surcharge can vary.'));
  return section;
}

const fleetColumns=[
  ['id','Device ID','Vast machine ID.'],
  ['name','Device','The machine name. An unlisted machine is marked next to its name.'],
  ['active','Running GPUs','GPUs in active rentals out of the GPUs installed on the machine. Sorts by the number running.'],
  ['reliability','Reliability','Vast’s reliability score for the machine.'],
  ['ask','Host ask','The on-demand compute price you set for new rentals, in USD per GPU-hour.'],
  ['quote','Renter quote','The compute price Vast shows renters for a matching offer, in USD per GPU-hour including Vast’s surcharge. A dash means Vast didn’t return a matching offer.'],
  ['booked','Booked rate','What your active contracts pay you for compute, in USD per running GPU-hour. A dash means no running rate is available.']
];
const fleetSorts=new Map();
const tableFilters=new Map();
const deviceNames=new Intl.Collator('en-GB',{numeric:true,sensitivity:'base'});

function fleetTable(group){
  const wrapper=table('Your listing, renter quote and active contract prices',fleetColumns.map(([,label])=>label),group.devices.map(device=>[
    number(device.id),device.name+(device.listed===false?' · unlisted':''),number(device.active)+' / '+number(device.gpus),reliabilityLabel(device.reliability),
    device.listed===true?price(device.ask):'—',price(device.quote),price(device.booked)
  ]));
  return controlledTable(wrapper,fleetColumns,group.devices,marketGroupKey(group)+':fleet');
}

function controlledTable(wrapper,columns,devices,groupKey){
  const body=wrapper.querySelector('tbody');
  const rows=Array.from(body.rows,(row,index)=>({row,device:devices[index]}));
  const headers=Array.from(wrapper.querySelectorAll('thead th'));
  const indicators=[];
  const sortValue=(device,key)=>key==='ask'&&device.listed!==true?null:device[key];
  const defaultSort={key:columns.some(([key])=>key==='gpu')?'gpu':'ask',direction:'ascending'};
  if(!tableFilters.has(groupKey))tableFilters.set(groupKey,new Map());
  const filters=tableFilters.get(groupKey);

  function applySort({key,direction}){
    const ordered=[...rows].sort((a,b)=>{
      const left=sortValue(a.device,key),right=sortValue(b.device,key);
      if(left==null)return right==null?0:1;
      if(right==null)return -1;
      const comparison=typeof left==='string'?deviceNames.compare(left,right):left-right;
      return direction==='ascending'?comparison:-comparison;
    });
    body.replaceChildren(...ordered.filter(({device})=>[...filters].every(([field,filter])=>{
      const raw=sortValue(device,field),value=field==='reliability'&&raw!=null?raw*100:raw;
      if(typeof filter==='string'){
        if(field==='country'||field==='verification')return value===filter;
        return String(value??'').toLowerCase().includes(filter);
      }
      return Number.isFinite(value)&&(filter.min===null||value>=filter.min)&&(filter.max===null||value<=filter.max);
    })).map(({row})=>row));
    headers.forEach((header,index)=>{
      const active=columns[index][0]===key;
      if(active)header.setAttribute('aria-sort',direction);
      else header.removeAttribute('aria-sort');
      indicators[index].textContent=active?(direction==='ascending'?'↑':'↓'):'↕';
    });
  }

  headers.forEach((header,index)=>{
    const [key,label,copy]=columns[index];
    const controls=element('div','market-column-controls');
    const sort=element('button','market-column-sort',label);
    const indicator=element('span','market-column-indicator','↕');
    const help=element('button','metric-info','?');
    sort.type=help.type='button';
    sort.setAttribute('aria-label','Sort by '+label);
    indicator.setAttribute('aria-hidden','true');
    indicators.push(indicator);
    sort.append(indicator);
    sort.addEventListener('click',()=>{
      const previous=fleetSorts.get(groupKey);
      const direction=previous?.key===key&&previous.direction==='ascending'?'descending':'ascending';
      const next={key,direction};
      fleetSorts.set(groupKey,next);
      applySort(next);
    });
    help.setAttribute('aria-label','About '+label);
    bindPopover(help,()=>({title:label,copy}));
    const filter=element('button','inventory-filter');
    filter.type='button';filter.append(icon('filter'));
    filter.setAttribute('aria-label','Filter '+label);
    filter.classList.toggle('filtered',filters.has(key));
    bindPopover(filter,()=>{
      const content=element('div','inventory-filter-form');
      const apply=value=>{
        if(value===null||value==='')filters.delete(key);else filters.set(key,value);
        filter.classList.toggle('filtered',filters.has(key));
        applySort(fleetSorts.get(groupKey)??defaultSort);
      };
      if(key==='country'||key==='verification'){
        const select=element('select');
        select.setAttribute('aria-label',label+' filter');
        select.append(new Option('Any',''));
        const values=[...new Set(devices.map(device=>device[key]).filter(Boolean))].sort();
        for(const value of values)select.append(new Option(value,value));
        select.value=filters.get(key)??'';
        select.onchange=()=>apply(select.value);
        content.append(select);
      }else if(key==='name'){
        const input=element('input');input.type='search';input.value=filters.get(key)??'';
        input.setAttribute('aria-label',label+' contains');
        input.oninput=()=>apply(input.value.trim().toLowerCase());content.append(input);
      }else{
        const inputs={};
        for(const [bound,title] of [['min','Minimum'],['max','Maximum']]){
          const field=element('label','',title),input=element('input');
          input.type='number';input.step='any';input.value=filters.get(key)?.[bound]??'';
          input.setAttribute('aria-label',title+' '+label);inputs[bound]=input;
          input.oninput=()=>{
            const min=Number.isFinite(inputs.min.valueAsNumber)?inputs.min.valueAsNumber:null;
            const max=Number.isFinite(inputs.max.valueAsNumber)?inputs.max.valueAsNumber:null;
            apply(min===null&&max===null?null:{min,max});
          };
          field.append(input);content.append(field);
        }
      }
      const clear=element('button','text-button','Clear this filter');clear.type='button';
      clear.onclick=()=>{apply(null);closePopover(true);};content.append(clear);
      return {title:'Filter '+label,copy,content};
    });
    controls.append(sort,filter,help);
    header.replaceChildren(controls);
  });
  const initial=fleetSorts.get(groupKey);
  applySort(initial??defaultSort);
  return wrapper;
}

function groupCard(group,stale,index){
  const section=element('section','market-card'),head=element('div','market-card-heading');
  const identity=element('div','market-card-identity'),actions=element('div','market-heading-actions');
  const heading=element('h2','',group.model),toggle=element('button','market-card-toggle');
  toggle.type='button';
  toggle.setAttribute('aria-label',group.model+' market details');
  const details=element('div','market-card-details');
  details.id='market-card-details-'+index;
  toggle.setAttribute('aria-controls',details.id);
  const key=group.isWatched?'watch:'+modelKey(group.model):marketGroupKey(group);
  function showDetails(open){
    details.hidden=!open;
    toggle.setAttribute('aria-expanded',String(open));
    if(open&&!details.childElementCount){
      if(group.isWatched){
        details.append(watchPriceDetails(group),availableOffers(group.prices?.availableOffers,key));
        return;
      }
      const own=element('div','market-fleet');
      own.append(element('h3','','Your fleet'),fleetTable(group));
      details.append(pricing(group),own,availableOffers(group.availableOffers,key));
      if(!stale&&group.suggestion?.host)details.append(element('p','market-note',suggestionEvidence(group)));
    }
  }
  toggle.addEventListener('click',()=>{
    const open=!expandedGroups.has(key);
    if(open)expandedGroups.add(key);
    else expandedGroups.delete(key);
    showDetails(open);
  });
  const specs=[group.bundle+' GPU per offer',group.arch,group.verification,
    group.ram?number(Math.round(group.ram/1024))+' GiB '+(group.shared?'unified memory':'VRAM'):null,
    group.dlperf?number(group.dlperf)+' DLPerf/GPU':null].filter(Boolean);
  identity.append(heading);
  if(Number.isFinite(group.market?.total)){
    const rented=Number.isFinite(group.market.rentedShare)?' · '+percent(group.market.rentedShare)+' rented now':'';
    identity.append(element('p','market-note',number(group.market.total)+' GPUs in total'+rented));
  }
  if(group.isWatched){
    const remove=element('button','text-button','Remove');
    remove.type='button';
    remove.setAttribute('aria-label','Remove '+group.model+' from watchlist');
    bindPopover(remove,()=>{
      const buttons=element('div','market-watch-confirm'),cancel=element('button','refresh-button','Cancel');
      const confirm=element('button','refresh-button','Remove GPU');
      cancel.type=confirm.type='button';
      cancel.addEventListener('click',()=>closePopover(true));
      confirm.addEventListener('click',()=>{
        closePopover();
        expandedGroups.delete(key);
        updateWatchlist(watchModels.filter(model=>modelKey(model)!==modelKey(group.model)));
      });
      buttons.append(cancel,confirm);
      return {title:'Remove '+group.model+' from your watchlist?',content:buttons};
    });
    identity.append(element('span','market-note','Watchlist'));
    actions.append(remove);
  }else identity.append(element('p','market-note',specs.join(' · ')));
  actions.append(toggle);
  head.append(identity,actions);
  const summary=element('div','market-card-summary');
  summary.append(supply(group.market),group.isWatched?watchPriceSummary(group):suggestion(group,stale));
  showDetails(expandedGroups.has(key));
  section.append(head,summary,details);
  return section;
}

function render(data){
  const notice=$('#market-notice'),freshness=$('#freshness'),host=$('#market-groups'),snapshot=data.snapshot;
  $('#market-progress').hidden=!data.enabled||!data.refreshing;
  const owned=new Set((snapshot?.groups??[]).map(group=>modelKey(group.model)));
  availableModels=(snapshot?.models??[]).filter(model=>!owned.has(modelKey(model)));
  watchLimit=data.watchLimit??watchLimit;
  addGpu.disabled=!data.enabled||watchModels.length>=watchLimit||!selectableModels().length;
  addGpu.title=watchModels.length>=watchLimit?'Watchlist is full':'Choose a GPU model to watch';
  if(!data.enabled){
    notice.textContent='Market needs a configured Vast API key and the Market setting enabled.';
    freshness.textContent='Market collection is disabled.';host.replaceChildren();lastDraw='';return;
  }
  if(!snapshot){
    notice.textContent=data.failed?'Couldn’t load the marketplace. VastStats will retry shortly.':'Checking Vast marketplace data…';
    freshness.textContent=notice.textContent;return;
  }
  const stale=data.failed||Date.now()-Date.parse(snapshot.updatedAt)>20*60_000;
  const watched=data.watched??[];
  notice.textContent=snapshot.unavailable?'Vast’s marketplace sources are temporarily unavailable.':stale?'Showing the last market snapshot.':snapshot.partial?'Some marketplace sources are temporarily unavailable.':!snapshot.groups.length&&!watched.length?'Add a GPU to start watching the market.':'';
  freshness.textContent='Market checked '+timestamp.format(Date.parse(snapshot.updatedAt))+' (London)'+(snapshot.partial?' · partial':stale?' · overdue':'')+'.'+
    (snapshot.fleetUpdatedAt?' Running contract rates checked '+timestamp.format(Date.parse(snapshot.fleetUpdatedAt))+' (London).':'');
  $('.freshness').classList.toggle('live',!stale&&!snapshot.partial);
  const key=JSON.stringify([fleetURL(''),snapshot.updatedAt,stale,watched.map(item=>[item.model,item.prices?.updatedAt,item.refreshing,item.failed])]);
  if(key!==lastDraw){
    const cards=[...snapshot.groups,...watched.map(item=>({...item,isWatched:true}))];
    host.replaceChildren(...cards.map((group,index)=>groupCard(group,stale,index)));
    lastDraw=key;
  }
}

async function load(){
  clearTimeout(timer);
  if(document.hidden)return;
  const generation=++loadGeneration;
  let wait=60_000;
  try{
    const params=new URLSearchParams(watchModels.map(model=>['watch',model]));
    const response=await fetch(fleetURL('/api/market?'+params));
    if(!response.ok)throw Error('Market request failed');
    const data=await response.json();
    if(generation!==loadGeneration)return;
    render(data);
    if(!data.enabled)return;
    if(data.refreshing)wait=2000;
  }catch{
    if(generation!==loadGeneration)return;
    $('#market-notice').textContent='Couldn’t reach the Market snapshot.';
    $('#market-progress').hidden=true;
  }
  timer=setTimeout(load,wait);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});
document.addEventListener('fleet-scope-changed',load);
void load();
