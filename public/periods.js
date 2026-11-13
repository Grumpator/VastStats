import {dayKey,addDays,midnight} from './model.js?v=1.3.0';

const HOUR=3600000;
export const periods=[{key:'day',label:'24h',scale:'hours'},{key:'week',label:'Week',scale:'days'},{key:'month',label:'Month',scale:'days'},{key:'year',label:'Year',scale:'months'}];
function calendarMonth(key,delta){const date=new Date(key.slice(0,7)+'-01T12:00Z');date.setUTCMonth(date.getUTCMonth()+delta);return date.toISOString().slice(0,10);}

// Both pages use the same clock-hour/calendar boundaries, independent of screen width.
export function periodWindow(period,reference=Date.now()){
  const key=dayKey(new Date(reference)),definition=periods.find(p=>p.key===period);
  if(!definition)throw Error('Unknown period');
  let start,end;
  if(period==='day'){end=Math.floor(reference/HOUR)*HOUR+HOUR;start=end-24*HOUR;}
  if(period==='week'){const weekday=new Date(key+'T12:00Z').getUTCDay()||7;start=midnight(addDays(key,1-weekday));end=midnight(addDays(key,8-weekday));}
  if(period==='month'){start=midnight(key.slice(0,7)+'-01');end=midnight(calendarMonth(key,1));}
  if(period==='year'){const year=Number(key.slice(0,4));start=midnight(year+'-01-01');end=midnight((year+1)+'-01-01');}
  return {...definition,start,end};
}

export function movePeriod(period,reference,direction,now=Date.now()){
  const window=periodWindow(period,reference),key=dayKey(new Date(window.end-1));
  const next=period==='day'?window.end-1+direction*24*HOUR:
    period==='week'?midnight(addDays(key,direction*7))+12*HOUR:
    period==='month'?midnight(calendarMonth(key,direction)):
    midnight((Number(key.slice(0,4))+direction)+'-01-01');
  return Math.min(next,now);
}

export function periodBins(window){
  const bins=[];let start=window.start;
  while(start<window.end){
    const key=dayKey(new Date(start));
    const end=Math.min(window.end,window.scale==='hours'?start+HOUR:window.scale==='days'?midnight(addDays(key,1)):midnight(calendarMonth(key,1)));
    bins.push({start,end,key});start=end;
  }
  return bins;
}
