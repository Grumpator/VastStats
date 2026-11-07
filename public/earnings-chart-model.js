const DAY=86400000;
export const earningsSources=[{key:'computeUsd',label:'GPU',color:'#34845c'},{key:'bandwidthUsd',label:'Bandwidth',color:'#7b71b8'},{key:'storageUsd',label:'Storage',color:'#d4a13c'},{key:'totalUsd',label:'Total',color:'#253d32'}];
const palette=['#34845c','#7b71b8','#d4a13c','#579bac','#b9757a','#7f9551','#b48b60','#7494c6'];
export const gpuKey=model=>model?'gpu:'+model:'gpu-unknown';
export function gpuGroups(devices){
  const groups=new Map();
  for(const device of devices){
    const key=gpuKey(device.gpuModel);
    if(!groups.has(key))groups.set(key,{deviceKey:key,name:device.gpuModel||'Unknown GPU',members:[]});
    groups.get(key).members.push(device);
  }
  return [...groups.values()].sort((a,b)=>(a.deviceKey==='gpu-unknown')-(b.deviceKey==='gpu-unknown')||a.name.localeCompare(b.name));
}
export function earningsDefinitions(mode,devices=[]){
  return mode==='source'?earningsSources:devices.map((d,i)=>({key:d.deviceKey,label:d.name,color:palette[i%palette.length],daily:d.daily})).concat({key:'totalUsd',label:'Fleet total',color:'#253d32'});
}
export function rangeTotal(rows,field,range){
  let total=null;
  for(const row of rows)if(row.day>=range.from&&row.day<=range.to&&Number.isFinite(row[field]))total=(total??0)+row[field];
  return total;
}
export function reportedDayHours(day,checkedAt){
  const elapsed=Date.parse(checkedAt)-Date.parse(day+'T00:00Z');
  return Math.max(0,Math.min(DAY,elapsed))/3600000;
}
export function rankedPoints(series,index){
  return series.map(s=>({label:s.label,value:s.points[index]?.value??null})).sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity));
}
export function chartDateRange(preset,{from,to,availableFrom,now=Date.now()}={}){
  const today=new Date(now).toISOString().slice(0,10),last=Date.parse(today+'T00:00Z');
  let start=preset==='custom'?from:preset==='year'?today.slice(0,4)+'-01-01':new Date(last-(Number(preset)-1)*DAY).toISOString().slice(0,10),end=preset==='custom'?to:today;
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value+'T00:00Z'))&&new Date(value+'T00:00Z').toISOString().slice(0,10)===value;
  if(!valid(start)||!valid(end))throw Error('Choose valid dates');
  if(availableFrom&&start<availableFrom)start=availableFrom;if(end>today)end=today;
  if(start>end||(Date.parse(end)-Date.parse(start))/DAY>365)throw Error('Choose a range within the available year');
  return {from:start,to:end};
}
export function chartDays(range){const days=[];for(let at=Date.parse(range.from+'T00:00Z');at<=Date.parse(range.to+'T00:00Z');at+=DAY)days.push(new Date(at).toISOString().slice(0,10));return days;}
export function chartScale(values){
  let min=Math.min(0,...values),max=Math.max(0,...values);if(max===min)max=min+1;
  const pad=(max-min)*.08;max+=pad;if(min<0)min-=pad;
  const rough=(max-min)/5,power=10**Math.floor(Math.log10(rough)),step=[1,2,2.5,5,10].find(n=>n*power>=rough)*power;
  min=Math.floor(min/step)*step;max=Math.ceil(max/step)*step;
  let decimals=0;while(decimals<4&&!Number.isInteger(step*10**decimals))decimals++;
  return {min,max,step,decimals};
}
export function earningsChartSeries({daily=[],devices=[],range,mode='source',enabled=[]}){
  const days=chartDays(range),fleet=new Map(daily.map(row=>[row.day,row]));
  const definitions=earningsDefinitions(mode,devices);
  return definitions.filter(d=>enabled.includes(d.key)).map(d=>{
    const grouped=mode!=='source'&&d.key!=='totalUsd',rows=grouped?new Map((d.daily||[]).map(row=>[row.day,row])):fleet;
    return {...d,points:days.map(day=>{const value=rows.get(day)?.[grouped?'totalUsd':d.key];return {day,value:Number.isFinite(value)?value:null};})};
  });
}
