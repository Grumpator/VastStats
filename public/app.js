import {ZONE,dayKey,addDays,midnight,periodDays,binsForDay,aggregate,currentStatus,demoData} from './model.js?v=2.0.0';
import {loadHistoryData,applySnapshots} from './history-data.js?v=2.0.0';
const $=s=>document.querySelector(s),fmt=(t,options)=>new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,...options}).format(t);
// Live data comes from the repository; it does not require a Pages deployment.
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const dataBase=local?new URL('data/',location.href):new URL('https://raw.githubusercontent.com/Grumpator/VastStats/main/public/data/');
let loadGeneration=0;
const percent=n=>n==null?'—':n.toFixed(1)+'%';
let view='week',selected=dayKey(new Date()),data={boxes:[]},demo=new URLSearchParams(location.search).has('demo');
let recordsByBox=new Map(),activeCell=null;
$('#date').value=selected;
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
function hideTip(){ $('#tooltip').hidden=true;if(activeCell)activeCell.removeAttribute('aria-describedby');activeCell=null; }
function showTip(button,box,bin,value){
  const tip=$('#tooltip');tip.replaceChildren();
  const title=fmt(bin.start,{day:'numeric',month:'short',year:'numeric'})+(view==='week'?' · '+fmt(bin.start,{hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):'');
  tip.append(element('h4','',box.name+' · '+title));const dl=element('dl');
  const lines=[['Occupancy',percent(value.percent)],['Running time',(value.occupied/3600).toFixed(2)+' h'],['Stored · last observation',value.stored??'—'],['Data coverage',percent(value.coverage*100)]];
  lines.push(['Offline time',value.connectionObserved?(value.offline/3600).toFixed(2)+' h':'Unknown'],['Maintenance time',value.maintenanceObserved?(value.maintenance/3600).toFixed(2)+' h':'Unknown']);
  lines.push(['Listed time',value.listingObserved?(value.listed/3600).toFixed(2)+' h':'Unknown'],['Unlisted time',value.listingObserved?(value.unlisted/3600).toFixed(2)+' h':'Unknown']);
  if(value.snapshotAt)lines.push(['State snapshot',fmt(Date.parse(value.snapshotAt),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})]);
  for(const [name,value] of lines)dl.append(element('dt','',name),element('dd','',String(value)));tip.append(dl);
  tip.append(element('p','',value.state==='future'?'This period has not started.':value.observed?'API running intervals within reported telemetry. '+(value.coverage<.95?'Some observations are missing.':''):value.currentSnapshot?'Latest machine snapshot only; no duration has been measured for this period.':'No telemetry recorded for this period yet.'));
  tip.hidden=false;const r=button.getBoundingClientRect();tip.style.left=Math.max(10,Math.min(innerWidth-tip.offsetWidth-10,r.left+r.width/2-tip.offsetWidth/2))+'px';
  tip.style.top=(r.top>tip.offsetHeight+16?r.top-tip.offsetHeight-10:Math.min(innerHeight-tip.offsetHeight-10,r.bottom+10))+'px';
  if(activeCell)activeCell.removeAttribute('aria-describedby');activeCell=button;button.setAttribute('aria-describedby','tooltip');
}
function cell(box,bin,calendar=false){
  const value=applySnapshots(aggregate(recordsByBox.get(box.name),bin.start,bin.end),box,bin,Date.now(),data.snapshotMaxAgeSeconds??5400);
  const b=element('button','cell '+value.state+' border-'+value.borderState+(value.observed&&value.coverage<.95?' incomplete':'')+(value.isNow?' now':''),value.stored??'');
  b.type='button';b.setAttribute('aria-label',box.name+', '+fmt(bin.start,{dateStyle:'medium',timeStyle:'short'})+', '+(value.percent==null?'no data':percent(value.percent)+' occupancy')+', '+(value.stored??'unknown')+' stored instances'+(value.borderState!=='unknown'?', '+value.borderState+' border':'')+(value.maintenance?', includes maintenance':'')+(value.isNow?', current period':'')+(value.snapshotAt?', snapshot at '+fmt(Date.parse(value.snapshotAt),{timeStyle:'short'}):''));
  if(calendar)b.append(element('span','day-number',String(Number(bin.key.slice(-2)))));
  b.addEventListener('mouseenter',()=>showTip(b,box,bin,value));b.addEventListener('mouseleave',hideTip);b.addEventListener('focus',()=>showTip(b,box,bin,value));b.addEventListener('blur',hideTip);b.addEventListener('click',e=>{e.stopPropagation();showTip(b,box,bin,value);});return b;
}
function render(){
  hideTip();const days=periodDays(selected,view),start=midnight(days[0]),end=midnight(addDays(days.at(-1),1));
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  const title=view==='year'?selected.slice(0,4):view==='month'?fmt(start,{month:'long',year:'numeric'}):fmt(start,{day:'numeric',month:'short'})+' – '+fmt(end-1,{day:'numeric',month:'short',year:'numeric'});
  $('#period').textContent=title;$('#resolution').textContent=(view==='week'?'One square = one hour':'One square = one day')+' · Numbers = stored instances';
  const stats=data.boxes.map(b=>aggregate(b.hours,start,end));let obs=0,occ=0,elapsed=0;
  stats.forEach(s=>{obs+=s.observed;occ+=s.occupied;elapsed+=s.elapsed;});
  $('#occupancy').textContent=percent(obs?occ/obs*100:null);$('#coverage').textContent=elapsed?percent(obs/elapsed*100):'—';
  const totalLatest=field=>{const values=data.boxes.map(b=>b.lastSample?.[field]);return values.length&&values.every(n=>Number.isFinite(n)&&n>=0)?values.reduce((a,b)=>a+b,0):null;};
  const running=totalLatest('runningInstances'),storage=totalLatest('allocatedStorageGb');
  $('#running').textContent=running??'—';$('#hours').textContent=obs?(occ/3600).toFixed(1):'—';
  $('#stored-note').textContent=storage==null?'latest Vast instance counts':storage.toLocaleString('en-GB',{maximumFractionDigits:1})+' GB allocated · latest';
  const latest=data.boxes.map(b=>b.lastSample?b.lastSample.storedInstances:b.hours.at(-1)?.storedInstances);$('#stored').textContent=latest.length&&latest.every(n=>n!=null)?latest.reduce((a,b)=>a+b,0):'—';
  const boxes=$('#boxes');boxes.replaceChildren();boxes.className=view==='month'?'month-boxes':'';
  data.boxes.forEach((box,index)=>{
    recordsByBox.set(box.name,box.hours.filter(r=>Date.parse(r.end)>start&&Date.parse(r.start)<end).map(r=>({...r,startMs:Date.parse(r.start),endMs:Date.parse(r.end)})));
    const card=element('article','box');const header=element('div','box-header'),title=element('div','box-title'),text=element('div');
    const heading=element('div','box-heading');heading.append(element('h3','',box.name));
    const status=currentStatus(box.lastSample,Date.now(),data.snapshotMaxAgeSeconds??5400),badges=element('div','status-badges');
    const labels={online:'Online',offline:'Offline',unknown:'Status unknown',stale:'Status out of date'};
    badges.append(element('span','status-badge '+status.connection,labels[status.connection]));
    badges.append(element('span','status-badge '+(status.listed===true?'listed':status.listed===false?'unlisted':'unknown'),status.listed===true?'Listed':status.listed===false?'Unlisted':'Listing unknown'));
    if(status.maintenance)badges.append(element('span','status-badge maintenance','Maintenance'));
    else if(status.next){const badge=element('span','status-badge planned','Maintenance planned');badge.title='Starts '+fmt(Date.parse(status.next.start),{dateStyle:'medium',timeStyle:'short'});badges.append(badge);}
    heading.append(badges);
    text.append(heading,element('p','box-caption',stats[index].observed?(stats[index].observed/3600).toFixed(1)+' hours observed':'Awaiting observations'));
    title.append(element('span','box-avatar',box.name[0]),text);const metric=element('div','box-percent',percent(stats[index].percent));metric.append(element('small','','occupancy'));header.append(title,metric);card.append(header);
    const scroll=element('div','grid-scroll');
    if(view==='week') {
      const labels=element('div','hour-labels');labels.append(element('span'));for(let h=0;h<24;h++)labels.append(element('span','',String(h).padStart(2,'0')));scroll.append(labels);
      for(const day of days){
        const line=element('div','hour-line'),label=element('div','day-label');label.append(element('strong','',fmt(midnight(day),{weekday:'short'})),document.createTextNode(day.slice(-2)));line.append(label);
        const bins=binsForDay(day,true);for(const bin of bins)line.append(cell(box,bin));
        if(bins.length!==24)line.setAttribute('aria-label','Clock change day: '+bins.length+' hours. Hover each square for its timezone.');scroll.append(line);
      }
      if(days.some(d=>binsForDay(d,true).length!==24))scroll.append(element('p','box-caption','Clock change: this period includes a 23- or 25-hour day. Squares follow actual hours; hover for GMT/BST.'));
    }else if(view==='month'){
      const grid=element('div','calendar');for(const d of ['M','T','W','T','F','S','S'])grid.append(element('span','weekday',d));
      const padding=(new Date(days[0]+'T12:00Z').getUTCDay()+6)%7;for(let i=0;i<padding;i++)grid.append(element('span','blank'));
      for(const day of days)grid.append(cell(box,binsForDay(day,false)[0],true));scroll.append(grid);
    }else{
      const months=element('div','year-months');for(let m=0;m<12;m++)months.append(element('span','',fmt(new Date(Number(selected.slice(0,4)),m,15),{month:'short'})));scroll.append(months);
      const grid=element('div','year-grid');const padding=(new Date(days[0]+'T12:00Z').getUTCDay()+6)%7;for(let i=0;i<padding;i++)grid.append(element('span','blank'));for(const day of days)grid.append(cell(box,binsForDay(day,false)[0]));scroll.append(grid);
    }
    card.append(scroll);boxes.append(card);
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
  try{const next=await loadHistoryData(dataBase,selected,view);if(generation!==loadGeneration)return;data=next;render();}
  catch{if(generation===loadGeneration)$('#notice').textContent='Could not load the API history summaries. The last loaded view is retained.';}
}

document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;load();}));
$('#date').addEventListener('change',()=>{if($('#date').value){selected=$('#date').value;load();}});
function move(direction){if(view==='week')selected=addDays(selected,direction*7);else{const d=new Date(selected.slice(0,7)+'-01T12:00Z');if(view==='month')d.setUTCMonth(d.getUTCMonth()+direction);else d.setUTCFullYear(d.getUTCFullYear()+direction);selected=d.toISOString().slice(0,10);}$('#date').value=selected;load();}
$('#previous').onclick=()=>move(-1);$('#next').onclick=()=>move(1);$('#today').onclick=()=>{selected=dayKey(new Date());$('#date').value=selected;render();};
$('#demo').onclick=()=>{demo=!demo;const url=new URL(location);demo?url.searchParams.set('demo','1'):url.searchParams.delete('demo');history.replaceState(null,'',url);load();};
const metricHelp={
  occupancy:['Fleet occupancy','The percentage of observed box-time with at least one running rental in the selected period. Running box-hours ÷ observed box-hours × 100. For example, three boxes observed for 24 hours provide 72 box-hours; 36 running box-hours means 50% occupancy. Only available telemetry contributes to the calculation. Current offline status does not rewrite historical occupancy.'],
  hours:['Hours','Running box-hours across all boxes in the selected period. One box with at least one running rental for one hour contributes one box-hour; two boxes running for three hours each contribute six. Multiple simultaneous rentals on one box do not multiply its time. Fleet occupancy is running box-hours divided by observed box-hours. Missing or delayed telemetry is excluded. Running intervals come from the API and can be backfilled later.'],
  images:['Images · Running / Stored','Latest customer instance counts reported by Vast across all boxes. Running is the number currently running; Stored includes both running and stopped instances, so the two counts should not be added together. These current snapshots do not change with the historical period. Offline counters can lag a disconnection. GB allocated totals Vast’s allocated disk space, not actual instance file usage, and can include other Vast allocations. It is shown only when every box reports a size.'],
  coverage:['Data coverage','The proportion of elapsed box-time in the selected period with reporting coverage from the telemetry API. Native API buckets up to five minutes are accepted; raw samples contribute one second each. It excludes future time. Gaps between collections are unknown, not idle. Fleet occupancy is calculated from the known portion, so read occupancy together with coverage.']
};
function closeMetricHelp(){ $('#metric-details').hidden=true;document.querySelectorAll('[data-info]').forEach(b=>b.setAttribute('aria-expanded','false')); }
document.querySelectorAll('[data-info]').forEach(button=>button.addEventListener('click',()=>{
  const wasOpen=button.getAttribute('aria-expanded')==='true';closeMetricHelp();if(wasOpen)return;
  const [title,copy]=metricHelp[button.dataset.info];$('#metric-details-title').textContent=title;$('#metric-details-copy').textContent=copy;$('#metric-details').hidden=false;button.setAttribute('aria-expanded','true');
}));
$('#close-metric-details').onclick=closeMetricHelp;
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMetricHelp();});
document.addEventListener('click',hideTip);document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip();});window.addEventListener('resize',hideTip);window.addEventListener('scroll',hideTip,true);
load();setInterval(load,60000);
