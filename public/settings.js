import {cachedAPI,showingSuspended} from './api.js?v=1.3.1';
import {element} from './ui.js?v=1.3.1';

const get=cachedAPI();
const list=document.querySelector('#settings-devices');
const notice=document.querySelector('#settings-notice');
const token=document.querySelector('#settings-token');
let saving=false;

async function save(device,button){
  if(saving)return;
  if(!token.value.trim()){notice.textContent='Enter the settings token to change a device.';token.focus();return;}
  saving=true;
  button.disabled=true;
  const suspended=!device.suspended;
  const params=new URLSearchParams({device:device.deviceKey,suspended:suspended?'1':'0'});
  try{
    const response=await fetch('/api/settings/devices?'+params,{method:'PUT',headers:{Authorization:'Bearer '+token.value.trim()}});
    if(!response.ok)throw Error((await response.json()).error);
    document.dispatchEvent(new Event('fleet-settings-changed'));
    await load(device.name+(suspended?' suspended.':' restored.'));
  }catch(error){
    notice.textContent=error.message||'Could not save device settings.';
    button.disabled=false;
  }finally{saving=false;}
}

async function load(message=''){
  try{
    const {devices,editable}=await get('/api/settings/devices');
    document.querySelector('#settings-token-label').hidden=!editable;
    document.querySelector('#freshness').textContent='Fleet settings loaded';
    notice.textContent=message||(!editable?'Set VASTSTATS_SETTINGS_TOKEN on the server to enable editing.':'');
    list.replaceChildren();
    if(!devices.length){
      list.append(element('li','',showingSuspended()?'No devices found.':'No active devices found.'));
      return;
    }
    for(const device of devices.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))){
      const row=element('li');
      const name=element('strong','',device.name);
      const state=element('span','settings-device-state',device.suspended?'Suspended':'Active');
      const button=element('button','refresh-button',device.suspended?'Unsuspend':'Suspend');
      button.type='button';
      button.disabled=!editable;
      button.setAttribute('aria-label',button.textContent+' '+device.name);
      button.addEventListener('click',()=>save(device,button));
      row.append(name,state,button);
      list.append(row);
    }
  }catch{notice.textContent='Could not load fleet settings.';}
}

load();
