import {ZONE} from './model.js?v=1.0.0';
import {element} from './ui.js?v=1.0.0';

const stamp=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,dateStyle:'medium',timeStyle:'short'}).format(Date.parse(value)):'Unavailable';
const percent=value=>Number.isFinite(value)?value.toFixed(1)+'%':'—';
function duration(seconds){
  if(!Number.isFinite(seconds))return '—';if(seconds>0&&seconds<60)return '<1 min';
  const total=Math.round(Math.max(0,seconds)/60);return total<60?total+' min':Math.floor(total/60)+' h'+(total%60?' '+total%60+' min':'');
}
export function everythingStats(box){
  const value=box.totalOccupancy;
  return {percent:value?.percent??null,observed:value?.observedSeconds??0,occupied:value?.occupiedSeconds??0,elapsed:value?.elapsedSeconds??0,coverage:value?.coverage??null};
}
export function deviceInfoSections(box,stats,status,{period='Everything',now=Date.now()}={}){
  const sample=box.lastSample??{},running=status.running===false?0:sample.runningInstances??'—';
  const coverage=stats.elapsed>0&&Number.isFinite(stats.coverage)?stats.coverage>=.9995&&stats.coverage<1-1e-9?'<100%':percent(stats.coverage*100):'—';
  const state=[
    ['Connection',status.connection==='online'?'Online':status.connection==='offline'?'Offline':'Unavailable'],['Listing',status.listed===true?'Listed':status.listed===false?'Unlisted':'Unavailable'],
    ['Maintenance',status.maintenance?'Active':status.next?'Planned from '+stamp(status.next.start):status.maintenance===false?'Off':'Unavailable'],
    ['Instances',running+' running · '+(sample.storedInstances??'—')+' stored'],
    ['Storage',Number.isFinite(sample.allocatedStorageGb)?sample.allocatedStorageGb.toLocaleString('en-GB',{maximumFractionDigits:1})+' GB allocated':'—'],['GPUs',String(sample.gpuCount??'—')],
    ['Verification',sample.verification??'Unavailable'],['Reliability',sample.reliability==null?'—':(sample.reliability*100).toFixed(6)+'%']
  ];
  if(box.discoveryMissing)state.unshift(['Device discovery','Not returned by latest check']);
  if(status.stale)state.unshift(['Snapshot','Overdue; last known state']);
  const usage=[
    ['Period',period],['Occupancy',percent(stats.percent)],['Running time',stats.observed>0?duration(stats.occupied):'—'],
    ['Observed time',stats.observed>0?duration(stats.observed):'—'],['Data coverage',coverage]
  ];
  const history=[['Status checked',stamp(sample.at)],['History through',stamp(box.dataThrough)]];
  if(box.historyStart)history.push(['History available from',stamp(box.historyStart)]);
  if(box.historyError)history.push(['History refresh','Failed; previous data retained']);
  else if(box.dataThrough&&now-Date.parse(box.dataThrough)>7200000)history.push(['History delay',duration((now-Date.parse(box.dataThrough))/1000)]);
  if(box.discoveryMissing)history.push(['Last seen',stamp(box.lastSeenAt)]);
  return [{title:'Status',rows:state},{title:'Usage',rows:usage},{title:'History & checks',rows:history}];
}
export function deviceInfoRows(box,stats,status,options){
  return deviceInfoSections(box,stats,status,options).flatMap(section=>section.rows);
}
export function deviceInfoList(box,stats,status,options){
  const groups=element('div','device-info-sections');
  for(const {title,rows} of deviceInfoSections(box,stats,status,options)){
    const section=element('section','device-info-section'),list=element('dl','device-info-list');
    section.setAttribute('aria-label',title);section.append(element('h5','device-info-heading',title));
    for(const [label,value] of rows)list.append(element('dt','',label),element('dd','',value));
    section.append(list);groups.append(section);
  }
  return groups;
}
let active=null;
export function hideDeviceTip(){
  const tip=document.querySelector('#tooltip');if(active&&tip)tip.hidden=true;
  active?.removeAttribute('aria-describedby');active=null;
}
export function showDeviceTip(anchor,box,stats,status,options){
  hideDeviceTip();const tip=document.querySelector('#tooltip');tip.classList.add('device-tooltip');
  tip.replaceChildren(element('h4','',box.name),deviceInfoList(box,stats,status,options));tip.hidden=false;
  const rect=anchor.getBoundingClientRect();tip.style.left=Math.max(10,Math.min(innerWidth-tip.offsetWidth-10,rect.left))+'px';
  tip.style.top=Math.max(10,Math.min(innerHeight-tip.offsetHeight-10,rect.bottom+10))+'px';
  anchor.setAttribute('aria-describedby','tooltip');active=anchor;
}
