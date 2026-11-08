import {cachedAPI} from './api.js?v=1.0.0';
import {coverageLabel,currentStatus,percentLabel,reliabilityLabel,ZONE} from './model.js?v=1.0.0';
import {primaryStatusIcon,maintenanceIcon,verificationIcon} from './device-state.js?v=1.0.0';
import {duration} from './device-info.js?v=1.0.0';
import {hourlyUsd} from './now.js?v=1.0.0';
import {bindPopover} from './popover.js?v=1.0.0';
import {element,icon} from './ui.js?v=1.0.0';

const $=selector=>document.querySelector(selector);
const get=cachedAPI();
const names=new Intl.Collator('en-GB',{numeric:true,sensitivity:'base'});
const timestamp=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,dateStyle:'medium',timeStyle:'short'});
const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6});
const priceFields=[['gpu','GPU','/GPU-h'],['disk','Disk','/GB-mo'],['volume','Volume','/GB-mo']];
const moneyValue=value=>Number.isFinite(value)?money.format(value):'—';
const earningsMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const utcDay=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
const stamp=value=>value?timestamp.format(Date.parse(value)):'Unavailable';
const number=value=>Number.isFinite(value)?String(value):'—';
const period=$('#device-period'),head=$('#device-columns'),body=$('#device-rows'),clearFilters=$('#clear-device-filters');
const filters=new Map();
let data=null,sort={key:'name',direction:1};

function statusLabels(sample,status){
  return [
    status.connection==='unknown'?'Unknown':status.connection==='online'?'Online':'Offline',
    status.listed===true?'Listed':status.listed===false?'Unlisted':null,
    status.maintenance?'Maintenance':null,
    status.running?'Running':null,
    sample.verification??null,
    status.stale?'Overdue':null
  ].filter(Boolean);
}

function currentRates(contracts){
  if(!contracts)return null;
  const active=contracts.filter(contract=>contract.state!=='offline');
  return Object.fromEntries([...priceFields.map(([key])=>key),'upload','download'].map(key=>{
    const relevant=key==='gpu'?active.filter(contract=>contract.gpuCharging):active;
    const values=relevant.map(contract=>contract[key]).filter(Number.isFinite);
    return [key,values.length?[Math.min(...values),Math.max(...values)]:null];
  }));
}

function rateText(value){
  if(!Array.isArray(value))return moneyValue(value);
  const [low,high]=value.map(moneyValue);
  return low===high?low:low+'–'+high;
}

function rateList(rates){
  const list=element('dl','device-rate-list');
  for(const [key,label,unit] of priceFields){
    const value=rates?.[key];
    if(value==null)continue;
    list.append(element('dt','',label),element('dd','',rateText(value)+unit));
  }
  if(rates?.upload!=null||rates?.download!=null){
    const label=element('dt','','Up/Down');
    label.title='Upload / download in USD per TB';
    list.append(label,element('dd','',rateText(rates.upload)+' / '+rateText(rates.download)+'/TB'));
  }
  return list.childElementCount?list:'—';
}

function deviceLink({box}){
  const link=element('a','device-inventory-link',box.name);
  const query=new URLSearchParams({device:box.deviceKey});
  if(period.value!=='all')query.set('period',period.value);
  link.href='occupancy.html?'+query;
  if(box.lastSample?.at)link.title='Status checked '+stamp(box.lastSample.at);
  return link;
}

function stateCell({box,sample,status,labels}){
  const button=element('button','inventory-state'+(status.stale?' outdated':''));
  const description=labels.join(' · ');
  button.type='button';
  button.setAttribute('aria-label',box.name+' status: '+description);
  const maintenance=maintenanceIcon(status);
  button.append(primaryStatusIcon(sample,status),maintenance,verificationIcon(sample.verification));
  bindPopover(button,()=>({title:box.name+' status',copy:description+'. '+maintenance.title+'.'}));
  return button;
}

function contractCell({contracts,box}){
  if(contracts===null)return '—';
  if(!contracts.length)return '0';
  const running=contracts.filter(contract=>contract.state==='running').length;
  const button=element('button','device-contracts',running+'/'+contracts.length);
  const countLabel=running+' running / '+contracts.length+' total';
  button.type='button';
  button.title=countLabel;
  button.setAttribute('aria-label',countLabel);
  bindPopover(button,()=>{
    const content=element('div','device-contract-list');
    for(const contract of contracts){
      const item=element('section');
      const label=[contract.type,contract.state,Number.isFinite(contract.gpus)?contract.gpus+' GPU'+(contract.gpus===1?'':'s'):null].filter(Boolean).join(' · ');
      item.append(element('strong','',label),rateList(contract));
      content.append(item);
    }
    return {title:box.name+' contracts',
      copy:contracts.some(contract=>contract.state==='stopped'&&contract.gpu!=null)?'Stopped rentals show the agreed GPU rate. GPU time is billed when the rental runs.':undefined,
      content};
  });
  return button;
}

const columns=[
  {key:'name',label:'Device',filter:'text',value:row=>row.box.name,cell:deviceLink},
  {key:'gpu-model',label:'GPU',name:'GPU model',filter:'choice',choices:()=>[...new Set(data.boxes.map(box=>box.lastSample?.gpuModel).filter(Boolean))].sort(names.compare),
    value:row=>row.sample.gpuModel,cell:row=>row.sample.gpuModel??'—'},
  {key:'gpu-count',label:'#',name:'GPU count',step:1,value:row=>row.sample.gpuCount,cell:row=>number(row.sample.gpuCount)},
  {key:'state',label:'State',filter:'choice',choices:()=>['Online','Offline','Unknown','Running','Listed','Unlisted','Maintenance','Verified','Unverified','Deverified','Overdue'],
    value:row=>row.labels.join(' · '),filterValue:row=>row.labels.map(label=>label.toLowerCase()),cell:stateCell},
  {key:'reliability',label:'Reliability',unit:'%',value:row=>row.sample.reliability,
    filterValue:row=>row.sample.reliability==null?null:row.sample.reliability*100,cell:row=>reliabilityLabel(row.sample.reliability)},
  {key:'occupancy',label:'Occupancy',unit:'%',value:row=>row.occupancy?.percent,cell:row=>{
    const value=element('span','',percentLabel(row.occupancy?.percent));
    value.title='Data coverage '+coverageLabel(row.occupancy?.coverage);
    return value;
  }},
  {key:'worked',label:'Worked',name:'Total hours worked',unit:'hours',value:row=>Number.isFinite(row.box.workedSeconds)?row.box.workedSeconds/3600:null,
    cell:row=>{
      const value=element('span','',duration(row.box.workedSeconds).replace(/(\d) (h|min)\b/g,'$1$2'));
      value.title=data?.earningsWindow?'Confirmed run time on reported billing days. A partial hour at the report cutoff is omitted. '+earningsDates():'Confirmed run time across all available telemetry.';
      return value;
    }},
  {key:'stored',label:'Images',name:'Stored images',step:1,value:row=>row.sample.storedInstances,cell:row=>{
    const {storedInstances,allocatedStorageGb}=row.sample;
    const size=Number.isFinite(allocatedStorageGb)?allocatedStorageGb.toLocaleString('en-GB',{maximumFractionDigits:1}):null;
    const value=element('span','',number(storedInstances)+(size===null?'':'/'+size+'GB'));
    if(size!==null)value.title=number(storedInstances)+' stored images, '+size+' GB allocated';
    return value;
  }},
  {key:'now-earnings',label:'Now $/h',name:'Current earnings per hour',private:true,unit:'USD/hour',value:row=>row.status.stale?null:row.sample.earnings?.totalUsdPerHour,
    cell:row=>earningsCell(hourlyUsd(row.status.stale?null:row.sample.earnings?.totalUsdPerHour),'Compute and storage from current contracts. Bandwidth is billed by usage.')},
  {key:'avg-earnings',label:'Avg $/h',name:'Average earnings per hour',private:true,unit:'USD/hour',negative:true,value:row=>row.box.averageUsdPerHour,
    cell:row=>earningsCell(hourlyUsd(row.box.averageUsdPerHour),'Recorded earnings divided by the clock hours reported for the fleet. Includes idle time. '+earningsDates())},
  {key:'total-earnings',label:'Earned',name:'Total earned',private:true,unit:'USD',negative:true,value:row=>row.box.earnedUsd,
    cell:row=>earningsCell(Number.isFinite(row.box.earnedUsd)?earningsMoney.format(row.box.earnedUsd):'—','Recorded GPU, storage and bandwidth earnings. '+earningsDates())},
  {key:'contracts',label:'Contracts',private:true,step:1,value:row=>row.contracts?.length,cell:contractCell},
  {key:'current',label:'Booked',name:'Booked rates',private:true,unit:'USD/GPU-hour',description:'Sort by lowest running GPU rate',value:row=>row.current?.gpu?.[0],cell:row=>rateList(row.current)},
  {key:'asking',label:'Asking',name:'Asking rates',private:true,unit:'USD/GPU-hour',description:'Sort by asking GPU rate',value:row=>row.box.rates?.ask?.gpu,cell:row=>rateList(row.box.rates?.ask)}
];

function earningsDates(){
  const window=data?.earningsWindow;
  if(!window)return 'Waiting for the earnings report.';
  const day=value=>utcDay.format(Date.parse(value+'T00:00Z'));
  return 'Billing report: '+day(window.from)+' – '+day(window.to)+' UTC.';
}

function earningsCell(text,description){
  const cell=element('span','',text);
  cell.title=description;
  return cell;
}

function activeColumns(){return columns.filter(column=>!column.private||data?.privateRates);}

function matchesFilter(row,column){
  if(!filters.has(column.key))return true;
  const filter=filters.get(column.key),value=(column.filterValue??column.value)(row);
  if(column.filter==='text')return value?.toLowerCase().includes(filter)??false;
  if(column.filter==='choice')return Array.isArray(value)?value.includes(filter):value?.toLowerCase()===filter;
  return Number.isFinite(value)&&(filter.min===null||value>=filter.min)&&(filter.max===null||value<=filter.max);
}

function renderRows(){
  const visible=activeColumns();
  const list=(data?.boxes??[]).map(box=>{
    const sample=box.lastSample??{},status=currentStatus(sample,Date.now(),data.snapshotMaxAgeSeconds);
    const labels=statusLabels(sample,status),contracts=box.rates?.contracts??null;
    return {box,sample,status,labels,contracts,occupancy:box.occupancy?.[period.value],current:currentRates(contracts)};
  }).filter(row=>visible.every(column=>matchesFilter(row,column)));
  const column=visible.find(column=>column.key===sort.key)??visible[0];
  list.sort((a,b)=>{
    const x=column.value(a),y=column.value(b);
    if(x==null)return y==null?0:1;
    if(y==null)return -1;
    return (typeof x==='number'?x-y:names.compare(x,y))*sort.direction;
  });
  body.replaceChildren(...list.map(row=>{
    const tr=element('tr');
    for(const [index,column] of visible.entries()){
      const cell=element(index?'td':'th');
      if(!index)cell.scope='row';
      const value=column.cell(row);
      if(typeof value==='string')cell.textContent=value;
      else cell.append(value);
      tr.append(cell);
    }
    return tr;
  }));
  const total=data?.boxes.length??0;
  $('#device-inventory-count').textContent='('+list.length+')';
  if(!list.length){
    const row=element('tr'),cell=element('td','device-inventory-empty',total?'No devices match these filters.':'No devices in the fleet snapshot.');
    cell.colSpan=visible.length;row.append(cell);body.append(row);
  }
}

function refreshFilters(){
  for(const header of head.children){
    const button=header.querySelector('.inventory-filter');
    const active=filters.has(header.dataset.key);
    button.classList.toggle('filtered',active);
    button.setAttribute('aria-label',button.dataset.label+(active?' (active)':''));
  }
  clearFilters.hidden=!activeColumns().some(column=>filters.has(column.key));
}

function changeFilter(key,value){
  if(value===null||value==='')filters.delete(key);
  else filters.set(key,value);
  refreshFilters();
  renderRows();
}

function filterControl(column){
  const content=element('div','inventory-filter-form'),saved=filters.get(column.key);
  const label=column.name??column.label;
  if(column.filter==='choice'){
    const select=element('select');
    select.setAttribute('aria-label',label+' filter');
    select.append(new Option('Any',''));
    for(const label of column.choices())select.append(new Option(label,label.toLowerCase()));
    if(saved&&![...select.options].some(option=>option.value===saved))select.append(new Option(saved,saved));
    select.value=saved??'';
    select.addEventListener('change',()=>changeFilter(column.key,select.value));
    content.append(select);
  }else if(column.filter==='text'){
    const input=element('input');
    input.type='search';input.placeholder='Name contains…';input.value=saved??'';
    input.setAttribute('aria-label',label+' filter');
    input.addEventListener('input',()=>changeFilter(column.key,input.value.trim().toLowerCase()));
    content.append(input);
  }else{
    const controls={};
    for(const [key,label] of [['min','Minimum'],['max','Maximum']]){
      const field=element('label','',label),input=element('input');
      input.type='number';input.step=column.step??'any';
      if(!column.negative)input.min=0;
      if(column.unit==='%')input.max=100;
      input.value=saved?.[key]??'';
      controls[key]=input;
      field.append(input);content.append(field);
    }
    const apply=()=>{
      const bound=input=>Number.isFinite(input.valueAsNumber)?input.valueAsNumber:null;
      const min=bound(controls.min),max=bound(controls.max);
      changeFilter(column.key,min===null&&max===null?null:{min,max});
    };
    for(const input of Object.values(controls))input.addEventListener('input',apply);
  }
  const reset=element('button','text-button','Clear this filter');
  reset.type='button';
  reset.addEventListener('click',()=>{
    for(const field of content.querySelectorAll('input,select'))field.value='';
    changeFilter(column.key,null);
  });
  content.append(reset);
  return {title:'Filter '+label,copy:column.unit?'Values in '+column.unit+'.':undefined,content};
}

function refreshIndicators(){
  for(const header of head.children){
    const active=header.dataset.key===sort.key;
    if(active)header.setAttribute('aria-sort',sort.direction===1?'ascending':'descending');
    else header.removeAttribute('aria-sort');
    header.querySelector('.market-column-indicator').textContent=active?(sort.direction===1?'↑':'↓'):'↕';
  }
}

function renderHeader(){
  head.replaceChildren(...activeColumns().map(column=>{
    const {key,label,name=label,description}=column;
    const cell=element('th'),button=element('button','market-column-sort',label);
    const controls=element('div','inventory-column-controls'),filter=element('button','inventory-filter');
    const indicator=element('span','market-column-indicator');indicator.setAttribute('aria-hidden','true');
    cell.scope='col';cell.dataset.key=key;button.type='button';
    button.setAttribute('aria-label',description??'Sort by '+name);
    button.title=name;
    button.append(indicator);
    button.addEventListener('click',()=>{
      sort={key,direction:sort.key===key?-sort.direction:1};
      refreshIndicators();renderRows();
    });
    filter.type='button';filter.dataset.label='Filter by '+name;
    filter.append(icon('filter'));
    bindPopover(filter,()=>filterControl(column));
    controls.append(button,filter);cell.append(controls);return cell;
  }));
  refreshIndicators();
  refreshFilters();
}

bindPopover($('#devices-info'),()=>({title:'Devices',
  copy:'Click a column name to sort, or its funnel to filter. The period selector changes Occupancy. Worked totals confirmed run time on the reported UTC billing days used for Earned, excluding a partial hour at the cutoff. Without a billing report it uses all available telemetry. Now $/h uses current compute and storage rates. Avg $/h divides the device’s recorded total by the fleet’s reported clock hours, including idle time. This can understate averages for newer devices. '+earningsDates()+' Stored images include running and stopped instances. Contracts shows running/total. Click the count for its breakdown.'}));

async function load(){
  try{
    const next=await get('/api/devices'),first=data===null,changed=first||next.privateRates!==data.privateRates;
    const changedData=next!==data;
    data=next;
    if(changed)renderHeader();
    if(changedData)renderRows();
    $('#freshness').textContent='Fleet checked '+stamp(data.updatedAt)+' · Occupancy imported '+stamp(data.historyUpdatedAt);
    const stale=!data.updatedAt||Date.now()-Date.parse(data.updatedAt)>data.snapshotMaxAgeSeconds*1000;
    $('.freshness').classList.toggle('live',!stale);
    $('#device-inventory-notice').textContent=stale?'Showing the last available fleet snapshot.':'';
  }catch{$('#device-inventory-notice').textContent='Couldn’t load the fleet snapshot.';}
}

clearFilters.addEventListener('click',()=>{filters.clear();refreshFilters();renderRows();});
period.addEventListener('change',renderRows);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});
setInterval(()=>{if(!document.hidden)void load();},60_000);
void load();
