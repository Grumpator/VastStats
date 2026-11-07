import {bindPopover} from './popover.js?v=1.0.0';
import {everythingStats,showDeviceTip,hideDeviceTip} from './device-info.js?v=1.0.0';
import {collectionNotice} from './api.js?v=1.0.0';
import {element,icon} from './ui.js?v=1.0.0';
import {renderNow,bindMetricPills} from './now.js?v=1.0.0';
import {percentLabel,coverageLabel,ZONE} from './model.js?v=1.0.0';
import {tileState,tileLayout} from './overview-model.js?v=1.0.0';
import {statusSource} from './status-data.js?v=1.0.0';
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search);
const source=statusSource({endpoint:'/api/overview'});
const labels={running:'Listed and running',listed:'Listed and online',offline:'Listed and offline','maintenance-running':'Maintenance and running',maintenance:'Maintenance and online','maintenance-offline':'Maintenance and offline','unlisted-running':'Unlisted and running',unlisted:'Unlisted and online','offline-unlisted':'Unlisted and offline',unknown:'Status unavailable'};
function activityIndicator(){
  const bars=element('span','activity-bars');bars.setAttribute('aria-hidden','true');
  for(let i=0;i<3;i++)bars.append(element('span','activity-bar'));
  return bars;
}
const runningStates=new Set(['running','maintenance-running','unlisted-running']),offlineStates=new Set(['offline','maintenance-offline','offline-unlisted']);
function addStateMarker(tile,state,stale=false,hasSnapshot=true){
  if(state==='unknown')tile.append(element('span','unknown-indicator','?'));
  if(stale){if(hasSnapshot)tile.append(icon('clock'));return;}
  if(runningStates.has(state))tile.append(activityIndicator());
  else if(offlineStates.has(state)){const marker=element('span','offline-indicator');marker.setAttribute('aria-hidden','true');marker.append(icon('power',true));tile.append(marker);}
}
const fmt=stamp=>new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,dateStyle:'medium',timeStyle:'short'}).format(Date.parse(stamp));
let data={boxes:[]},demo=params.has('demo'),loading=false,active=null;
function demoFleet(){
  const now=Date.now(),stamp=new Date(now).toISOString(),count=Math.max(1,Math.min(1000,Number(params.get('count'))||40));
  return {updatedAt:stamp,snapshotMaxAgeSeconds:900,earnings:{computeUsdPerHour:count*.18,storageUsdPerHour:count*.02,totalUsdPerHour:count*.20,unavailableDevices:0},occupancy:{day:{percent:78.4,coverage:.96},week:{percent:71.2,coverage:.98},month:{percent:67.9,coverage:.99}},boxes:Array.from({length:count},(_,i)=>{
    const scenario=i%12,maintenance=scenario>=3&&scenario<=5,unknown=scenario===9,stale=scenario===11;
    const running=unknown?null:scenario<9&&scenario%3===0?1:stale?1:0,stored=unknown?null:Math.max(running,i%4);
    return {name:'spark-'+String(i+1).padStart(3,'0'),deviceKey:'sample-'+i,totalOccupancy:{percent:70+i%23,observedSeconds:86400,occupiedSeconds:86400*(70+i%23)/100,elapsedSeconds:86400,coverage:1},lastSample:{at:stale?new Date(now-1200000).toISOString():stamp,connection:unknown?'unknown':scenario<9&&scenario%3===2?'offline':'online',runningInstances:running,storedInstances:stored,gpuCount:1+i%4,reliability:.9999-i%5*.001,verification:i%5?'verified':'unverified',listed:unknown?null:scenario>=6&&scenario<=8?false:maintenance?i%2===0:true,maintenanceWindows:unknown?null:maintenance?[{start:new Date(now-3600000).toISOString(),end:new Date(now+3600000).toISOString()}]:scenario===10?[{start:new Date(now+3600000).toISOString(),end:new Date(now+7200000).toISOString()}]:[],allocatedStorageGb:stored==null?null:stored*40}};
  })};
}
function sizeGrid(){
  const grid=$('#estate-grid'),height=Math.max(100,innerHeight-grid.getBoundingClientRect().top-$('footer').offsetHeight-32);
  const {size}=tileLayout(grid.children.length,grid.clientWidth,height);
  grid.style.setProperty('--tile-size',size+'px');
}
function hideTip(){hideDeviceTip();$('#tooltip').hidden=true;}
function showTip(tile,box){showDeviceTip(tile,box,everythingStats(box),tileState(box.lastSample,Date.now(),data.snapshotMaxAgeSeconds??5400),{period:'Everything'});}
function render(){
  hideTip();renderNow(data);
  for(const [key,label] of [['day','24 hourly slots including the current hour'],['week','Current Monday–Sunday calendar week'],['month','Current calendar month']]){
    const value=data.occupancy?.[key];
    $('#fleet-occupancy-'+key).textContent=percentLabel(value?.percent);
    $('#occupancy-'+key+'-reading').title=label+' · '+(value?.percent==null?'No observed telemetry':percentLabel(value.percent)+' occupancy in observed time'+(value.coverage==null?'':' · '+coverageLabel(value.coverage)+' data coverage'));
  }
  const query=$('#search').value.trim().toLocaleLowerCase(),boxes=data.boxes.filter(b=>b.name.toLocaleLowerCase().includes(query)),grid=$('#estate-grid');
  grid.replaceChildren();$('#device-total').textContent=boxes.length===data.boxes.length?String(boxes.length):boxes.length+'/'+data.boxes.length;
  for(const box of boxes){
    const status=tileState(box.lastSample,Date.now(),data.snapshotMaxAgeSeconds??5400),tile=element('a','estate-tile state-'+status.state+(status.stale?' stale':''));
    const url=new URL('occupancy.html',location);url.searchParams.set('device',box.deviceKey??box.storageKey??box.name);if(demo)url.searchParams.set('demo','1');tile.href=url;
    tile.setAttribute('aria-label',box.name+', '+labels[status.state]+(status.stale?', snapshot overdue':'')+', open details');
    addStateMarker(tile,status.state,status.stale,Number.isFinite(Date.parse(box.lastSample?.at)));
    tile.addEventListener('mouseenter',()=>showTip(tile,box));tile.addEventListener('focus',()=>showTip(tile,box));tile.addEventListener('mouseleave',hideTip);tile.addEventListener('blur',hideTip);grid.append(tile);
  }
  $('#empty-estate').hidden=boxes.length>0;sizeGrid();
  const at=Date.parse(data.updatedAt),age=Date.now()-at,overdue=age>(data.snapshotMaxAgeSeconds??5400)*1000;
  $('#freshness').textContent=demo?'Sample data':Number.isFinite(at)?'Checked '+fmt(data.updatedAt):'Waiting for first status snapshot';$('.freshness').classList.toggle('live',Number.isFinite(at)&&!overdue&&!demo);
  $('#notice').textContent=demo?'SAMPLE DATA · Illustrative devices and states.':overdue?'Status check is overdue. Last known device states are shown.':!data.updatedAt?'Waiting for the first status check.':data.source==='telemetry'?'Showing saved history state until the first status check arrives.':'';
  if(!demo){const message=collectionNotice(data);if(message)$('#notice').textContent=message;}
  $('#demo').textContent=demo?'Return to recorded data ↗':'Explore sample data ↗';
}
async function load(force=false){
  if(loading)return;loading=true;$('#refresh').disabled=true;
  try{
    if(demo)data=demoFleet();
    else{
      const next=await source({force});if(!next&&!data.updatedAt)throw Error('Unavailable');
      if(next)data=next;
    }
    render();
  }catch{$('#notice').textContent='Could not load the current fleet snapshot. Previously loaded states are retained.';}
  finally{loading=false;$('#refresh').disabled=false;}
}
const legend=element('table','state-matrix'),head=element('thead'),headRow=element('tr');
for(const text of ['Category','Online · idle','Running','Offline']){const th=element('th','',text);th.scope='col';headRow.append(th);}head.append(headRow);legend.append(head);
const body=element('tbody');
for(const [category,states] of [['Listed',['listed','running','offline']],['Maintenance',['maintenance','maintenance-running','maintenance-offline']],['Unlisted',['unlisted','unlisted-running','offline-unlisted']]]){
  const row=element('tr'),heading=element('th','',category);heading.scope='row';row.append(heading);
  for(const state of states){const td=element('td'),swatch=element('span','estate-tile state-'+state);swatch.setAttribute('role','img');swatch.setAttribute('aria-label',labels[state]);addStateMarker(swatch,state);td.append(swatch);row.append(td);}body.append(row);
}
legend.append(body);$('#tile-legend').append(legend);
const unknownLegend=element('div','tile-legend-row'),unknownSwatch=element('span','estate-tile state-unknown','?');unknownLegend.append(unknownSwatch,element('span','','Unknown state'));$('#tile-legend').append(unknownLegend);
bindMetricPills();
document.querySelectorAll('[data-icon]').forEach(item=>item.append(icon(item.dataset.icon)));
const helpButton=$('[data-info="now"]');bindPopover(helpButton,()=>({title:'Fleet summary',copy:'Occupancy readings cover the current 24h, calendar Week and Month periods on Occupancy. Running time is divided by observed time; missing telemetry and future time are excluded. Other figures use the latest machine snapshot. Stored includes running instances; GB is allocated space. All figures cover the whole fleet, regardless of search.'}));
$('#search').addEventListener('input',render);$('#refresh').onclick=()=>load(true);
$('#demo').onclick=()=>{const url=new URL(location);if(demo){url.searchParams.delete('demo');url.searchParams.delete('count');}else url.searchParams.set('demo','1');location.href=url;};
window.addEventListener('resize',()=>{hideTip();sizeGrid();});window.addEventListener('scroll',hideTip,true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){hideTip();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
load();setInterval(()=>{if(!document.hidden)load();},60000);
