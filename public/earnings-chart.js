import {element} from './ui.js?v=1.3.0';
import {hourlyUsd} from './now.js?v=1.3.0';
import {bindPopover} from './popover.js?v=1.3.0';
import {chartDateRange,chartDays,chartScale,earningsChartSeries,earningsDefinitions,earningsSources,gpuGroups,rangeTotal,rankedPoints,reportedDayHours} from './earnings-chart-model.js?v=1.3.0';

const $=selector=>document.querySelector(selector),svgNS='http://www.w3.org/2000/svg';
const dateLabel=day=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(Date.parse(day+'T00:00Z'));
const shortDate=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short'});
function svgElement(tag,attributes={},text){const node=document.createElementNS(svgNS,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;return node;}

export function createEarningsChart({get}){
  const host=$('#earnings-chart'),legend=$('#chart-legend'),status=$('#chart-status'),averageHeading=$('#chart-average-heading');
  const modeButtons=[...document.querySelectorAll('[data-chart-mode]')];
  const savedMode=history.state?.earningsChartMode;
  let report=null,mode=modeButtons.some(button=>button.dataset.chartMode===savedMode)?savedMode:'source',range=null,revision=null,roster=[],groups=[];
  const selections={source:new Set(earningsSources.map(d=>d.key)),machine:new Set(['totalUsd']),gpu:new Set(['totalUsd'])};
  const initialized=new Set(),windows=new Map();
  let activeSeries=[],days=[],hoverIndex=0,resizeTimer,pollTimer,fetchGeneration=0,loading=false;
  const windowKey=()=>range?mode+':'+range.from+':'+range.to:null;
  const devices=()=>mode==='gpu'?groups:roster;
  function pollAfter(ms){pollTimer=setTimeout(()=>{pollTimer=undefined;loadDevices();},ms);}
  const tooltip=element('div','earnings-chart-tooltip');tooltip.hidden=true;tooltip.setAttribute('role','tooltip');document.body.append(tooltip);
  function detail(index=hoverIndex){
    const day=days[index],content=element('dl','chart-point-details');
    for(const {label,color,value} of rankedPoints(activeSeries,index)){
      const name=element('dt'),swatch=element('span','chart-series-color');
      swatch.style.background=color;
      swatch.setAttribute('aria-hidden','true');
      name.append(swatch,element('span','chart-series-name',label));
      content.append(name,element('dd','',value==null?'No report':hourlyUsd(value)));
    }
    return {title:day?dateLabel(day)+(day===new Date().toISOString().slice(0,10)?' · so far':' · earnings'):'Daily earnings',content};
  }
  bindPopover($('#chart-info'),()=>({title:'Daily earnings',copy:'Period totals sum the reported UTC days in the selected range. Average $/h divides earnings by reported clock hours. By GPU estimates dollars per GPU-hour using each reporting machine’s last known GPU model and count. This includes idle time and assumes the hardware count stayed the same. Days with no report are skipped. Today counts up to the report check. A GPU estimate needs a known count for every included machine. For the combined fleet hourly rate, use By source. Vast reports fleet and machine amounts separately, so their totals can differ slightly. Select up to eight machines or GPU groups to plot.'}));
  function updateTable(){
    const focus=legend.contains(document.activeElement)?document.activeElement.value:null;
    legend.replaceChildren();
    const state=windows.get(windowKey()),selection=selections[mode];
    const daily=range?(report?.daily||[]).filter(row=>row.day>=range.from&&row.day<=range.to):[];
    averageHeading.textContent=mode==='gpu'?'Est. $/GPU-h':'Average $/h';
    for(const definition of earningsDefinitions(mode,devices())){
      const {key}=definition,row=element('tr'),heading=element('th'),label=element('label','chart-series-toggle'),input=element('input');heading.scope='row';
      input.type='checkbox';input.value=key;input.checked=selection.has(key);input.setAttribute('aria-label','Plot '+definition.label);
      input.disabled=mode!=='source'&&key!=='totalUsd'&&!input.checked&&[...selection].filter(k=>k!=='totalUsd').length>=8;
      const dot=element('span','chart-series-color');dot.style.background=definition.color;
      label.append(input,dot,element('span','chart-series-name',definition.label));heading.append(label);
      const fleetSeries=mode==='source'||key==='totalUsd';
      const total=fleetSeries&&range?rangeTotal(daily,key,range):state?.totals?.[key];
      let hours=state?.hours?.[key];
      if(mode==='gpu')hours=state?.gpuHours?.[key];
      else if(fleetSeries)hours=daily.reduce((sum,row)=>Number.isFinite(row[key])?sum+reportedDayHours(row.day,report.updatedAt):sum,0);
      const average=Number.isFinite(total)&&hours>0?total/hours:null;
      row.append(heading,element('td','',hourlyUsd(total)),element('td','',hourlyUsd(average)));
      input.addEventListener('change',()=>{input.checked?selection.add(key):selection.delete(key);changeView();});
      legend.append(row);
      if(focus===key)input.focus({preventScroll:true});
    }
  }
  function demoSeries(keys,requested,group){
    const result={series:[],totals:{},hours:{},gpuHours:{}};
    for(const device of group==='gpu'?groups:roster){
      const totals=new Map();
      let gpuHours=0;
      for(const member of device.members||[device]){
        for(const row of member.daily||[]){
          if(row.day<requested.from||row.day>requested.to)continue;
          totals.set(row.day,(totals.get(row.day)??0)+row.totalUsd);
          gpuHours+=reportedDayHours(row.day,report.updatedAt)*member.gpuCount;
        }
      }
      const daily=[...totals].map(([day,totalUsd])=>({day,totalUsd}));
      result.totals[device.deviceKey]=rangeTotal(daily,'totalUsd',requested);
      result.hours[device.deviceKey]=daily.reduce((sum,row)=>sum+reportedDayHours(row.day,report.updatedAt),0);
      result.gpuHours[device.deviceKey]=gpuHours;
      if(keys.includes(device.deviceKey))result.series.push({deviceKey:device.deviceKey,daily});
    }
    return result;
  }
  async function loadDevices(){
    if(document.hidden||mode==='source'||!report||!range||!devices().length||loading)return;
    clearTimeout(pollTimer);pollTimer=undefined;
    const group=mode,requested={...range},key=windowKey(),keys=[...selections[group]].filter(id=>id!=='totalUsd');
    const state=windows.get(key);
    if(state?.complete&&keys.every(id=>state.series.has(id)))return;
    const generation=++fetchGeneration;loading=true;
    if(!state||!state.complete)status.textContent=state?.message||'Loading daily earnings history…';
    try{
      const params=new URLSearchParams({group,from:requested.from,to:requested.to});for(const id of keys)params.append('series',id);
      const result=report.demo?demoSeries(keys,requested,group):await get('/api/earnings/series?'+params);
      if(generation!==fetchGeneration)return;
      const series=new Map(state?.series);
      for(const item of result.series||[])series.set(item.deviceKey,item.daily);
      const failed=!!result.progress?.failed;
      const message=result.pending?'Loading history · '+result.progress.loaded+'/'+result.progress.total+' days':failed?'Some days are stale or unavailable':'';
      windows.set(key,{series,totals:result.totals,hours:result.hours,gpuHours:result.gpuHours,complete:!result.pending&&!failed,message});
      if(windows.size>32)windows.delete(windows.keys().next().value);
      status.textContent=message;
      if(result.pending)pollAfter(3500);
      else if(failed)pollAfter(300000);
    }catch{
      if(generation===fetchGeneration){status.textContent='Daily earnings history unavailable';pollAfter(300000);}
    }finally{if(generation===fetchGeneration){loading=false;draw();updateTable();}}
  }
  function changeView(){
    fetchGeneration++;loading=false;clearTimeout(pollTimer);pollTimer=undefined;status.textContent='';
    draw();updateTable();loadDevices();
  }
  function draw(){
    tooltip.hidden=true;host.replaceChildren();range=null;$('#chart-period').textContent='';
    if(!report?.daily){host.append(element('p','chart-empty','Waiting for daily earnings.'));return;}
    try{range=chartDateRange($('#chart-range').value,{from:$('#chart-from').value,to:$('#chart-to').value,availableFrom:report.from});}catch(error){host.append(element('p','chart-empty',error.message));return;}
    days=chartDays(range);hoverIndex=Math.min(hoverIndex,days.length-1);$('#chart-period').textContent=dateLabel(range.from)+' – '+dateLabel(range.to);
    const series=windows.get(windowKey())?.series;
    activeSeries=earningsChartSeries({daily:report.daily,devices:devices().map(d=>({...d,daily:series?.get(d.deviceKey)||[]})),range,mode,enabled:[...selections[mode]]});
    const values=activeSeries.flatMap(s=>s.points.map(p=>p.value).filter(v=>v!==null));
    if(!activeSeries.length){host.append(element('p','chart-empty','Select a series to display.'));return;}
    if(!values.length){host.append(element('p','chart-empty',loading?'Loading daily earnings history…':'No earnings reported in this range.'));return;}
    const width=Math.max(280,host.clientWidth),height=300,left=54,right=16,top=18,bottom=40,plotWidth=width-left-right,plotHeight=height-top-bottom;
    const {min,max,step,decimals}=chartScale(values);
    const x=i=>left+(days.length===1?plotWidth/2:i/(days.length-1)*plotWidth),y=value=>top+(max-value)/(max-min)*plotHeight;
    const svg=svgElement('svg',{viewBox:`0 0 ${width} ${height}`,width:'100%',height,role:'img','aria-label':'Daily earnings chart. Hover or tap a day for the breakdown.'});
    for(let value=min;value<=max+step*.001;value+=step){
      const at=y(value);svg.append(svgElement('line',{x1:left,x2:width-right,y1:at,y2:at,stroke:'#e5e9e0','stroke-width':1}));
      svg.append(svgElement('text',{x:left-8,y:at+3,'text-anchor':'end',class:'chart-axis-label'},'$'+value.toFixed(decimals)));
    }
    const ticks=Math.max(2,Math.min(7,Math.floor(plotWidth/85))),indices=[...new Set(Array.from({length:ticks},(_,i)=>Math.round(i/(ticks-1)*(days.length-1))))];
    for(const i of indices)svg.append(svgElement('text',{x:x(i),y:height-14,'text-anchor':i===0?'start':i===days.length-1?'end':'middle',class:'chart-axis-label'},shortDate.format(Date.parse(days[i]+'T00:00Z'))));
    for(const series of activeSeries){
      let path='',connected=false;
      for(let i=0;i<series.points.length;i++){
        const value=series.points[i].value;if(value===null){connected=false;continue;}
        path+=(connected?'L':'M')+x(i).toFixed(2)+','+y(value).toFixed(2)+' ';connected=true;
        if(days.length<=90)svg.append(svgElement('circle',{cx:x(i),cy:y(value),r:series.key==='totalUsd'?2.5:2,fill:series.color}));
      }
      svg.append(svgElement('path',{d:path,fill:'none',stroke:series.color,'stroke-width':series.key==='totalUsd'?2.8:1.8,'stroke-linecap':'round','stroke-linejoin':'round'}));
    }
    const cursor=svgElement('line',{x1:left,x2:left,y1:top,y2:height-bottom,stroke:'#7c8c75','stroke-dasharray':'3 3',visibility:'hidden'});svg.append(cursor);
    const nearest=event=>{const bounds=svg.getBoundingClientRect();hoverIndex=Math.max(0,Math.min(days.length-1,Math.round(((event.clientX-bounds.left)/bounds.width*width-left)/plotWidth*(days.length-1))));};
    svg.addEventListener('pointermove',event=>{nearest(event);const data=detail();tooltip.replaceChildren(element('strong','',data.title),data.content);tooltip.hidden=false;tooltip.style.left=Math.max(10,Math.min(innerWidth-tooltip.offsetWidth-10,event.clientX+12))+'px';tooltip.style.top=Math.max(10,Math.min(innerHeight-tooltip.offsetHeight-10,event.clientY-20))+'px';cursor.setAttribute('x1',x(hoverIndex));cursor.setAttribute('x2',x(hoverIndex));cursor.setAttribute('visibility','visible');});
    svg.addEventListener('pointerdown',nearest);svg.addEventListener('pointerleave',()=>{tooltip.hidden=true;cursor.setAttribute('visibility','hidden');});
    svg.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();hoverIndex=Math.max(0,Math.min(days.length-1,hoverIndex+(event.key==='ArrowRight'?1:-1)));svg.setAttribute('aria-label',dateLabel(days[hoverIndex])+'. Press Enter for earnings.');}});
    bindPopover(svg,()=>{tooltip.hidden=true;return detail();});host.append(svg);
  }
  function updateModeButtons(){
    for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.chartMode===mode));
  }
  updateModeButtons();
  for(const button of modeButtons)button.addEventListener('click',()=>{
    if(mode===button.dataset.chartMode)return;
    mode=button.dataset.chartMode;
    history.replaceState({...history.state,earningsChartMode:mode},'');
    updateModeButtons();
    changeView();
  });
  $('#chart-range').addEventListener('change',()=>{$('#chart-custom-range').hidden=$('#chart-range').value!=='custom';changeView();});
  for(const id of ['chart-from','chart-to'])$('#'+id).addEventListener('change',changeView);
  new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(draw,80);}).observe(host);
  return {update(next){
    report=next;roster=report?.machines||[];groups=gpuGroups(roster);
    for(const [group,items] of [['machine',roster],['gpu',groups]]){
      const selection=selections[group];
      if(!initialized.has(group)&&items.length){for(const item of items.slice(0,8))selection.add(item.deviceKey);initialized.add(group);}
      for(const key of selection)if(key!=='totalUsd'&&!items.some(item=>item.deviceKey===key))selection.delete(key);
    }
    const today=new Date().toISOString().slice(0,10);
    for(const id of ['chart-from','chart-to']){$('#'+id).min=report?.from??'';$('#'+id).max=today;}
    if(!$('#chart-to').value)$('#chart-to').value=today;if(!$('#chart-from').value)$('#chart-from').value=new Date(Date.now()-29*86400000).toISOString().slice(0,10);
    const nextRevision=next?next.updatedAt+(next.scopeRevision??''):null;
    if(revision!==nextRevision){revision=nextRevision;windows.clear();changeView();}
    else{draw();updateTable();if(!pollTimer)loadDevices();}
  }};
}
