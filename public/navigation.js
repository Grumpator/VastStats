import {element} from './ui.js?v=1.3.1';
import {bindPopover,bindGuide,closePopover} from './popover.js?v=1.3.1';
import {initialiseFleetNow} from './fleet-now.js?v=1.3.1';
import {showingSuspended} from './api.js?v=1.3.1';

export const fleetPages=[['overview','Overview','./'],['devices','Devices','devices.html'],['occupancy','Occupancy','occupancy.html'],['earnings','Earnings','earnings.html'],['market','Market','market.html'],['settings','Settings','settings.html']];
const host=document.querySelector('[data-navigation]');
if(host){
  const brand=element('a','brand');brand.href='./';brand.append(element('span','brandmark','v'),document.createTextNode('VastStats'));brand.firstChild.setAttribute('aria-hidden','true');
  const nav=element('nav','fleet-navigation');
  nav.setAttribute('aria-label','Fleet pages');
  const current=fleetPages.find(([key])=>key===host.dataset.navigation)?.[1]??'Pages';
  const toggle=element('button','fleet-menu-toggle');
  toggle.type='button';
  toggle.setAttribute('aria-label',current+' page, fleet navigation');
  toggle.setAttribute('aria-controls','fleet-page-links');
  toggle.setAttribute('aria-expanded','false');
  const menuIcon=element('span','fleet-menu-icon');
  menuIcon.setAttribute('aria-hidden','true');
  toggle.append(menuIcon,element('span','',current));

  const links=element('div','page-nav');
  links.id='fleet-page-links';
  links.hidden=true;
  for(const [key,label,url] of fleetPages){const link=element('a','',label);link.href=url;if(key===host.dataset.navigation)link.setAttribute('aria-current','page');links.append(link);}

  function setOpen(open){
    links.hidden=!open;
    toggle.setAttribute('aria-expanded',String(open));
  }
  toggle.addEventListener('click',()=>{
    if(links.hidden)closePopover();
    setOpen(links.hidden);
  });
  links.addEventListener('click',event=>{if(event.target.closest('a'))setOpen(false);});
  document.addEventListener('pointerdown',event=>{if(!links.hidden&&!nav.contains(event.target))setOpen(false);});
  nav.addEventListener('focusout',event=>{if(!nav.contains(event.relatedTarget))setOpen(false);});
  nav.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||links.hidden)return;
    setOpen(false);
    toggle.focus();
  });
  nav.append(toggle,links);
  host.replaceChildren(brand,nav);
}
for(const freshness of document.querySelectorAll('.topbar .freshness')){
  const show=showingSuspended();
  const suspended=element('button','refresh-button suspended-toggle',show?'Hide suspended':'Show suspended');
  suspended.type='button';
  suspended.addEventListener('click',()=>{
    try{sessionStorage.setItem('vaststats.showSuspended',show?'0':'1');location.reload();}
    catch{suspended.textContent='Storage unavailable';}
  });
  freshness.before(suspended);
  const copy=freshness.querySelector('#freshness');if(copy)copy.classList.add('sr-only');
  const button=element('button','header-status');button.type='button';
  const icon=element('span','live-pill-info','i');icon.setAttribute('aria-hidden','true');
  button.append(element('span','header-status-label','Data status'),icon);freshness.append(button);
  bindPopover(button,()=>({title:'Data status',copy:copy?.textContent==='Planned'?'Page planned. Current fleet snapshot: '+(document.querySelector('.fleet-now')?.dataset.checkedAt||'waiting for data'):copy?.textContent??'Waiting for data'}));
}
for(const guide of document.querySelectorAll('details.view-help'))bindGuide(guide);
initialiseFleetNow();
