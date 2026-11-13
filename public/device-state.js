import {primaryDeviceState,ZONE} from './model.js?v=1.3.1';
import {element,icon} from './ui.js?v=1.3.1';

const maintenanceTime=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,dateStyle:'medium',timeStyle:'short'});

export function stateIcon(kind,state,label,count=null,disabled=false){
  const item=element('span','device-state '+state);
  item.title=label;
  item.setAttribute('role','img');
  item.setAttribute('aria-label',label);
  item.append(icon(kind,disabled));
  if(count!==null)item.append(element('span','device-count',String(count)));
  return item;
}

export function primaryStatusIcon(sample,status,when=''){
  const primary=primaryDeviceState(status);
  if(primary==='running'){
    const running=sample?.runningInstances??'?';
    return stateIcon('play','active','Running instances: '+running+when,running);
  }
  if(primary==='offline')return stateIcon('power','offline','Offline'+when,null,true);
  if(primary==='listed')return stateIcon('tag','active','Listed'+when);
  if(primary==='online')return stateIcon('power','active','Online'+when);
  return stateIcon('power','muted','Status unavailable'+when,'?');
}

export function maintenanceIcon(status,when=''){
  if(status.maintenance)return stateIcon('wrench','maintenance','Maintenance active'+when);
  if(status.next)return stateIcon('clock','maintenance','Maintenance planned: '+maintenanceTime.format(Date.parse(status.next.start)));
  if(status.maintenance===false)return stateIcon('wrench','muted','Maintenance off'+when,null,true);
  return stateIcon('wrench','muted','Maintenance unknown'+when,'?');
}

export function verificationIcon(verification,when=''){
  return stateIcon(verification==='deverified'?'deverifiedBadge':'verifiedBadge',
    verification==='verified'?'verified':verification==='deverified'?'maintenance':'muted',
    'Verification: '+(verification??'unavailable')+when);
}
