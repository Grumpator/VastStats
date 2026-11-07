import {element} from './ui.js?v=1.0.0';
import {bindPopover,bindGuide} from './popover.js?v=1.0.0';
import {initialiseFleetNow} from './fleet-now.js?v=1.0.0';

export const fleetPages=[['overview','Overview','./'],['occupancy','Occupancy','occupancy.html'],['earnings','Earnings','earnings.html'],['market','Market','market.html'],['settings','Settings','settings.html']];
for(const host of document.querySelectorAll('[data-navigation]')){
  const brand=element('a','brand');brand.href='./';brand.append(element('span','brandmark','v'),document.createTextNode('VastStats'));brand.firstChild.setAttribute('aria-hidden','true');
  const nav=element('nav','fleet-navigation');nav.setAttribute('aria-label','Fleet pages');nav.append(element('span','fleet-label','Fleet:'));
  const links=element('div','page-nav');
  for(const [key,label,url] of fleetPages){const link=element('a','',label);link.href=url;if(key===host.dataset.navigation)link.setAttribute('aria-current','page');links.append(link);}
  nav.append(links);host.replaceChildren(brand,nav);
}
for(const freshness of document.querySelectorAll('.topbar .freshness')){
  const copy=freshness.querySelector('#freshness');if(copy)copy.classList.add('sr-only');
  const button=element('button','header-status','Data status ');button.type='button';button.append(element('span','live-pill-info','i'));freshness.append(button);
  bindPopover(button,()=>({title:'Data status',copy:copy?.textContent==='Planned'?'Page planned. Current fleet snapshot: '+(document.querySelector('.fleet-now')?.dataset.checkedAt||'waiting for data'):copy?.textContent??'Waiting for data'}));
}
for(const guide of document.querySelectorAll('details.view-help'))bindGuide(guide);
initialiseFleetNow();
