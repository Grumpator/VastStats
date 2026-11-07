import {demoEarnings} from './earnings-demo.js?v=1.0.0';
import {recordedPeriod} from './earnings-model.js?v=1.0.0';
import {element,icon} from './ui.js?v=1.0.0';
import {fleetSnapshot,demoData} from './model.js?v=1.0.0';
import {statusSource} from './status-data.js?v=1.0.0';
import {hourlyUsd} from './now.js?v=1.0.0';
import {bindPopover} from './popover.js?v=1.0.0';

export function initialiseFleetNow(){
  const header=document.querySelector('.topbar');if(!header)return;
  const row=element('section','fleet-now');row.setAttribute('aria-label','Current fleet summary');
  const fields=[['running','play','Running now'],['earnings','money','Earnings/h now'],['earned','calendar','Earned today']],values=new Map();let data=null;
  const stamp=at=>at?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(Date.parse(at)):'not yet checked';
  for(const [key,kind,label] of fields){
    const button=element('button','live-pill'),name=element('span','live-pill-label'),value=element('strong','','—');button.type='button';name.append(icon(kind),element('span','',label));button.append(name,value,element('span','live-pill-info','i'));row.append(button);values.set(key,value);
    bindPopover(button,()=>{
      const fleet=fleetSnapshot(data?.boxes||[],Date.now(),data?.snapshotMaxAgeSeconds??900),rates=data?.earnings;
      const descriptions={earned:'GPU, bandwidth and storage earnings reported by Vast for the current UTC billing day. A waiting icon means the day is not reported yet, not zero. Report checked '+stamp(data?.earningsUpdatedAt)+'.',running:'Boxes with running rentals, out of all devices. Running instances: '+(fleet.runningInstances??'unavailable')+'.',earnings:'Current rate for running contracts and allocated storage, including stored instances. Compute '+hourlyUsd(rates?.computeUsdPerHour)+'/h · Storage '+hourlyUsd(rates?.storageUsdPerHour)+'/h. Bandwidth excluded; no extra commission adjustment.'};
      return {title:label,value:value.textContent,copy:descriptions[key]+' Last checked '+stamp(data?.updatedAt)+'.'+(fleet.overdue?' '+fleet.overdue+' snapshot(s) overdue; values describe the last known state.':'')};
    });
  }
  header.after(row);
  const source=statusSource(),demo=new URLSearchParams(location.search).has('demo');
  async function refresh(){
    data=demo?{...demoData(),updatedAt:new Date().toISOString(),earnings:{computeUsdPerHour:1.46,storageUsdPerHour:.24,totalUsdPerHour:1.7},earnedToday:demoEarnings().report.periods.today}:await source({force:true});
    const fleet=fleetSnapshot(data?.boxes||[],Date.now(),data?.snapshotMaxAgeSeconds??900);
    const today=recordedPeriod({periods:{today:data?.earnedToday}},'today');
    values.get('earned').replaceChildren(today?document.createTextNode(hourlyUsd(today.totalUsd)):icon('clock'));
    values.get('earned').classList.toggle('waiting-value',!today);
    values.get('earnings').textContent=hourlyUsd(data?.earnings?.totalUsdPerHour);
    values.get('running').textContent=data?`${fleet.running??'—'}/${fleet.total}`:'—';
    for(const [key,,label] of fields)values.get(key).parentElement.setAttribute('aria-label',label+': '+(key==='earned'&&!today?'awaiting report':values.get(key).textContent));
    row.classList.toggle('overdue',fleet.overdue>0);
    row.dataset.checkedAt=data?.updatedAt??'';
  }
  refresh();setInterval(()=>{if(!document.hidden)refresh();},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
}
