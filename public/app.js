import {ZONE,dayKey,addDays,midnight,periodDays,binsForDay,aggregate,currentStatus,demoData} from './model.js?v=1.1.0';
const $=s=>document.querySelector(s),fmt=(t,options)=>new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,...options}).format(t);
const percent=n=>n==null?'—':n.toFixed(1)+'%',money=n=>n==null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
let view='week',selected=dayKey(new Date()),data={boxes:[]},demo=new URLSearchParams(location.search).has('demo');
let recordsByBox=new Map(),activeCell=null;
$('#date').value=selected;
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
function hideTip(){ $('#tooltip').hidden=true;if(activeCell)activeCell.removeAttribute('aria-describedby');activeCell=null; }
function showTip(button,box,bin,value){
  const tip=$('#tooltip');tip.replaceChildren();
  const title=fmt(bin.start,{day:'numeric',month:'short',year:'numeric'})+(view==='week'?' · '+fmt(bin.start,{hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):'');
  tip.append(element('h4','',box.name+' · '+title));const dl=element('dl');
  const lines=[['Occupancy',percent(value.percent)],['Running time',(value.occupied/3600).toFixed(2)+' h'],['Retained instances',value.stored??'—'],['Income (USD)',money(value.income)],['Data coverage',percent(value.coverage*100)]];
  lines.push(['Offline time',value.connectionObserved?(value.offline/3600).toFixed(2)+' h':'Unknown'],['Maintenance time',value.maintenanceObserved?(value.maintenance/3600).toFixed(2)+' h':'Unknown']);
  lines.push(['Listed time',value.listingObserved?(value.listed/3600).toFixed(2)+' h':'Unknown'],['Unlisted time',value.listingObserved?(value.unlisted/3600).toFixed(2)+' h':'Unknown']);
  for(const [name,value] of lines)dl.append(element('dt','',name),element('dd','',String(value)));tip.append(dl);
  tip.append(element('p','',value.state==='future'?'This period has not started.':value.observed?'Sampled occupancy; count at last observation. '+(value.coverage<.95?'Some observations are missing.':''):'No observations recorded for this period.'));
  tip.hidden=false;const r=button.getBoundingClientRect();tip.style.left=Math.max(10,Math.min(innerWidth-tip.offsetWidth-10,r.left+r.width/2-tip.offsetWidth/2))+'px';
  tip.style.top=(r.top>tip.offsetHeight+16?r.top-tip.offsetHeight-10:Math.min(innerHeight-tip.offsetHeight-10,r.bottom+10))+'px';
  if(activeCell)activeCell.removeAttribute('aria-describedby');activeCell=button;button.setAttribute('aria-describedby','tooltip');
}
function cell(box,bin,calendar=false){
  const value=aggregate(recordsByBox.get(box.name),bin.start,bin.end);
  const b=element('button','cell '+value.state+' border-'+value.borderState+(value.observed&&value.coverage<.95?' incomplete':''),value.stored??'');
  b.type='button';b.setAttribute('aria-label',box.name+', '+fmt(bin.start,{dateStyle:'medium',timeStyle:'short'})+', '+(value.percent==null?'no data':percent(value.percent)+' occupancy')+', '+(value.stored??'unknown')+' parked instances'+(value.borderState!=='unknown'?', '+value.borderState+' border':'')+(value.maintenance?', includes maintenance':''));
  if(calendar)b.append(element('span','day-number',String(Number(bin.key.slice(-2)))));
  b.addEventListener('mouseenter',()=>showTip(b,box,bin,value));b.addEventListener('mouseleave',hideTip);b.addEventListener('focus',()=>showTip(b,box,bin,value));b.addEventListener('blur',hideTip);b.addEventListener('click',e=>{e.stopPropagation();showTip(b,box,bin,value);});return b;
}
function render(){
  hideTip();const days=periodDays(selected,view),start=midnight(days[0]),end=midnight(addDays(days.at(-1),1));
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  const title=view==='year'?selected.slice(0,4):view==='month'?fmt(start,{month:'long',year:'numeric'}):fmt(start,{day:'numeric',month:'short'})+' – '+fmt(end-1,{day:'numeric',month:'short',year:'numeric'});
  $('#period').textContent=title;$('#resolution').textContent=(view==='week'?'One square = one hour':'One square = one day')+' · Numbers = retained instances';
  const stats=data.boxes.map(b=>aggregate(b.hours,start,end));let obs=0,occ=0,elapsed=0;
  stats.forEach(s=>{obs+=s.observed;occ+=s.occupied;elapsed+=s.elapsed;});
  $('#occupancy').textContent=percent(obs?occ/obs*100:null);$('#hours').textContent=obs?(occ/3600).toFixed(1):'—';$('#coverage').textContent=elapsed?percent(obs/elapsed*100):'—';
  const latest=data.boxes.map(b=>b.lastSample?b.lastSample.storedInstances:b.hours.at(-1)?.storedInstances);$('#stored').textContent=latest.length&&latest.every(n=>n!=null)?latest.reduce((a,b)=>a+b,0):'—';
  const boxes=$('#boxes');boxes.replaceChildren();boxes.className=view==='month'?'month-boxes':'';
  data.boxes.forEach((box,index)=>{
    recordsByBox.set(box.name,box.hours.filter(r=>Date.parse(r.end)>start&&Date.parse(r.start)<end).map(r=>({...r,startMs:Date.parse(r.start),endMs:Date.parse(r.end)})));
    const card=element('article','box');const header=element('div','box-header'),title=element('div','box-title'),text=element('div');
    const heading=element('div','box-heading');heading.append(element('h3','',box.name));
    const status=currentStatus(box.lastSample),badges=element('div','status-badges');
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
  const updated=data.updatedAt?Date.parse(data.updatedAt):null,stale=updated&&Date.now()-updated>20*60000;
  $('.freshness').classList.toggle('live',!!updated&&!stale&&!demo);$('#freshness').textContent=demo?'Sample data':updated?(stale?'Update overdue · ':'Updated ')+fmt(updated,{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}):'Waiting for first update';
  $('#notice').textContent=demo?'SAMPLE DATA · Illustrative history for exploring the views. These are not actual rental figures.':!updated?'Ready for the first collection. Missing history will stay grey; it will never be filled with invented data.':stale?'Updates are overdue. The grid shows the last recorded observations; gaps are not counted as idle.':'';
  $('#demo').textContent=demo?'Return to recorded data ↗':'Explore sample data ↗';
}
async function load(){
  if(demo){data=demoData();render();return;}
  try{const response=await fetch('data.json',{cache:'no-store'});if(!response.ok)throw new Error();const next=await response.json();if(next.version!==1||!Array.isArray(next.boxes))throw new Error();data=next;render();}
  catch{$('#notice').textContent='Could not refresh the data. Please try again shortly.';}
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;render();}));
$('#date').addEventListener('change',()=>{if($('#date').value){selected=$('#date').value;render();}});
function move(direction){if(view==='week')selected=addDays(selected,direction*7);else{const d=new Date(selected.slice(0,7)+'-01T12:00Z');if(view==='month')d.setUTCMonth(d.getUTCMonth()+direction);else d.setUTCFullYear(d.getUTCFullYear()+direction);selected=d.toISOString().slice(0,10);}$('#date').value=selected;render();}
$('#previous').onclick=()=>move(-1);$('#next').onclick=()=>move(1);$('#today').onclick=()=>{selected=dayKey(new Date());$('#date').value=selected;render();};
$('#demo').onclick=()=>{demo=!demo;const url=new URL(location);demo?url.searchParams.set('demo','1'):url.searchParams.delete('demo');history.replaceState(null,'',url);load();};
document.addEventListener('click',hideTip);document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip();});window.addEventListener('resize',hideTip);window.addEventListener('scroll',hideTip,true);
load();setInterval(load,60000);
