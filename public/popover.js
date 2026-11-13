import {element} from './ui.js?v=1.3.1';

let panel,body,title,closeButton,active;
export function closePopover(restore=false){const previous=active;active=null;if(panel)panel.hidden=true;previous?.setAttribute('aria-expanded','false');if(restore)previous?.focus({preventScroll:true});}
function initialise(){
  if(panel)return;
  panel=element('aside','metric-popover info-popover');panel.id='info-popover';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','info-popover-title');
  title=element('strong');title.id='info-popover-title';body=element('div','info-popover-body');
  closeButton=element('button','metric-popover-close','×');closeButton.type='button';closeButton.setAttribute('aria-label','Close explanation');closeButton.onclick=()=>closePopover(true);
  panel.append(closeButton,title,body);document.body.append(panel);
  document.addEventListener('click',event=>{if(active&&!active.contains(event.target)&&!panel.contains(event.target))closePopover();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active)closePopover(true);});
  window.addEventListener('resize',()=>closePopover());window.addEventListener('scroll',event=>{if(!panel.contains(event.target))closePopover();},true);
}
export function bindPopover(trigger,provider){
  initialise();trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-haspopup','dialog');
  const toggle=event=>{
    if(event.target.closest('a'))return;
    event.preventDefault();if(active===trigger){closePopover(true);return;}closePopover();active=trigger;
    const data=provider();title.textContent=data.title;body.replaceChildren();
    if(data.value)body.append(element('p','metric-popover-value',data.value));
    if(data.copy)body.append(element('p','',data.copy));
    if(data.content)body.append(data.content);
    panel.hidden=false;trigger.setAttribute('aria-expanded','true');
    const anchor=trigger.getBoundingClientRect();panel.style.left=Math.max(10,Math.min(innerWidth-panel.offsetWidth-10,anchor.left+anchor.width/2-panel.offsetWidth/2))+'px';
    const top=anchor.bottom+8;panel.style.top=Math.max(10,Math.min(innerHeight-panel.offsetHeight-10,top))+'px';closeButton.focus({preventScroll:true});
  };
  trigger.addEventListener('click',toggle);
  if(!['BUTTON','SUMMARY'].includes(trigger.tagName)){trigger.setAttribute('role','button');trigger.tabIndex=0;trigger.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')toggle(event);});}
}
export function bindGuide(details){
  const trigger=details.querySelector('summary'),source=details.querySelector('.view-help-panel');
  if(!trigger||!source)return;
  trigger.setAttribute('role','button');
  bindPopover(trigger,()=>{
    const content=element('div','popover-guide');
    for(const child of source.children)if(!child.matches('.box-details-close,h3')){const clone=child.cloneNode(true);clone.removeAttribute('id');for(const node of clone.querySelectorAll('[id]'))node.removeAttribute('id');content.append(clone);}
    return {title:source.querySelector('h3')?.textContent??'Dashboard guide',content};
  });
}
