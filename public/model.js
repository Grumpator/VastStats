export const ZONE = 'Europe/London';
const HOUR = 3600000;
export function dayKey(date) { return new Intl.DateTimeFormat('en-CA', {timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
export function addDays(key, count) { const d = new Date(key+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+count); return d.toISOString().slice(0,10); }
export function midnight(key) {
  const target = Date.parse(key+'T00:00:00Z'); let t = target;
  for(let i=0;i<3;i++) {
    const parts = new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(t);
    const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
    const wall = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    t += target-wall;
  }
  return t;
}
export function periodDays(key,view) {
  let start=key,end=addDays(key,1);
  if(view==='week') { const dow = new Date(key+'T12:00Z').getUTCDay(); start=addDays(key,-((dow+6)%7)); end=addDays(start,7); }
  if(view==='month') { start=key.slice(0,7)+'-01'; const d=new Date(start+'T12:00Z'); d.setUTCMonth(d.getUTCMonth()+1); end=d.toISOString().slice(0,10); }
  if(view==='year') { start=key.slice(0,4)+'-01-01';end=(Number(key.slice(0,4))+1)+'-01-01'; }
  const days=[]; for(let d=start;d<end;d=addDays(d,1)) days.push(d); return days;
}
export function binsForDay(key,hourly) {
  const start=midnight(key),end=midnight(addDays(key,1));
  if(!hourly) return [{start,end,key}];
  const bins=[];for(let t=start;t<end;t+=HOUR) bins.push({start:t,end:Math.min(t+HOUR,end),key}); return bins;
}
export function aggregate(records,start,end,now=Date.now()) {
  const elapsed=Math.max(0,(Math.min(end,now)-start)/1000);let observed=0,occupied=0,income=0,hasIncome=true,stored=null,last=-Infinity,offline=0,maintenance=0,connectionObserved=0,maintenanceObserved=0,listed=0,unlisted=0,listingObserved=0;
  for(const r of records) {
    const a=r.startMs??Date.parse(r.start),b=r.endMs??Date.parse(r.end),overlap=Math.max(0,(Math.min(b,end,now)-Math.max(a,start))/1000);
    if(!overlap||b<=a) continue;
    const fraction=overlap/((b-a)/1000);
    observed+=r.observedSeconds*fraction;occupied+=r.occupiedSeconds*fraction;
    offline+=(r.offlineSeconds??0)*fraction;maintenance+=(r.maintenanceSeconds??0)*fraction;
    connectionObserved+=(r.connectionObservedSeconds??0)*fraction;maintenanceObserved+=(r.maintenanceObservedSeconds??0)*fraction;
    listed+=(r.listedSeconds??0)*fraction;unlisted+=(r.unlistedSeconds??0)*fraction;listingObserved+=(r.listingObservedSeconds??0)*fraction;
    if(r.incomeUsd==null)hasIncome=false;else income+=r.incomeUsd*fraction;
    if(b>last){last=b;stored=r.storedInstances;}
  }
  const coverage=elapsed?Math.min(1,observed/elapsed):0;
  const percent=observed?Math.min(100,occupied/observed*100):null;
  return {observed,occupied,elapsed,coverage,percent,stored,offline,maintenance,connectionObserved,maintenanceObserved,listed,unlisted,listingObserved,income:observed&&hasIncome?income:null,
    borderState:offline>0?'offline':maintenance>0?'maintenance':unlisted>0?'unlisted':listed>0?'listed':'unknown',
    state:!elapsed?'future':!observed?'unknown':percent>=99.999?'full':percent>0?'partial':'idle'};
}
export function currentStatus(sample,now=Date.now(),maxAgeSeconds=5400){
  if(!sample||!Number.isFinite(Date.parse(sample.at))||now<Date.parse(sample.at))return {connection:'unknown',maintenance:null,next:null,listed:null,running:null,stale:true};
  const stale=now-Date.parse(sample.at)>maxAgeSeconds*1000;
  const windows=sample.maintenanceWindows;
  const active=windows?.some(w=>Date.parse(w.start)<=now&&now<Date.parse(w.end))??null;
  const next=windows?.find(w=>Date.parse(w.start)>now)??null;
  const listed=sample.listed===true&&sample.listingEndsAt&&Date.parse(sample.listingEndsAt)<=now?false:sample.listed??null;
  const running=sample.connection==='offline'?false:typeof sample.running==='boolean'?sample.running:Number.isFinite(sample.runningInstances)?sample.runningInstances>0:null;
  return {connection:sample.connection??'unknown',maintenance:active,next,listed,running,stale};
}
export function demoData(now=Date.now()) {
  const boxes=['Alpha','Beta','Gamma'].map((name,index)=>{
    const hours=[];const first=midnight(new Date(now).getUTCFullYear()+'-01-01');
    for(let t=first;t<now;t+=HOUR){
      const n=Math.floor(t/HOUR),v=(Math.sin(n*.073+index*7)+Math.sin(n*.023+index*3)+2)/4;
      if((n+index*31)%173<4)continue;
      const end=Math.min(t+HOUR,now),observed=(end-t)/1000;
      const occupancy=v>.35?(v>.47?1:.3+(v-.35)*4):0;
      const offline=(n+index*13)%379<3,maintenance=(n+index*17)%421<2,listed=(n+index*19)%503>=10;
      hours.push({start:new Date(t).toISOString(),end:new Date(end).toISOString(),observedSeconds:observed,occupiedSeconds:offline?0:observed*occupancy,storedInstances:occupancy>0?1+(v>.88?1:0):v>.22?1:0,runningSessions:offline||!occupancy?0:1+(v>.88?1:0),incomeUsd:null,connectionObservedSeconds:observed,offlineSeconds:offline?observed:0,maintenanceObservedSeconds:observed,maintenanceSeconds:maintenance?observed:0,listingObservedSeconds:observed,listedSeconds:listed?observed:0,unlistedSeconds:listed?0:observed});
    }
    const stored=hours.at(-1)?.storedInstances??0;
    const daily=new Map();for(const row of hours){const key=dayKey(new Date(row.start)),d=daily.get(key)||{start:new Date(midnight(key)).toISOString(),observedSeconds:0,runningSessions:0};d.observedSeconds+=row.observedSeconds;d.runningSessions+=row.runningSessions;daily.set(key,d);}
    return {name,hours,days:[...daily.values()],lastSample:{at:new Date(now).toISOString(),storedInstances:stored,runningInstances:index===1?0:stored?1:0,allocatedStorageGb:stored*(index+1)*40,connection:index===1?'offline':'online',listed:index!==1,maintenanceWindows:index===2?[{start:new Date(now-3600000).toISOString(),end:new Date(now+3600000).toISOString()}]:[]}};
  });return {version:1,updatedAt:new Date(now).toISOString(),boxes};
}
