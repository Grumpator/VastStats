import {fleetSnapshot} from './model.js?v=1.0.0';
import {element} from './ui.js?v=1.0.0';
const $=s=>document.querySelector(s);
export const hourlyUsd=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:value>0&&value<.01?4:2}).format(value):'\u2014';
export function renderNow(data){
  const fleet=fleetSnapshot(data.boxes,Date.now(),data.snapshotMaxAgeSeconds??5400);
  for(const field of ['online','listed','maintenance','running'])$('#'+field+'-boxes').textContent=(fleet[field]??'—')+'/'+fleet.total;
  const earnings=data.earnings,rate=$('#earnings-rate'),pill=rate.closest('[data-metric]');
  rate.textContent=hourlyUsd(earnings?.totalUsdPerHour);
  $('#earnings-note').textContent=earnings?.totalUsdPerHour==null?'unavailable':'/ hour';
  pill.dataset.detail=earnings?.totalUsdPerHour==null?(earnings?.unavailableDevices?earnings.unavailableDevices+' device rate'+(earnings.unavailableDevices===1?' is':'s are')+' unavailable; no partial fleet total is shown.':'Waiting for contract rates.'):'Compute: '+hourlyUsd(earnings.computeUsdPerHour)+'/h \u00b7 Storage: '+hourlyUsd(earnings.storageUsdPerHour)+'/h.';
  pill.title='Hourly earnings \u00b7 '+pill.dataset.detail+' Bandwidth excluded. Uses contract prices directly; no commission adjustment.';
  $('#stored').textContent=fleet.stored??'—';
  $('#running-note').textContent=(fleet.runningInstances??'—')+' instances';
  $('#stored-note').textContent=fleet.storage==null?'instances · size unknown':fleet.storage.toLocaleString('en-GB',{maximumFractionDigits:1})+' GB allocated';
  $('#snapshot-note').textContent=fleet.overdue?'· '+fleet.overdue+' overdue':'· latest snapshot';
  $('.now-group').classList.toggle('overdue',fleet.overdue>0);
  return fleet;
}

// Keep labels available to touch and keyboard users when narrow layouts hide them.
export function bindMetricPills(){
  const definitions={
    occupancy:['Occupancy','Running box-time divided by observed box-time for the trailing 24 hours, 7 days and 30 days. Missing telemetry is excluded.'],
    earnings:['Hourly earnings','Current contract rates for running GPUs and allocated storage, including stopped instances. Bandwidth is excluded. Prices are used directly without a commission adjustment. Updated every five minutes.'],
    running:['Running','Boxes with at least one running rental, out of the whole fleet. The smaller count is the total running instances; multiple instances can run on one box.'],
    listed:['Listed','Boxes listed for rental on Vast, out of the whole fleet. This is the latest recorded listing state.'],
    online:['Online','Boxes reporting an online heartbeat, out of the whole fleet. These values use the latest status snapshot.'],
    maintenance:['Maintenance','Boxes currently within a recorded maintenance window, out of the whole fleet.'],
    stored:['Stored','Total resident instances, including running and stopped instances. GB allocated is reserved disk space, not measured file usage.']
  };
  const panel=element('aside','metric-popover');panel.hidden=true;panel.id='metric-popover';panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','metric-popover-title');
  const closeButton=element('button','metric-popover-close','×');closeButton.type='button';closeButton.setAttribute('aria-label','Close metric explanation');
  const title=element('strong'),value=element('p','metric-popover-value'),breakdown=element('p','metric-popover-breakdown'),copy=element('p');title.id='metric-popover-title';panel.append(closeButton,title,value,breakdown,copy);document.body.append(panel);
  let active=null;
  function close(restore=false){const previous=active;panel.hidden=true;previous?.setAttribute('aria-expanded','false');active=null;if(restore)previous?.focus({preventScroll:true});}
  function toggle(pill){
    if(active===pill){close(true);return;}close();active=pill;
    const [label,description]=definitions[pill.dataset.metric];title.textContent=label;copy.textContent=description;breakdown.textContent=pill.dataset.detail??'';breakdown.hidden=!breakdown.textContent;
    const note=pill.querySelector('.metric-note').textContent;
    value.textContent=pill.dataset.metric==='occupancy'?[...pill.querySelectorAll('.occupancy-values>div')].map(item=>item.querySelector('.metric-note').textContent+': '+item.querySelector('strong').textContent).join(' · '):pill.querySelector('strong').textContent+(note==='boxes'?' ':' · ')+note;
    if(pill.dataset.metric==='earnings')value.textContent=pill.querySelector('strong').textContent+(pill.querySelector('strong').textContent==='\u2014'?'':'/h');
    panel.hidden=false;pill.setAttribute('aria-expanded','true');
    const anchor=pill.getBoundingClientRect();panel.style.left=Math.max(10,Math.min(innerWidth-panel.offsetWidth-10,anchor.left+anchor.width/2-panel.offsetWidth/2))+'px';
    panel.style.top=Math.max(10,Math.min(innerHeight-panel.offsetHeight-10,anchor.bottom+8))+'px';closeButton.focus({preventScroll:true});
  }
  for(const pill of document.querySelectorAll('.now-summary .now-metric[data-metric]')){
    pill.setAttribute('role','button');pill.tabIndex=0;pill.setAttribute('aria-controls',panel.id);pill.setAttribute('aria-expanded','false');pill.setAttribute('aria-haspopup','dialog');
    pill.addEventListener('click',()=>toggle(pill));pill.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle(pill);}});
  }
  closeButton.onclick=()=>close(true);
  document.addEventListener('click',event=>{if(active&&!active.contains(event.target)&&!panel.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active)close(true);});
  window.addEventListener('resize',()=>close());window.addEventListener('scroll',()=>close(),true);
}
