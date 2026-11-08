import {element} from './ui.js?v=1.0.0';
import {bindPopover,closePopover} from './popover.js?v=1.0.0';
import {percentLabel,reliabilityLabel} from './model.js?v=1.0.0';

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
  copy:'Supply is Vast’s worldwide count of GPUs by availability and verification. Price comparisons use on-demand compute in USD per GPU-hour. They exclude storage and bandwidth. The comparable sample matches bundle size, memory, CPU architecture, verification and a reliability floor near your fleet. Local offers take priority when at least three independent hosts match. Sparse samples can use other GPU models within 20.0% below to 25.0% above the reported memory and within 30.0% of DLPerf. Similar GPU prices are scaled by DLPerf and may differ in software support or memory behaviour. Each provider gets one vote. Your booked rates come from active contracts and can include multiple rental types. Where a matching quote is visible, VastStats estimates the host equivalent using the observed renter-to-host ratio for your listing. Suggestions are indicative ranges based on the lower quartile to median of comparable asks, adjusted toward your booked rates where available.'}));

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
  const rows=[['Verified',market.verified],['Unverified',market.unverified]].map(([label,cohort])=>[
    label,number(cohort.rented),number(cohort.available),number(cohort.unavailable),percent(cohort.usage30)
  ]);
  section.append(table('Worldwide supply by verification',['Verification','Rented','Available','Unavailable','30-day usage'],rows));
  return section;
}

function priceRow(label,sample,unavailable=false){
  return [label,number(unavailable?null:sample?.samples??0),price(sample?.median),sample?band(sample.min,sample.max):'—'];
}

function watchPriceSummary(group){
  const box=element('div','market-suggestion');
  box.append(element('h3','','Market asking price'));
  if(group.prices?.all){
    const reading=element('div','market-target');
    reading.append(element('strong','',price(group.prices.all.median)),element('span','','median per GPU-hour · '+number(group.prices.all.samples)+' hosts'));
    box.append(reading);
    if(group.failed)box.append(element('p','market-note','Showing saved offers.'));
  }else{
    const message=group.refreshing?'Checking available offers…':group.prices?'No available offers in the sample.':'Offer prices are unavailable.';
    box.append(element('p','market-note',message));
  }
  return box;
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
  return section;
}

function pricing(group){
  const section=element('div','market-prices');
  section.append(element('h3','','On-demand asking prices'));
  const rows=[priceRow('Same model · all sampled',group.asking,group.offersFailed),priceRow('Comparable · '+group.scope,group.exact,group.offersFailed)];
  if(group.peers)rows.push(priceRow('Similar GPUs · DLPerf adjusted',group.peers));
  if(group.offersFailed)section.append(element('p','market-note','Same-model offer search is temporarily unavailable.'));
  section.append(table('Renter compute asking prices',['Renter $/GPU-hour','Hosts','Median','Range'],rows));
  const floor=percent(group.floor);
  const facts=['Comparable offers use a '+floor+' reliability floor.'];
  if(group.sampleLimited||group.peerLimited)facts.push('Search results are capped, so prices describe a sample.');
  if(group.peerStatus==='missing specs')facts.push('Vast did not report enough hardware data to match similar GPUs.');
  else if(group.peerStatus==='unavailable')facts.push('The similar-GPU search is temporarily unavailable.');
  else if(group.peerStatus==='checked'&&!group.peers)facts.push('No similar offers met the memory, DLPerf and quality filters.');
  if(group.peerModels.length)facts.push('Similar models: '+group.peerModels.map(peer=>peer.name+' ('+peer.prices.samples+')').join(', ')+'.'+(group.peerScope==='Mixed CPU architectures'?' This sample crosses CPU architectures.':''));
  if(group.fleetQuotes&&group.exact?.median>0){
    const difference=group.fleetQuotes.median/group.exact.median-1;
    facts.push('Your median visible renter quote is '+(Math.abs(difference)<.005?'in line with':percent(Math.abs(difference))+(difference>0?' above':' below'))+' the comparable median ('+group.fleetQuotes.samples+' fleet '+(group.fleetQuotes.samples===1?'quote).':'quotes).'));
  }
  section.append(element('p','market-note',facts.join(' ')));
  return section;
}

function suggestion(group,stale){
  const box=element('div','market-suggestion'),value=group.suggestion;
  box.append(element('h3','','Suggested host price'));
  if(stale||!value?.host){
    const message=stale?'Waiting for a fresh market snapshot.':value?'A matching fleet quote is needed for a host price.':'Too little comparable evidence for a range.';
    box.append(element('p','market-note',message));
    return box;
  }
  const reading=element('div','market-target');
  reading.append(element('strong','',band(value.host.low,value.host.high)),element('span','','per GPU-hour · '+value.confidence.toLowerCase()+' evidence'));
  box.append(reading);
  return box;
}

function suggestionEvidence(group){
  const value=group.suggestion;
  const signals=[];
  if(value.exact)signals.push('same-model asks');
  if(value.peers)signals.push('similar GPU asks');
  if(value.booked)signals.push('your running contract rates');
  let detail=value.confidence+' evidence · '+signals.join(' + ')+'.';
  if(value.host&&value.renter)detail+=' Host equivalent uses '+group.quoteSamples+' matching fleet '+(group.quoteSamples===1?'quote.':'quotes.');
  return detail;
}

const fleetColumns=[
  ['name','Device','The machine name. An unlisted machine is marked next to its name.'],
  ['active','Running GPUs','GPUs in active rentals out of the GPUs installed on the machine. Sorts by the number running.'],
  ['reliability','Reliability','Vast’s reliability score for the machine.'],
  ['ask','Host ask','The on-demand compute price you set for new rentals, in USD per GPU-hour.'],
  ['quote','Renter quote','The compute price Vast shows renters for a matching offer, in USD per GPU-hour including Vast’s surcharge. A dash means Vast didn’t return a matching offer.'],
  ['booked','Booked rate','What your active contracts pay you for compute, in USD per running GPU-hour. A dash means no running rate is available.']
];
const fleetSorts=new Map();
const deviceNames=new Intl.Collator('en-GB',{numeric:true,sensitivity:'base'});

function fleetTable(group){
  const wrapper=table('Your listing, renter quote and active contract prices',fleetColumns.map(([,label])=>label),group.devices.map(device=>[
    device.name+(device.listed===false?' · unlisted':''),number(device.active)+' / '+number(device.gpus),reliabilityLabel(device.reliability),
    device.listed===true?price(device.ask):'—',price(device.quote),price(device.booked)
  ]));
  const body=wrapper.querySelector('tbody');
  const rows=Array.from(body.rows,(row,index)=>({row,device:group.devices[index]}));
  const groupKey=marketGroupKey(group);
  const headers=Array.from(wrapper.querySelectorAll('thead th'));
  const indicators=[];
  const sortValue=(device,key)=>key==='ask'&&device.listed!==true?null:device[key];

  function applySort({key,direction}){
    const ordered=[...rows].sort((a,b)=>{
      const left=sortValue(a.device,key),right=sortValue(b.device,key);
      if(left==null)return right==null?0:1;
      if(right==null)return -1;
      const comparison=key==='name'?deviceNames.compare(left,right):left-right;
      return direction==='ascending'?comparison:-comparison;
    });
    body.replaceChildren(...ordered.map(({row})=>row));
    headers.forEach((header,index)=>{
      const active=fleetColumns[index][0]===key;
      if(active)header.setAttribute('aria-sort',direction);
      else header.removeAttribute('aria-sort');
      indicators[index].textContent=active?(direction==='ascending'?'↑':'↓'):'↕';
    });
  }

  headers.forEach((header,index)=>{
    const [key,label,copy]=fleetColumns[index];
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
    controls.append(sort,help);
    header.replaceChildren(controls);
  });
  const initial=fleetSorts.get(groupKey);
  if(initial)applySort(initial);
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
        details.append(watchPriceDetails(group));
        return;
      }
      const own=element('div','market-fleet');
      own.append(element('h3','','Your fleet'),fleetTable(group));
      details.append(pricing(group),own);
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
    remove.addEventListener('click',()=>{
      expandedGroups.delete(key);
      updateWatchlist(watchModels.filter(model=>modelKey(model)!==modelKey(group.model)));
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
    notice.textContent='Market is available in the local operator view. Start VastStats on localhost with MARKET_ENABLED=1.';
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
  const key=JSON.stringify([snapshot.updatedAt,stale,watched.map(item=>[item.model,item.prices?.updatedAt,item.refreshing,item.failed])]);
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
    const response=await fetch('/api/market?'+params);
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
void load();
