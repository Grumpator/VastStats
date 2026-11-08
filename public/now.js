import {fleetSnapshot} from './model.js?v=1.1.0';
import {bindPopover} from './popover.js?v=1.1.0';
const $=s=>document.querySelector(s);
export const hourlyUsd=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:value>0&&value<.01?4:2}).format(value):'\u2014';
export function renderNow(data){
  const fleet=fleetSnapshot(data.boxes,Date.now(),data.snapshotMaxAgeSeconds??5400);
  for(const field of ['online','listed','maintenance','running']){const node=$('#'+field+'-boxes');if(node)node.textContent=(fleet[field]??'—')+'/'+fleet.total;}
  if($('#stored'))$('#stored').textContent=fleet.stored??'—';
  if($('#running-note'))$('#running-note').textContent=(fleet.runningInstances??'—')+' instances';
  if($('#stored-note'))$('#stored-note').textContent=fleet.storage==null?'instances · size unknown':fleet.storage.toLocaleString('en-GB',{maximumFractionDigits:1})+' GB allocated';
  if($('#snapshot-note'))$('#snapshot-note').textContent=fleet.overdue?'· '+fleet.overdue+' overdue':'· latest snapshot';
  $('.now-group')?.classList.toggle('overdue',fleet.overdue>0);
  return fleet;
}

// Keep labels available to touch and keyboard users when narrow layouts hide them.
export function bindMetricPills(){
  const definitions={
    occupancy:['Occupancy','Running box-time divided by observed box-time for the same 24h, Week and calendar Month periods shown on Occupancy. Future time is excluded. Missing telemetry is excluded.'],
    earnings:['Hourly earnings','Current contract rates for running GPUs and allocated storage, including stopped instances. Bandwidth is excluded. Prices are used directly without a commission adjustment. Updated every five minutes.'],
    running:['Running','Boxes with at least one running rental, out of the whole fleet. The smaller count is the total running instances; multiple instances can run on one box.'],
    listed:['Listed','Boxes listed for rental on Vast, out of the whole fleet. This is the latest recorded listing state.'],
    online:['Online','Boxes reporting an online heartbeat, out of the whole fleet. These values use the latest status snapshot.'],
    maintenance:['Maintenance','Boxes currently within a recorded maintenance window, out of the whole fleet.'],
    stored:['Stored','Total resident instances, including running and stopped instances. GB allocated is reserved disk space, not measured file usage.']
  };
  for(const pill of document.querySelectorAll('.now-summary .now-metric[data-metric]')){
    bindPopover(pill,()=>{
      const [title,copy]=definitions[pill.dataset.metric];
      const value=pill.dataset.metric==='occupancy'?[...pill.querySelectorAll('.occupancy-values>a')].map(item=>item.querySelector('.metric-note').textContent+': '+item.querySelector('strong').textContent).join(' · '):pill.querySelector('strong').textContent+(pill.querySelector('.metric-note')?.textContent?' · '+pill.querySelector('.metric-note').textContent:'');
      return {title,value,copy:copy+' '+(pill.dataset.detail??'')};
    });
  }
}
