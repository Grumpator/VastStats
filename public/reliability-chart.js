import {chartDateRange,earningsDefinitions} from './earnings-chart-model.js?v=1.3.5';
import {percentLabel,reliabilityLabel} from './model.js?v=1.3.5';
import {element} from './ui.js?v=1.3.5';
import {bindPopover} from './popover.js?v=1.3.5';

export function createReliabilityChart(get){
  const $=id=>document.getElementById('reliability-'+id);
  const panel=$('history'),preset=$('range'),from=$('from'),to=$('to');
  const chart=$('chart'),status=$('status'),hidden=new Set();
  const dayLabel=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short'});
  const readingLabel=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'});
  const tooltip=element('div','earnings-chart-tooltip');
  tooltip.hidden=true;
  tooltip.setAttribute('role','tooltip');
  document.body.append(tooltip);
  const hideTooltip=()=>{tooltip.hidden=true;};
  let devices=[],generation=0,plot=null;
  bindPopover($('info'),()=>({title:'Reliability history',copy:'The graph uses every saved reliability reading. Gaps longer than 15 minutes break the line. Hover or tap the graph to inspect a snapshot, or focus it and use the arrow keys. Use the checkboxes to show or hide devices.'}));

  function svg(tag,attrs={},text){
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
    if(text!==undefined)node.textContent=text;
    return node;
  }

  function draw(){
    hideTooltip();
    chart.replaceChildren();
    if(!plot)return;
    const series=plot.series.filter(line=>!hidden.has(line.key)),stamps=new Set();
    let min=Infinity,max=-Infinity;
    for(const line of series)for(const [time,value] of line.points){
      stamps.add(time);min=Math.min(min,value);max=Math.max(max,value);
    }
    if(!Number.isFinite(min)){
      chart.append(element('p','chart-empty',series.length?'No reliability observations in this period.':'Select a series to display.'));
      return;
    }
    const width=Math.max(260,chart.clientWidth),height=300,left=52,right=width-15,top=12,bottom=height-28;
    const low=Math.min(99.6,Math.max(0,Math.floor((min*100-.05)*10)/10));
    const high=Math.min(100,Math.max(low+.4,Math.ceil((max*100+.05)*10)/10));
    const times=[...stamps].sort((a,b)=>a-b);
    const start=Date.parse(plot.range.from+'T00:00Z');
    const end=Math.max(start+1,times.at(-1),Math.min(Date.now(),Date.parse(plot.range.to+'T00:00Z')+86400000));
    const x=time=>left+(time-start)/(end-start)*(right-left);
    const y=value=>bottom-(value-low)/(high-low)*(bottom-top);
    const graph=svg('svg',{viewBox:'0 0 '+width+' '+height,tabindex:0,role:'img','aria-label':'Reliability history. Use the left and right arrow keys to inspect snapshots.'});
    for(let i=0;i<=4;i++){
      const value=low+(high-low)*i/4;
      graph.append(svg('line',{x1:left,x2:right,y1:y(value),y2:y(value),stroke:'var(--line)'}),
        svg('text',{x:left-6,y:y(value)+3,'text-anchor':'end',class:'chart-axis-label'},percentLabel(value)));
    }
    const shownDates=new Set();
    for(const [time,anchor] of [[start,'start'],[end-1,'end'],[(start+end)/2,'middle']]){
      const label=dayLabel.format(time);
      if(shownDates.has(label))continue;
      shownDates.add(label);
      graph.append(svg('text',{x:x(time),y:height-7,'text-anchor':anchor,class:'chart-axis-label'},label));
    }
    for(const line of series){
      const segments=[];
      let previous=null;
      for(const [time,value] of line.points){
        const point=x(time).toFixed(2)+' '+y(value*100).toFixed(2);
        const gap=previous===null||time-previous>15*60_000;
        segments.push(gap?'M'+point+'h0':'L'+point);
        previous=time;
      }
      graph.append(svg('path',{d:segments.join(''),fill:'none',stroke:line.color,'stroke-width':2,'stroke-linecap':'round'}));
    }
    const cursor=svg('g',{visibility:'hidden','pointer-events':'none'});
    graph.append(cursor);
    let index=-1;
    function inspect(next,clientX,clientY){
      index=next;
      const time=times[index],cx=x(time);
      cursor.setAttribute('visibility','visible');
      cursor.replaceChildren(svg('line',{x1:cx,x2:cx,y1:top,y2:bottom,stroke:'#87917e','stroke-dasharray':'3 3'}));
      const detail=element('dl','chart-point-details');
      const readings=series.filter(line=>line.points.has(time)).sort((a,b)=>b.points.get(time)-a.points.get(time));
      for(const line of readings){
        const value=line.points.get(time),label=element('dt'),swatch=element('span','chart-series-color');
        swatch.style.background=line.color;
        label.append(swatch,element('span','chart-series-name',line.label));
        detail.append(label,element('dd','',reliabilityLabel(value)));
        cursor.append(svg('circle',{cx,cy:y(value*100),r:4,fill:line.color,stroke:'#fff'}));
      }
      tooltip.replaceChildren(element('strong','',readingLabel.format(time)+' UTC'),detail);
      tooltip.hidden=false;
      const rect=graph.getBoundingClientRect();
      const anchor=clientX??rect.left+cx/width*rect.width;
      tooltip.style.left=Math.max(10,Math.min(innerWidth-tooltip.offsetWidth-10,anchor+12))+'px';
      tooltip.style.top=Math.max(10,Math.min(innerHeight-tooltip.offsetHeight-10,(clientY??rect.top)+12))+'px';
    }
    function inspectPointer(event){
      const rect=graph.getBoundingClientRect();
      const position=(event.clientX-rect.left)/rect.width*width;
      const target=start+(position-left)/(right-left)*(end-start);
      let lower=0,upper=times.length-1;
      while(lower<upper){
        const middle=Math.floor((lower+upper)/2);
        if(times[middle]<target)lower=middle+1;else upper=middle;
      }
      const nearest=lower>0&&target-times[lower-1]<times[lower]-target?lower-1:lower;
      inspect(nearest,event.clientX,event.clientY);
    }
    function clearInspection(){cursor.setAttribute('visibility','hidden');hideTooltip();}
    graph.addEventListener('pointermove',inspectPointer);
    graph.addEventListener('pointerup',inspectPointer);
    graph.addEventListener('pointerleave',clearInspection);
    graph.addEventListener('blur',clearInspection);
    graph.addEventListener('keydown',event=>{
      if(event.key==='Escape'){clearInspection();return;}
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();
      inspect(index<0?0:Math.max(0,Math.min(times.length-1,index+(event.key==='ArrowRight'?1:-1))));
    });
    chart.append(graph);
  }

  function controls(){
    const body=$('series'),focus=body.contains(document.activeElement)?document.activeElement.value:null;
    const lines=new Map(plot?.series.map(line=>[line.key,line.points]));
    body.replaceChildren();
    for(const line of earningsDefinitions('machine',devices).slice(0,-1)){
      const row=element('tr'),heading=element('th'),label=element('label','chart-series-toggle');
      const checkbox=element('input'),color=element('span','chart-series-color');
      heading.scope='row';
      checkbox.type='checkbox';checkbox.value=line.key;checkbox.checked=!hidden.has(line.key);
      checkbox.setAttribute('aria-label','Plot '+line.label);
      checkbox.onchange=()=>{
        if(checkbox.checked)hidden.delete(line.key);else hidden.add(line.key);
        draw();
      };
      color.style.background=line.color;
      label.append(checkbox,color,element('span','chart-series-name',line.label));
      heading.append(label);
      const last=[...(lines.get(line.key)?.values()??[])].at(-1);
      row.append(heading,element('td','',reliabilityLabel(last)));
      body.append(row);
      if(line.key===focus)checkbox.focus({preventScroll:true});
    }
  }

  async function refresh(){
    const request=++generation;
    controls();
    const roster=devices;
    if(!roster.length){plot=null;draw();status.textContent='No devices to plot.';return;}
    try{
      const range=chartDateRange(preset.value,{from:from.value,to:to.value});
      $('period').textContent=range.from+' – '+range.to+' UTC';
      status.textContent='Loading reliability history…';
      const byDevice=new Map();
      for(let start=0;start<roster.length;start+=8){
        const params=new URLSearchParams(range);
        for(const device of roster.slice(start,start+8))params.append('device',device.deviceKey);
        const {series}=await get('/api/devices/reliability?'+params);
        if(request!==generation)return;
        for(const line of series)byDevice.set(line.deviceKey,new Map(line.points));
      }
      const lines=earningsDefinitions('machine',roster).slice(0,-1).map(line=>({...line,points:byDevice.get(line.key)??new Map()}));
      plot={range,series:lines};
      controls();
      draw();
      status.textContent='';
    }catch(error){
      if(request!==generation)return;
      plot=null;controls();draw();status.textContent=error.message==='Cached API data unavailable'?'Couldn’t load reliability history.':error.message;
    }
  }

  preset.onchange=()=>{$('custom').hidden=preset.value!=='custom';refresh();};
  const today=new Date().toISOString().slice(0,10);
  from.value=chartDateRange('30').from;to.value=today;
  from.max=to.max=today;
  from.onchange=to.onchange=refresh;
  new ResizeObserver(draw).observe(chart);

  return {
    setDevices(boxes){
      devices=boxes;
      if(plot){plot.series=plot.series.filter(line=>devices.some(device=>device.deviceKey===line.key));draw();}
      refresh();
    },
    open(deviceKey){
      hidden.delete(deviceKey);
      controls();
      draw();
      panel.scrollIntoView({block:'nearest'});
      $('title').focus({preventScroll:true});
    }
  };
}
