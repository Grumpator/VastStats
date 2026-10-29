import {ZONE,dayKey,addDays,aggregate,currentStatus,demoData,fleetSnapshot,circleSegments} from './model.js?v=3.1.0';
import {loadHistoryData,applySnapshots,githubDataSource,periodRunCount} from './history-data.js?v=3.1.0';
import {windowEndForDate,timelineBins,moveWindow,visibleSlotCount,recordsForBin,isoWeek} from './timeline.js?v=3.1.0';
const $=s=>document.querySelector(s),fmt=(t,options)=>new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,...options}).format(t);
// Live data comes from the repository; it does not require a Pages deployment.
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const dataSource=local?async()=>new URL('data/',location.href):githubDataSource();
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
let selected=dayKey(new Date()),data={boxes:[]},demo=new URLSearchParams(location.search).has('demo');
let scale='hours',windowEnd=null,displayedEnd=null,slotCount=1;
function visibleBins(){return timelineBins(windowEnd??windowEndForDate(selected,scale),scale,slotCount);}
function updateSlotCount(){slotCount=visibleSlotCount($('.timeline').clientWidth,parseFloat(getComputedStyle($('#boxes')).getPropertyValue('--device-columns-width'))||340);}
function selectedDays(){
  const bins=visibleBins(),days=[];for(let key=bins[0].key;key<=dayKey(new Date(bins.at(-1).end-1));key=addDays(key,1))days.push(key);return days;
}
let recordsByBox=new Map(),countsByBox=new Map(),snapshotsByBox=new Map(),activeCell=null;

function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
function icon(kind,disabled=false){
  const paths={gpu:['M4 6h16v12H4Z','M8 10h8v4H8Z','M2 9h2','M2 15h2','M8 18v3','M12 18v3','M16 18v3','M20 10h2','M20 14h2'],power:['M12 2v10','M7 5a8 8 0 1 0 10 0'],tag:['M3 3h7l11 11-7 7L3 10Z','M7 7h.01'],wrench:['M14 3a6 6 0 0 0-7 8l-4 4a3 3 0 0 0 4 4l4-4a6 6 0 0 0 8-7l-4 3-3-3Z'],play:['M7 4l13 8-13 8Z'],pause:['M8 5v14','M16 5v14'],stored:['m12 3 10 5-10 5L2 8Z','m2 12 10 5 10-5','m2 16 10 5 10-5'],clock:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','M12 7v5l3 2'],info:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','M12 11v6','M12 7h.01']};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
  for(const d of [...paths[kind],...(disabled?['M3 3l18 18']:[])]){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}return svg;
}
function stateIcon(kind,state,label,count=null,disabled=false){
  const item=element('span','device-state '+state);item.title=label;item.setAttribute('role','img');item.setAttribute('aria-label',label);item.append(icon(kind,disabled));
  if(count!==null)item.append(element('span','device-count',String(count)));return item;
}
function closeBoxDetails(){document.querySelectorAll('.box-details[open]').forEach(details=>details.open=false);}
function deviceDetails(box,stat,status){
  const details=element('details','box-details'),summary=element('summary',status.stale?'overdue':'');summary.setAttribute('aria-label','Details for '+box.name);summary.title='Details for '+box.name;summary.append(icon('info'));
  const panel=element('div','box-details-body'),close=element('button','box-details-close','×');close.type='button';close.setAttribute('aria-label','Close '+box.name+' details');close.onclick=()=>{details.open=false;summary.focus();};panel.append(close,element('strong','',box.name+' · details'));
  const stamp=box.lastSample?.at,checked=stamp?fmt(Date.parse(stamp),{dateStyle:'medium',timeStyle:'short'}):'Unavailable';
  const running=status.running===false?0:box.lastSample?.runningInstances??'Unknown',stored=box.lastSample?.storedInstances??'Unknown';
  const lines=[['Status checked',checked+(status.stale?' · overdue':'')],['Connection',status.connection],['Listing',status.listed===true?'Listed':status.listed===false?'Unlisted':'Unknown'],['Maintenance',status.maintenance?'Active':status.next?'Planned from '+fmt(Date.parse(status.next.start),{dateStyle:'medium',timeStyle:'short'}):status.maintenance===false?'Off':'Unknown'],['Running instances',running],['Stored instances',stored],['GPUs',box.lastSample?.gpuCount??'Unknown'],['Observed occupancy',percent(stat.percent)],['Observed · selected period',stat.observed?duration(stat.observed):'None'],['Data coverage',stat.elapsed?coveragePercent(stat.coverage):'—'],['History through',box.dataThrough?fmt(Date.parse(box.dataThrough),{dateStyle:'medium',timeStyle:'short'}):'Unavailable']];
  if(box.historyError)lines.push(['History refresh','Failed; previous data retained']);
  else if(box.dataThrough&&Date.now()-Date.parse(box.dataThrough)>2*3600000)lines.push(['History delay',duration((Date.now()-Date.parse(box.dataThrough))/1000)]);
  if(box.historyStart)lines.push(['History available from',fmt(Date.parse(box.historyStart),{dateStyle:'medium',timeStyle:'short'})]);
  const dl=element('dl');for(const [label,value] of lines)dl.append(element('dt','',label),element('dd','',String(value)));panel.append(dl,element('p','','Icons describe the latest machine snapshot. Occupancy and observed time refer to the selected period.'));details.append(summary,panel);
  details.dataset.box=box.name;
  details.addEventListener('toggle',()=>{if(details.open){panel.classList.remove('above');const bounds=panel.getBoundingClientRect();if(bounds.bottom>innerHeight-12&&summary.getBoundingClientRect().top>bounds.height+12)panel.classList.add('above');}});
  return details;
}
function hideTip(){ $('#tooltip').hidden=true;if(activeCell)activeCell.removeAttribute('aria-describedby');activeCell=null; }
function drillInto(bin){
  const next={months:'weeks',weeks:'days',days:'hours'}[scale];if(!next)return false;
  selected=bin.key;scale=next;
  // End at the selected period's latest elapsed part, keeping its recent detail visible.
  const last=bin.start>Date.now()?bin.end-1:Math.min(bin.end-1,Date.now());
  windowEnd=windowEndForDate(dayKey(new Date(last)),scale);
  hideTip();load();return true;
}
function showTip(button,box,bin,value){
  const tip=$('#tooltip');tip.replaceChildren();
  const hourly=scale==='hours';
  const title=fmt(bin.start,{day:'numeric',month:'short',year:'numeric'})+(hourly?' · '+fmt(bin.start,{hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):['weeks','months'].includes(scale)?' – '+fmt(bin.end-1,{day:'numeric',month:'short',year:'numeric'}):'');
  tip.append(element('h4','',box.name+' · '+title));const dl=element('dl');
  if(value.state==='not-tracked')tip.append(element('p','','Before available history. Tracking begins '+fmt(Date.parse(box.historyStart),{dateStyle:'medium',timeStyle:'short'})+'. This time is excluded from data coverage; the API does not establish the box’s first boot.'));
  else{
  const segments=circleSegments(value);
  const lines=[['Confirmed occupancy',percent(segments.running)],['Within observed data',percent(value.percent)],['Unknown time',value.elapsed?duration(Math.max(0,value.elapsed-value.observed)):'—'],['Running time',duration(value.occupied)],['Runs during period',value.runCount??'—'],['Data coverage',coveragePercent(value.coverage)]];
  lines.push(['Offline time',value.connectionObserved?duration(value.offline):'Unknown'],['Maintenance time',value.maintenanceObserved?duration(value.maintenance):'Unknown']);
  lines.push(['Listed time',value.listingObserved?duration(value.listed):'Unknown'],['Unlisted time',value.listingObserved?duration(value.unlisted):'Unknown']);
  if(value.snapshotAt)lines.push(['State snapshot',fmt(Date.parse(value.snapshotAt),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})]);
  if(value.currentSnapshot)lines.push(['Running at snapshot',value.currentSnapshot.running===true?'Yes':value.currentSnapshot.running===false?'No':'Unknown']);
  for(const [name,value] of lines)dl.append(element('dt','',name),element('dd','',String(value)));tip.append(dl);
  tip.append(element('p','',value.state==='future'?'This period has not started.':value.observed?'API running intervals within reported telemetry. '+(incompleteCoverage(value)?'Some observations are missing.':''):value.currentSnapshot?'Latest machine snapshot only; no duration has been measured for this period.':'No telemetry recorded for this period yet.'));
  if(box.historyStart&&bin.start<Date.parse(box.historyStart)&&bin.end>Date.parse(box.historyStart))tip.append(element('p','','Only time from '+fmt(Date.parse(box.historyStart),{dateStyle:'medium',timeStyle:'short'})+' contributes to this circle and coverage.'));
  }
  tip.hidden=false;const r=button.getBoundingClientRect();tip.style.left=Math.max(10,Math.min(innerWidth-tip.offsetWidth-10,r.left+r.width/2-tip.offsetWidth/2))+'px';
  tip.style.top=(r.top>tip.offsetHeight+16?r.top-tip.offsetHeight-10:Math.min(innerHeight-tip.offsetHeight-10,r.bottom+10))+'px';
  if(activeCell)activeCell.removeAttribute('aria-describedby');activeCell=button;button.setAttribute('aria-describedby','tooltip');
}
function cell(box,bin){
  const rows=recordsByBox.get(box.name);
  const binRows=recordsForBin(rows,bin);
  const source={...box,snapshots:recordsForBin(snapshotsByBox.get(box.name),bin)};
  const value=applySnapshots(aggregate(binRows,bin.start,bin.end,Date.now(),Date.parse(box.historyStart)),source,bin,Date.now(),data.snapshotMaxAgeSeconds??5400);
  value.runCount=value.state==='not-tracked'?null:periodRunCount(['weeks','months'].includes(scale)?{hours:binRows,runCounts:recordsForBin(countsByBox.get(box.name),bin)}:box,bin);
  const b=element('button','cell '+value.state+' border-'+value.borderState+(incompleteCoverage(value)?' incomplete':'')+(value.isNow?' now':''),value.state==='not-tracked'?'–':value.runCount??'');
  const segments=circleSegments(value);
  if(segments.running!==null){b.classList.add('measured');if(segments.running>=100-1e-7)b.classList.add('complete-running');b.style.setProperty('--running',segments.running+'%');b.style.setProperty('--observed',segments.observed+'%');}
  if(value.runCount>99)b.classList.add('many-runs');
  b.type='button';b.setAttribute('aria-label',box.name+', '+fmt(bin.start,{dateStyle:'medium',timeStyle:'short'})+', '+(value.percent==null?'no data':percent(segments.running)+' confirmed occupancy, '+percent(value.percent)+' within observed data')+', '+(value.runCount??'unknown')+' runs during period'+(incompleteCoverage(value)?', incomplete data':'')+(value.borderState!=='unknown'?', '+value.borderState+' border':'')+(value.maintenance?', includes maintenance':'')+(value.isNow?', current period':'')+(value.snapshotAt?', snapshot at '+fmt(Date.parse(value.snapshotAt),{timeStyle:'short'}):''));
  if(value.state==='not-tracked')b.setAttribute('aria-label',box.name+', '+fmt(bin.start,{dateStyle:'medium'})+', before available history; excluded from data coverage');
  b.addEventListener('mouseenter',()=>showTip(b,box,bin,value));b.addEventListener('mouseleave',hideTip);b.addEventListener('focus',()=>showTip(b,box,bin,value));b.addEventListener('blur',hideTip);b.addEventListener('click',e=>{e.stopPropagation();if(!drillInto(bin))showTip(b,box,bin,value);});return b;
}
function render(){
  const detailsOpenFor=document.querySelector('.box-details[open]')?.dataset.box;
  hideTip();updateSlotCount();const bins=visibleBins(),start=bins[0].start,end=bins.at(-1).end;displayedEnd=end;
  document.querySelectorAll('[data-scale]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scale===scale)));
  $('#period').textContent=fmt(start,{day:'numeric',month:'short',year:'numeric',...(scale==='hours'?{hour:'2-digit',minute:'2-digit'}:{})})+' – '+fmt(end-1,{day:'numeric',month:'short',year:'numeric',...(scale==='hours'?{hour:'2-digit',minute:'2-digit',timeZoneName:'short'}:{})});
  if(scale==='weeks'){const first=isoWeek(bins[0].key),last=isoWeek(bins.at(-1).key);$('#period').textContent='Week '+first.week+'/'+first.year+(bins.length>1?' – Week '+last.week+'/'+last.year:'');}
  $('#previous').title='Previous '+slotCount+' '+scale;$('#next').title='Next '+slotCount+' '+scale;
  $('#resolution').textContent=('One circle = one '+({hours:'hour',days:'day',weeks:'week',months:'month'}[scale]))+' · Numbers = runs during period';
  const stats=data.boxes.map(b=>aggregate(b.hours,start,end,Date.now(),Date.parse(b.historyStart)));let obs=0,occ=0,elapsed=0;
  stats.forEach(s=>{obs+=s.observed;occ+=s.occupied;elapsed+=s.elapsed;});
  $('#occupancy').textContent=percent(obs?occ/obs*100:null);$('#coverage').textContent=elapsed?coveragePercent(obs/elapsed):'—';
  $('#hours').textContent=obs?duration(occ):'—';
  const fleet=fleetSnapshot(data.boxes,Date.now(),data.snapshotMaxAgeSeconds??5400);
  for(const field of ['online','listed','maintenance','running'])$('#'+field+'-boxes').textContent=(fleet[field]??'—')+'/'+fleet.total;
  $('#stored').textContent=fleet.stored??'—';
  $('#running-note').textContent=(fleet.runningInstances??'—')+' instances';
  $('#stored-note').textContent=fleet.storage==null?'instances · size unknown':fleet.storage.toLocaleString('en-GB',{maximumFractionDigits:1})+' GB allocated';
  $('#snapshot-note').textContent=fleet.overdue?'· '+fleet.overdue+' overdue':'· latest snapshot';
  $('.now-group').classList.toggle('overdue',fleet.overdue>0);
  const boxes=$('#boxes');boxes.replaceChildren();boxes.className='device-table';
  // Shared column widths use the largest count in the fleet, never the row's own count.
  for(const [field,property] of [['runningInstances','running'],['storedInstances','stored'],['gpuCount','gpu']])boxes.style.setProperty('--'+property+'-digits',Math.max(1,...data.boxes.map(b=>String(b.lastSample?.[field]??'?').length)));
  for(const [field,property] of [['listed','listed'],['online','connection'],['maintenance','maintenance']])boxes.style.setProperty('--'+property+'-extra',fleet[field]===null?'.7em':'0px');
  $('#timeline-axis')?.remove();
  {
    const axis=element('div','timeline-axis');axis.id='timeline-axis';axis.setAttribute('aria-hidden','true');axis.append(element('span','timeline-axis-meta','Device · latest state · occupancy'));
    const labels=element('div','timeline-circles timeline-labels');
    for(const bin of bins){const week=scale==='weeks'?isoWeek(bin.key):null,label=element('span','',week?'W'+week.week:fmt(bin.start,scale==='hours'?{hour:'2-digit',hourCycle:'h23'}:scale==='months'?{month:'short'}:{day:'numeric'}));label.title=fmt(bin.start,{dateStyle:'full',...(scale==='hours'?{timeStyle:'short'}:{})});label.append(element('small','',week?String(week.year):fmt(bin.start,scale==='hours'?{day:'numeric',month:'short'}:scale==='months'?{year:'numeric'}:{month:'short'})));labels.append(label);}
    axis.append(labels);boxes.before(axis);
  }
  data.boxes.forEach((box,index)=>{
    recordsByBox.set(box.name,box.hours.filter(r=>Date.parse(r.end)>start&&Date.parse(r.start)<end).map(r=>({...r,startMs:Date.parse(r.start),endMs:Date.parse(r.end)})).sort((a,b)=>a.startMs-b.startMs));
    countsByBox.set(box.name,(box.runCounts||[]).map(r=>({...r,startMs:Date.parse(r.start),endMs:Date.parse(r.end)})).sort((a,b)=>a.startMs-b.startMs));snapshotsByBox.set(box.name,(box.snapshots||[]).map(r=>({...r,startMs:Date.parse(r.at),endMs:Date.parse(r.at)+1})).sort((a,b)=>a.startMs-b.startMs));
    const card=element('article','box'),header=element('div','box-header'),title=element('div','box-title'),heading=element('h3','',box.name);heading.title=box.name;title.append(heading);
    const status=currentStatus(box.lastSample,Date.now(),data.snapshotMaxAgeSeconds??5400),states=element('div','device-states'+(status.stale?' outdated':''));states.setAttribute('aria-label','Latest snapshot for '+box.name);
    const stamp=box.lastSample?.at,when=stamp?' · checked '+fmt(Date.parse(stamp),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
    const running=status.running===false?0:box.lastSample?.runningInstances??'?';
    states.append(stateIcon(status.running===false?'pause':'play',status.running?'active':'muted','Running instances: '+running+when,running));
    states.append(stateIcon('tag',status.listed===true?'active':'muted',status.listed===true?'Listed'+when:status.listed===false?'Unlisted'+when:'Listing unknown'+when,status.listed===null?'?':null,status.listed===false));
    states.append(stateIcon('power',status.connection,'Connection: '+status.connection+when,status.connection==='unknown'?'?':null,status.connection==='offline'));
    states.append(stateIcon(status.next&&!status.maintenance?'clock':'wrench',status.maintenance||status.next?'maintenance':'muted',status.maintenance?'Maintenance active'+when:status.next?'Maintenance planned: '+fmt(Date.parse(status.next.start),{dateStyle:'medium',timeStyle:'short'}):status.maintenance===false?'Maintenance off'+when:'Maintenance unknown'+when,status.maintenance===null&&!status.next?'?':null,status.maintenance===false&&!status.next));
    states.append(stateIcon('stored','muted','Stored instances: '+(box.lastSample?.storedInstances??'unknown')+when,box.lastSample?.storedInstances??'?'));
    states.append(stateIcon('gpu','muted','GPUs: '+(box.lastSample?.gpuCount??'unknown')+when,box.lastSample?.gpuCount??'?'));
    title.append(states);const metric=element('div','box-percent',percent(stats[index].percent));metric.title='Occupancy within observed data in the selected period; see details for coverage';
    const actions=element('div','box-actions'),details=deviceDetails(box,stats[index],status);actions.append(metric,details);header.append(title,actions);card.append(header);
    const scroll=element('div','timeline-circles');for(const bin of bins)scroll.append(cell(box,bin));
    card.append(scroll);boxes.append(card);if(box.name===detailsOpenFor)details.open=true;
  });
  const updated=data.updatedAt?Date.parse(data.updatedAt):null,stale=updated&&Date.now()-updated>2*3600000;
  $('.freshness').classList.toggle('live',!!updated&&!stale&&!demo);$('#freshness').textContent=demo?'Sample data':updated?(stale?'Update overdue · ':'Updated ')+fmt(updated,{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}):'Waiting for API history';
  $('#notice').textContent=demo?'SAMPLE DATA · Illustrative history for exploring the views. These are not actual rental figures.':!updated?'Waiting for the first history import. Missing telemetry will remain grey.':stale?'Refresh is overdue. Available API history is shown; a later refresh can recover missed periods.':'';
  if(!demo&&data.boxes.some(b=>b.historyError))$('#notice').textContent='Some history could not be refreshed. Previously imported data has been kept.';
  $('#demo').textContent=demo?'Return to recorded data ↗':'Explore sample data ↗';
}
async function load(){
  const generation=++loadGeneration;
  if(demo){data=demoData();render();return;}
  try{updateSlotCount();const next=await loadHistoryData(await dataSource(),selectedDays());if(generation!==loadGeneration)return;data=next;render();}
  catch{if(generation===loadGeneration)$('#notice').textContent='Could not load the API history summaries. The last loaded view is retained.';}
}

document.querySelectorAll('[data-scale]').forEach(b=>b.addEventListener('click',()=>{scale=b.dataset.scale;windowEnd=windowEndForDate(selected,scale);load();}));
function move(direction){updateSlotCount();windowEnd=moveWindow(windowEnd??displayedEnd??windowEndForDate(selected,scale),scale,slotCount,direction);selected=dayKey(new Date(windowEnd-1));load();}
$('#previous').onclick=()=>move(-1);$('#next').onclick=()=>move(1);$('#today').onclick=()=>{selected=dayKey(new Date());windowEnd=null;load();};
$('#demo').onclick=()=>{demo=!demo;const url=new URL(location);demo?url.searchParams.set('demo','1'):url.searchParams.delete('demo');history.replaceState(null,'',url);load();};
const metricHelp={
  occupancy:['Fleet occupancy','The percentage of observed box-time with at least one running rental in the selected period. Running box-hours ÷ observed box-hours × 100. For example, three boxes observed for 24 hours provide 72 box-hours; 36 running box-hours means 50% occupancy. This measures box-time, not GPU capacity: one busy GPU on a four-GPU box counts as occupied box-time. Only available telemetry contributes to the calculation. Current offline status does not rewrite historical occupancy.'],
  hours:['Hours','Running box-hours across all boxes in the selected period. One box with at least one running rental for one hour contributes one box-hour; two boxes running for three hours each contribute six. Multiple simultaneous rentals on one box do not multiply its time. Fleet occupancy is running box-hours divided by observed box-hours. Missing or delayed telemetry is excluded. Running intervals come from the API and can be backfilled later.'],
  now:['Now · latest fleet snapshot','Running, Listed, Online and Maintenance count boxes in that state out of the entire fleet. Running also shows the total running instances. Stored totals retained instances, including running ones; do not add running and stored counts. GB allocated is allocated disk space, not measured file usage. These figures use the latest machine snapshots and do not change with the selected period. They are not live: collection is hourly and snapshots become overdue after 90 minutes. If any box has an unknown state or count, its fleet total shows a dash rather than assuming zero.'],
  coverage:['Data coverage','The proportion of elapsed box-time in the selected period with reporting coverage from the telemetry API. Native API buckets up to five minutes are accepted; raw samples contribute one second each. It excludes future time and time before each device’s earliest known history boundary. This boundary comes from the telemetry archive, not a proven first boot; it is kept when the archive later advances. A dash marks periods before tracking. Gaps in telemetry are unknown, not idle. Fleet occupancy is calculated from the known portion, so read occupancy together with coverage.']
};
function closeMetricHelp(){ $('#metric-details').hidden=true;document.querySelectorAll('[data-info]').forEach(b=>b.setAttribute('aria-expanded','false')); }
document.querySelectorAll('[data-info]').forEach(button=>button.addEventListener('click',()=>{
  const wasOpen=button.getAttribute('aria-expanded')==='true';closeMetricHelp();if(wasOpen)return;
  const [title,copy]=metricHelp[button.dataset.info];$('#metric-details-title').textContent=title;$('#metric-details-copy').textContent=copy;$('#metric-details').hidden=false;button.setAttribute('aria-expanded','true');
}));
$('#close-metric-details').onclick=closeMetricHelp;
$('#close-view-help').onclick=()=>{$('#view-help').open=false;$('#view-help>summary').focus();};
document.addEventListener('click',event=>{if(!$('#view-help').contains(event.target))$('#view-help').open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#view-help').open){$('#view-help').open=false;$('#view-help>summary').focus();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMetricHelp();});
document.addEventListener('click',event=>{hideTip();document.querySelectorAll('.box-details[open]').forEach(details=>{if(!details.contains(event.target))details.open=false;});});document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideTip();closeBoxDetails();}});window.addEventListener('resize',hideTip);window.addEventListener('scroll',hideTip,true);
document.querySelectorAll('[data-icon]').forEach(item=>item.append(icon(item.dataset.icon)));
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{const previous=slotCount;updateSlotCount();if(previous!==slotCount)load();},150);});
updateSlotCount();load();setInterval(load,60000);
