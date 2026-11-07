import {element} from './ui.js?v=1.0.0';
import {bindPopover} from './popover.js?v=1.0.0';
import {percentLabel,reliabilityLabel} from './model.js?v=1.0.0';

const $=selector=>document.querySelector(selector);
const decimal=new Intl.NumberFormat('en-GB',{maximumFractionDigits:1});
const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:3});
const timestamp=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'});
const number=value=>Number.isFinite(value)?decimal.format(value):'—';
const price=value=>Number.isFinite(value)?dollars.format(value):'—';
const percent=value=>Number.isFinite(value)?percentLabel(value*100):'—';
const band=(low,high)=>price(low)+(low===high?'':'–'+price(high));
let lastDraw='',timer;

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
  section.append(element('h3','','Worldwide GPU supply'));
  if(!market){section.append(element('p','market-note','Vast’s supply counts are unavailable for this model.'));return section;}
  const metrics=element('div','market-metrics');
  for(const [label,value,style] of [['Rented',number(market.rented),'rented'],['Available',number(market.available),'available'],['Unavailable',number(market.unavailable),'unavailable'],['30-day usage',percent(market.usage30),'']]){
    const metric=element('div','market-metric '+style);
    metric.append(element('strong','',value),element('span','',label));metrics.append(metric);
  }
  section.append(metrics);
  if(market.total>0&&[market.rented,market.available,market.unavailable].every(Number.isFinite)){
    const bar=element('div','market-supply-bar');bar.setAttribute('aria-hidden','true');
    for(const [style,count] of [['rented',market.rented],['available',market.available],['unavailable',market.unavailable]]){
      const segment=element('span',style);segment.style.flexGrow=String(count);bar.append(segment);
    }
    section.append(bar);
  }
  section.append(table('Worldwide supply by verification',['Verification','Rented','Available','Unavailable'],[
    ['Verified',number(market.verified.rented),number(market.verified.available),number(market.verified.unavailable)],
    ['Other',number(market.other.rented),number(market.other.available),number(market.other.unavailable)]
  ]),element('p','market-note',number(market.total)+' GPUs in total · '+percent(market.rentedShare)+' rented now'));
  return section;
}

function priceRow(label,sample,unavailable=false){
  return [label,number(unavailable?null:sample?.samples??0),price(sample?.median),sample?band(sample.min,sample.max):'—'];
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
  box.append(element('h3','','Indicative price for a new listing'));
  if(stale||!value){
    box.append(element('p','market-note',stale?'Waiting for a fresh market snapshot.':'Too little comparable price evidence for a range.'));
    return box;
  }
  const amounts=element('div','market-targets');
  for(const [label,target] of [['Host listing',value.host],['Renter compute',value.renter]]){
    if(!target)continue;
    const reading=element('div','market-target');
    reading.append(element('strong','',band(target.low,target.high)),element('span','',label+' / GPU-hour'));amounts.append(reading);
  }
  box.append(amounts);
  const signals=[];
  if(value.exact)signals.push('same-model asks');
  if(value.peers)signals.push('similar GPU asks');
  if(value.booked)signals.push('your running contract rates');
  let detail=value.confidence+' evidence · '+signals.join(' + ')+'.';
  if(value.host&&value.renter)detail+=' Host equivalent uses '+group.quoteSamples+' matching fleet '+(group.quoteSamples===1?'quote.':'quotes.');
  else if(!value.host)detail+=' A matching fleet quote is needed to estimate the host listing rate.';
  box.append(element('p','market-note',detail));
  return box;
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
  const groupKey=JSON.stringify([group.model,group.bundle,group.arch,group.verification,group.ram]);
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

function groupCard(group,stale){
  const section=element('section','market-card'),head=element('div','market-card-heading');
  const specs=[group.bundle+' GPU per offer',group.arch,group.verification,
    group.ram?number(Math.round(group.ram/1024))+' GiB '+(group.shared?'unified memory':'VRAM'):null,
    group.dlperf?number(group.dlperf)+' DLPerf/GPU':null].filter(Boolean);
  head.append(element('h2','',group.model),element('p','market-note',specs.join(' · ')));
  const comparisons=element('div','market-comparisons');comparisons.append(supply(group.market),pricing(group));
  const own=element('div','market-fleet');
  own.append(element('h3','','Your fleet'),fleetTable(group));
  section.append(head,comparisons,suggestion(group,stale),own);
  return section;
}

function render(data){
  const notice=$('#market-notice'),freshness=$('#freshness'),host=$('#market-groups'),snapshot=data.snapshot;
  if(!data.enabled){
    notice.textContent='Market is available in the local operator view. Start VastStats on localhost with MARKET_ENABLED=1.';
    freshness.textContent='Market collection is disabled.';host.replaceChildren();lastDraw='';return;
  }
  if(!snapshot){
    notice.textContent=data.failed?'Couldn’t load the marketplace. VastStats will retry shortly.':'Checking Vast marketplace data…';
    freshness.textContent=notice.textContent;return;
  }
  const stale=data.failed||Date.now()-Date.parse(snapshot.updatedAt)>20*60_000;
  notice.textContent=snapshot.unavailable?'Vast’s marketplace sources are temporarily unavailable.':stale?'Showing the last market snapshot.':snapshot.partial?'Some marketplace sources are temporarily unavailable.':!snapshot.groups.length?'No GPU models are available in your fleet snapshot.':'';
  freshness.textContent='Market checked '+timestamp.format(Date.parse(snapshot.updatedAt))+' (London)'+(snapshot.partial?' · partial':stale?' · overdue':'')+'.'+
    (snapshot.fleetUpdatedAt?' Running contract rates checked '+timestamp.format(Date.parse(snapshot.fleetUpdatedAt))+' (London).':'');
  $('.freshness').classList.toggle('live',!stale&&!snapshot.partial);
  const key=snapshot.updatedAt+':'+stale;
  if(key!==lastDraw){host.replaceChildren(...snapshot.groups.map(group=>groupCard(group,stale)));lastDraw=key;}
}

async function load(){
  clearTimeout(timer);
  if(document.hidden)return;
  let wait=60_000;
  try{
    const response=await fetch('/api/market');
    if(!response.ok)throw Error('Market request failed');
    const data=await response.json();render(data);
    if(!data.enabled)return;
    if(data.refreshing)wait=2000;
  }catch{$('#market-notice').textContent='Couldn’t reach the Market snapshot.';}
  timer=setTimeout(load,wait);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});
void load();
