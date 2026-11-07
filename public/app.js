import {bindPopover} from './popover.js?v=1.0.0';
import {deviceInfoList,showDeviceTip,hideDeviceTip} from './device-info.js?v=1.0.0';
import {detailsClient,collectionNotice} from './api.js?v=1.0.0';
import {element,icon} from './ui.js?v=1.0.0';
import {renderNow,bindMetricPills} from './now.js?v=1.0.0';
import {ZONE,aggregate,currentStatus,demoData,circleSegments,reliabilityLabel,primaryDeviceState,sortDevices} from './model.js?v=1.0.0';
import {applySnapshots,periodRunCount} from './history-data.js?v=1.0.0';
import {recordsForBin} from './timeline.js?v=1.0.0';
import {periods,periodWindow,periodBins,movePeriod} from './periods.js?v=1.0.0';
import {summaryValue,combineSummaries} from './summary-model.js?v=1.0.0';
const $=s=>document.querySelector(s),formatters=new Map();
const fmt=(t,options)=>{const key=JSON.stringify(options);if(!formatters.has(key))formatters.set(key,new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,...options}));return formatters.get(key).format(t);};
const source=detailsClient();
let loadGeneration=0;
const percent=n=>n==null?'—':n.toFixed(1)+'%';
// Ignore only floating-point noise, not genuine gaps below the displayed precision.
const incompleteCoverage=value=>value.observed>0&&value.coverage<1-1e-9;
const coveragePercent=ratio=>ratio>=.9995&&ratio<1-1e-9?'<100%':percent(ratio*100);
const duration=seconds=>{
  if(seconds>0&&seconds<60)return '<1 min';
  const totalMinutes=Math.round(Math.max(0,seconds)/60);
  if(seconds<3600)return totalMinutes+' min';
  const hours=Math.floor(totalMinutes/60),minutes=totalMinutes%60;
  return hours+' h'+(minutes?' '+minutes+' min':'');
};
let data={boxes:[]},demo=new URLSearchParams(location.search).has('demo');
let period=periods.some(p=>p.key===new URLSearchParams(location.search).get('period'))?new URLSearchParams(location.search).get('period'):'day';
let reference=null,scale='hours',slotCount=24;
let initialDeviceLocated=false;
let deviceSort={key:'order',direction:'asc'};
function visibleBins(){return periodBins(periodWindow(period,reference??Date.now()));}
function updatePeriod(){scale=periodWindow(period,reference??Date.now()).scale;slotCount=visibleBins().length;}
let recordsByBox=new Map(),countsByBox=new Map(),snapshotsByBox=new Map(),summariesByBox=new Map(),activeCell=null;
const boxKey=box=>box.deviceKey??box.storageKey??box.name;

function stateIcon(kind,state,label,count=null,disabled=false){
  const item=element('span','device-state '+state);item.title=label;item.setAttribute('role','img');item.setAttribute('aria-label',label);item.append(icon(kind,disabled));
  if(count!==null)item.append(element('span','device-count',String(count)));return item;
}
function closeBoxDetails(restoreFocus=false){document.querySelectorAll('.box-details[open]').forEach(details=>{details.open=false;if(restoreFocus)details.querySelector('summary').focus();});}
function deviceDetails(box,stat,status){
  const details=element('details','box-details name-details'),summary=element('summary','device-name-button'+(status.stale?' overdue':''));summary.setAttribute('role','button');summary.setAttribute('aria-expanded','false');summary.setAttribute('aria-label','Details for '+box.name);summary.append(element('h3','',box.name));
  const panel=element('div','box-details-body'),close=element('button','box-details-close','×');close.type='button';close.setAttribute('aria-label','Close '+box.name+' details');close.onclick=()=>{details.open=false;summary.focus();};panel.append(close,element('strong','',box.name+' · details'));
  const options={period:$('#period').textContent};
  panel.append(deviceInfoList(box,stat,status,options));details.append(summary,panel);
  const show=()=>{if(!details.open){hideTip();showDeviceTip(summary,box,stat,status,options);}};
  summary.addEventListener('mouseenter',show);summary.addEventListener('focus',show);
  summary.addEventListener('mouseleave',hideDeviceTip);summary.addEventListener('blur',hideDeviceTip);
  details.dataset.box=boxKey(box);
  details.addEventListener('toggle',()=>{summary.setAttribute('aria-expanded',String(details.open));if(details.open){
    const anchor=summary.getBoundingClientRect(),bounds=panel.getBoundingClientRect();
    panel.style.left=Math.max(10,Math.min(innerWidth-bounds.width-10,anchor.left))+'px';
    panel.style.top=Math.max(10,Math.min(innerHeight-bounds.height-10,anchor.bottom+bounds.height+8<=innerHeight-10?anchor.bottom+8:anchor.top-bounds.height-8))+'px';
  }});
  return details;
}
function hideTip(){ hideDeviceTip();$('#tooltip').hidden=true;if(activeCell)activeCell.removeAttribute('aria-describedby');activeCell=null; }
function drillInto(bin){
  if(bin.start>Date.now()||scale==='hours')return false;
  period=scale==='months'?'month':'day';
  reference=Math.min(bin.end-1,Date.now());
  hideTip();load();return true;
}
function showTip(button,box,bin,value){
  hideDeviceTip();const tip=$('#tooltip');tip.classList.remove('device-tooltip');tip.replaceChildren();
  const hourly=scale==='hours';
  const title=fmt(bin.start,{day:'numeric',month:'short',year:'numeric'})+(hourly?' · '+fmt(bin.start,{hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):scale==='months'?' – '+fmt(bin.end-1,{day:'numeric',month:'short',year:'numeric'}):'');
  tip.append(element('h4','',box.name+' · '+title));const dl=element('dl');
  if(value.state==='not-tracked')tip.append(element('p','','Before available history. Tracking begins '+fmt(Date.parse(box.historyStart),{dateStyle:'medium',timeStyle:'short'})+'. This time is excluded from data coverage; the API does not establish the box’s first boot.'));
  else{
  const lines=[['Occupancy',percent(value.percent)+(value.observed?' · '+duration(value.occupied):'')],['Runs',value.runCount??'—'],['Data coverage',value.elapsed?coveragePercent(value.coverage):'—']];
  const recorded=at=>'Recorded '+fmt(Date.parse(at),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const evidence=value.statusEvidence||{};
  if(evidence.offline)lines.push(['Offline',recorded(evidence.offline)]);
  if(evidence.maintenance)lines.push(['Maintenance',recorded(evidence.maintenance)]);
  else if(value.maintenanceSchedules?.length){
    const windows=value.maintenanceSchedules.map(w=>fmt(Date.parse(w.start),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' – '+fmt(Date.parse(w.end),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}));
    lines.push(['Maintenance scheduled',windows.join('; ')]);
  }
  if(evidence.unlisted)lines.push(['Unlisted',recorded(evidence.unlisted)]);
  for(const [name,value] of lines)dl.append(element('dt','',name),element('dd','',String(value)));tip.append(dl);
  if(value.state==='future')tip.append(element('p','','This period has not started.'));
  else if(!value.observed)tip.append(element('p','','No telemetry recorded for this period yet.'));
  if(box.historyStart&&bin.start<Date.parse(box.historyStart)&&bin.end>Date.parse(box.historyStart))tip.append(element('p','','Only time from '+fmt(Date.parse(box.historyStart),{dateStyle:'medium',timeStyle:'short'})+' contributes to this circle and coverage.'));
  }
  tip.hidden=false;const r=button.getBoundingClientRect();tip.style.left=Math.max(10,Math.min(innerWidth-tip.offsetWidth-10,r.left+r.width/2-tip.offsetWidth/2))+'px';
  tip.style.top=(r.top>tip.offsetHeight+16?r.top-tip.offsetHeight-10:Math.min(innerHeight-tip.offsetHeight-10,r.bottom+10))+'px';
  if(activeCell)activeCell.removeAttribute('aria-describedby');activeCell=button;button.setAttribute('aria-describedby','tooltip');
}
function cell(box,bin){
  let value;
  if(data.representation==='summaries'){
    const row=summariesByBox.get(boxKey(box))?.get(bin.start),stats=summaryValue(row?.value,bin,Date.now(),Date.parse(box.historyStart));
    value=applySnapshots(stats,{...box,snapshots:row?.snapshots||[]},bin,Date.now(),data.snapshotMaxAgeSeconds??5400);
    value.runCount=value.state==='not-tracked'?null:row?.runCount??null;
  }else{
    const binRows=recordsForBin(recordsByBox.get(boxKey(box)),bin);
    value=applySnapshots(aggregate(binRows,bin.start,bin.end,Date.now(),Date.parse(box.historyStart)),{...box,snapshots:recordsForBin(snapshotsByBox.get(boxKey(box)),bin)},bin,Date.now(),data.snapshotMaxAgeSeconds??5400);
    value.runCount=value.state==='not-tracked'?null:periodRunCount(scale==='months'?{hours:binRows,runCounts:recordsForBin(countsByBox.get(boxKey(box)),bin)}:box,bin);
  }
  const b=element('button','cell '+value.state+' border-'+value.borderState+(incompleteCoverage(value)?' incomplete':'')+(value.isNow?' now':''),value.state==='not-tracked'?'–':value.runCount??'');
  const segments=circleSegments(value);
  if(segments.running!==null){b.classList.add('measured');if(segments.running>=100-1e-7)b.classList.add('complete-running');b.style.setProperty('--running',segments.running+'%');b.style.setProperty('--observed',segments.observed+'%');}
  if(value.runCount>99)b.classList.add('many-runs');
  b.type='button';b.setAttribute('aria-label',box.name+', '+fmt(bin.start,{dateStyle:'medium',timeStyle:'short'})+', '+(value.percent==null?'no data':percent(value.percent)+' occupancy in observed data')+', '+(value.runCount??'unknown')+' runs during period'+(incompleteCoverage(value)?', incomplete data':'')+(value.borderState!=='unknown'?', '+value.borderState+' border':'')+(value.maintenance?', includes maintenance':'')+(value.isNow?', current period':'')+(value.snapshotAt?', snapshot at '+fmt(Date.parse(value.snapshotAt),{timeStyle:'short'}):''));
  if(value.state==='not-tracked')b.setAttribute('aria-label',box.name+', '+fmt(bin.start,{dateStyle:'medium'})+', before available history; excluded from data coverage');
  b.addEventListener('mouseenter',()=>showTip(b,box,bin,value));b.addEventListener('mouseleave',hideTip);b.addEventListener('focus',()=>showTip(b,box,bin,value));b.addEventListener('blur',hideTip);b.addEventListener('click',e=>{e.stopPropagation();if(!drillInto(bin))showTip(b,box,bin,value);});return b;
}
function render(){
  const detailsOpenFor=document.querySelector('.box-details[open]')?.dataset.box;
  hideTip();updatePeriod();const bins=visibleBins(),start=bins[0].start,end=bins.at(-1).end;
  document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.period===period)));
  const url=new URL(location);url.searchParams.set('period',period);history.replaceState(null,'',url);
  $('#period').textContent=fmt(start,{day:'numeric',month:'short',year:'numeric',...(scale==='hours'?{hour:'2-digit',minute:'2-digit'}:{})})+' – '+fmt(end-1,{day:'numeric',month:'short',year:'numeric',...(scale==='hours'?{hour:'2-digit',minute:'2-digit',timeZoneName:'short'}:{})});
  const label=periods.find(p=>p.key===period).label;
  $('#previous').title='Previous '+label;$('#next').title='Next '+label;
  $('#previous').setAttribute('aria-label','Previous '+label);$('#next').setAttribute('aria-label','Next '+label);
  $('#next').disabled=end>=periodWindow(period,Date.now()).end;
  $('.timeline').style.setProperty('--period-slots',slotCount);
  $('#resolution').textContent=('One circle = one '+({hours:'hour',days:'day',months:'month'}[scale]))+' · Numbers = runs during period';
  const now=Date.now(),statsByBox=new Map(data.boxes.map(b=>[boxKey(b),data.representation==='summaries'?combineSummaries((b.summaries||[]).map(row=>row.value).filter(Boolean),{start,end},now,Date.parse(b.historyStart)):aggregate(b.hours,start,end,now,Date.parse(b.historyStart))]));
  const visibleBoxes=sortDevices(data.boxes,deviceSort,{occupancy:b=>statsByBox.get(boxKey(b)).percent,now,maxAgeSeconds:data.snapshotMaxAgeSeconds??5400});
  const stats=visibleBoxes.map(b=>statsByBox.get(boxKey(b)));let obs=0,occ=0,elapsed=0;
  stats.forEach(s=>{obs+=s.observed;occ+=s.occupied;elapsed+=s.elapsed;});
  $('#occupancy').textContent=percent(obs?occ/obs*100:null);$('#coverage').textContent=elapsed?coveragePercent(obs/elapsed):'—';
  $('#hours').textContent=obs?duration(occ):'—';
  const fleet=renderNow(data);
  const boxes=$('#boxes');boxes.replaceChildren();boxes.className='device-table';
  // Shared column widths use the largest count in the fleet, never the row's own count.
  for(const [field,property] of [['runningInstances','running'],['storedInstances','stored'],['gpuCount','gpu']])boxes.style.setProperty('--'+property+'-digits',Math.max(1,...data.boxes.map(b=>String(b.lastSample?.[field]??'?').length)));
  for(const [field,property] of [['maintenance','maintenance']])boxes.style.setProperty('--'+property+'-extra',fleet[field]===null?'.7em':'0px');
  $('#timeline-axis')?.remove();
  {
    const axis=element('div','timeline-axis');axis.id='timeline-axis';const meta=element('div','timeline-axis-meta');meta.setAttribute('role','group');meta.setAttribute('aria-label','Sort devices');
    for(const [key,label] of [['order','Device'],['state','State'],['occupancy','Occupancy']]){
      const button=element('button','sort-heading'+(key==='occupancy'?' timeline-axis-occupancy':''),label),active=deviceSort.key===key;
      button.type='button';button.dataset.sort=key;button.dataset.direction=active?deviceSort.direction:'none';button.setAttribute('aria-pressed',String(active));
      button.setAttribute('aria-label','Sort by '+label+(active?', currently '+(deviceSort.direction==='asc'?'ascending':'descending'):''));
      button.title=key==='state'?'Sort by offline, running, listed, online; click again to reverse':'Sort by '+(key==='order'?'device order':label.toLowerCase())+'; click again to reverse';
      button.onclick=()=>{deviceSort={key,direction:active?(deviceSort.direction==='asc'?'desc':'asc'):key==='occupancy'?'desc':'asc'};render();document.querySelector('[data-sort="'+key+'"]').focus();};
      meta.append(button);
    }
    axis.append(meta);const labels=element('div','timeline-circles timeline-labels');labels.setAttribute('aria-hidden','true');
    for(const bin of bins){const label=element('span','',fmt(bin.start,scale==='hours'?{hour:'2-digit',hourCycle:'h23'}:scale==='months'?{month:'short'}:{day:'numeric'}));label.title=fmt(bin.start,{dateStyle:'full',...(scale==='hours'?{timeStyle:'short'}:{})});label.append(element('small','',fmt(bin.start,scale==='hours'?{day:'numeric',month:'short'}:scale==='months'?{year:'numeric'}:{month:'short'})));labels.append(label);}
    axis.append(labels);boxes.before(axis);
  }
  visibleBoxes.forEach((box,index)=>{
    summariesByBox.set(boxKey(box),new Map((box.summaries||[]).map(row=>[row.start,row])));
    recordsByBox.set(boxKey(box),(box.hours||[]).filter(r=>Date.parse(r.end)>start&&Date.parse(r.start)<end).map(r=>({...r,startMs:Date.parse(r.start),endMs:Date.parse(r.end)})).sort((a,b)=>a.startMs-b.startMs));
    countsByBox.set(boxKey(box),(box.runCounts||[]).map(r=>({...r,startMs:Date.parse(r.start),endMs:Date.parse(r.end)})).sort((a,b)=>a.startMs-b.startMs));snapshotsByBox.set(boxKey(box),(box.snapshots||[]).map(r=>({...r,startMs:Date.parse(r.at),endMs:Date.parse(r.at)+1})).sort((a,b)=>a.startMs-b.startMs));
    const card=element('article','box');card.dataset.device=boxKey(box);if(new URLSearchParams(location.search).get('device')===boxKey(box))card.classList.add('device-highlight');const header=element('div','box-header'),title=element('div','box-title'),name=element('div','device-name');title.append(name);
    const status=currentStatus(box.lastSample,Date.now(),data.snapshotMaxAgeSeconds??5400),states=element('div','device-states'+(status.stale?' outdated':''));states.setAttribute('aria-label','Latest snapshot for '+box.name);
    const stamp=box.lastSample?.at,when=stamp?' · checked '+fmt(Date.parse(stamp),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
    const running=status.running===false?0:box.lastSample?.runningInstances??'?';
    const primary=primaryDeviceState(status);
    const primaryLabel=primary==='running'?'Running instances: '+running:primary==='listed'?'Listed':primary==='online'?'Online':primary==='offline'?'Offline':'Status unavailable';
    states.append(stateIcon(primary==='running'?'play':primary==='listed'?'tag':'power',primary==='offline'?'offline':primary==='unknown'?'muted':'active',primaryLabel+when,primary==='running'?running:primary==='unknown'?'?':null,primary==='offline'));
    states.append(stateIcon(status.next&&!status.maintenance?'clock':'wrench',status.maintenance||status.next?'maintenance':'muted',status.maintenance?'Maintenance active'+when:status.next?'Maintenance planned: '+fmt(Date.parse(status.next.start),{dateStyle:'medium',timeStyle:'short'}):status.maintenance===false?'Maintenance off'+when:'Maintenance unknown'+when,status.maintenance===null&&!status.next?'?':null,status.maintenance===false&&!status.next));
    const storedIcon=stateIcon('stored','muted','Stored instances: '+(box.lastSample?.storedInstances??'unknown')+when,box.lastSample?.storedInstances??'?');storedIcon.classList.add('device-stored');states.append(storedIcon);
    const gpuIcon=stateIcon('gpu','muted','GPUs: '+(box.lastSample?.gpuCount??'unknown')+when,box.lastSample?.gpuCount??'?');gpuIcon.classList.add('device-gpu');states.append(gpuIcon);
    const verification=box.lastSample?.verification;
    name.prepend(stateIcon(verification==='deverified'?'deverifiedBadge':'verifiedBadge',verification==='verified'?'verified':verification==='deverified'?'maintenance':'muted','Verification: '+(verification??'unavailable')+when,null));
    const reliability=box.lastSample?.reliability;
    const reliabilityIcon=stateIcon('gauge','muted','Reliability: '+(reliability==null?'unavailable':(reliability*100).toFixed(6)+'%')+when,reliabilityLabel(reliability));reliabilityIcon.classList.add('device-reliability');states.append(reliabilityIcon);
    title.append(states);const metric=element('div','box-percent',percent(stats[index].percent));metric.title='Occupancy in observed data for the selected period; see details for coverage';
    const actions=element('div','box-actions'),details=deviceDetails(box,stats[index],status);name.append(details);actions.append(metric);header.append(title,actions);card.append(header);
    const scroll=element('div','timeline-circles');for(const bin of bins)scroll.append(cell(box,bin));
    card.append(scroll);boxes.append(card);if(boxKey(box)===detailsOpenFor)details.open=true;
  });
  if(!initialDeviceLocated){const target=document.querySelector('.device-highlight');if(target){target.scrollIntoView({block:'center'});initialDeviceLocated=true;}}
  const updated=data.updatedAt?Date.parse(data.updatedAt):null,stale=updated&&Date.now()-updated>90*60000;
  $('.freshness').classList.toggle('live',!!updated&&!stale&&!demo);$('#freshness').textContent=demo?'Sample data':updated?(stale?'History overdue · ':'History updated ')+fmt(updated,{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}):'Waiting for API history';
  $('#notice').textContent=demo?'SAMPLE DATA · Illustrative history for exploring the views. These are not actual rental figures.':!updated?'Waiting for the first history import. Missing telemetry will remain grey.':stale?'Refresh is overdue. Available API history is shown; a later refresh can recover missed periods.':'';
  if(!demo&&data.boxes.some(b=>b.historyError))$('#notice').textContent='Some history could not be refreshed. Previously imported data has been kept.';
  if(!demo){const message=collectionNotice(data);if(message)$('#notice').textContent=message;}
  $('#demo').textContent=demo?'Return to recorded data ↗':'Explore sample data ↗';
}
async function load({refreshStatus=false}={}){
  const generation=++loadGeneration;
  if(demo){data=demoData();render();return;}
  try{updatePeriod();const next=await source.load(period,reference,{refreshStatus});if(generation!==loadGeneration)return;data=next;render();}
  catch{if(generation===loadGeneration)$('#notice').textContent='Could not load the API history summaries. The last loaded view is retained.';}
}

document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{period=b.dataset.period;reference=null;load();}));
function move(direction){reference=movePeriod(period,reference??Date.now(),direction);load();}
$('#previous').onclick=()=>move(-1);$('#next').onclick=()=>move(1);$('#today').onclick=()=>{reference=null;load();};
$('#demo').onclick=()=>{demo=!demo;const url=new URL(location);demo?url.searchParams.set('demo','1'):url.searchParams.delete('demo');history.replaceState(null,'',url);load();};
const metricHelp={
  occupancy:['Fleet occupancy','Running box-time divided by observed box-time in the selected period. Missing telemetry is excluded, so a delay alone does not lower occupancy. For example, 30 minutes running and 30 minutes missing means 100% occupancy with 50% coverage. Circle sectors still show confirmed time across the elapsed tracking period, leaving missing time grey. Read occupancy alongside coverage. This measures box-time with any rental running, not GPU capacity.'],
  hours:['Hours','Confirmed running box-hours across all boxes in the selected period. One box with at least one running rental for one hour contributes one box-hour; two boxes running for three hours each contribute six. Multiple simultaneous rentals on one box do not multiply its time. Missing telemetry adds no confirmed time; later API history can backfill it.'],
  now:['Now · latest fleet snapshot','Running, Listed, Online and Maintenance count boxes in that state out of the entire fleet. Running also shows the total running instances. Stored totals retained instances, including running ones; do not add running and stored counts. GB allocated is allocated disk space, not measured file usage. These figures use the latest machine snapshots and do not change with the selected period. They are not live: current-state collection runs every five minutes and snapshots become overdue after 15 minutes. History is collected separately every thirty minutes while the app is running. If any box has an unknown state or count, its fleet total shows a dash rather than assuming zero.'],
  coverage:['Data coverage','The proportion of elapsed box-time in the selected period with reporting coverage from the telemetry API. Native API buckets up to five minutes are accepted; raw samples contribute one second each. It excludes future time and time before each device’s earliest known history boundary. This boundary comes from the telemetry archive, not a proven first boot; it is kept when the archive later advances. A dash marks periods before tracking. Gaps in telemetry are unknown, not idle. Occupancy uses only observed time; missing telemetry reduces coverage without being counted as idle.']
};
for(const button of document.querySelectorAll('[data-info]'))bindPopover(button,()=>{const [title,copy]=metricHelp[button.dataset.info];return {title,copy};});
document.addEventListener('click',event=>{hideTip();document.querySelectorAll('.box-details[open]').forEach(details=>{if(!details.contains(event.target))details.open=false;});});document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideTip();closeBoxDetails(true);}});window.addEventListener('resize',()=>{hideTip();closeBoxDetails();});window.addEventListener('scroll',event=>{hideTip();if(!event.target.closest?.('.box-details-body'))closeBoxDetails();},true);
bindMetricPills();
document.querySelectorAll('[data-icon]').forEach(item=>item.append(icon(item.dataset.icon)));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load({refreshStatus:true});});
updatePeriod();load();setInterval(()=>{if(!document.hidden)load({refreshStatus:true});},60000);
