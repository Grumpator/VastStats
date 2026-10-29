import {dayKey,addDays,midnight} from './model.js?v=3.1.0';
const HOUR=3600000;
export function isoWeek(key){
  const date=new Date(key+'T12:00Z'),weekday=date.getUTCDay()||7;
  date.setUTCDate(date.getUTCDate()+4-weekday);
  const year=date.getUTCFullYear(),first=new Date(Date.UTC(year,0,1,12));
  return {year,week:Math.ceil(((date-first)/86400000+1)/7)};
}
// An exclusive end keeps adjacent pages contiguous, including clock-change hours.
export function windowEndForDate(selected,scale,now=Date.now()){
  if(scale==='hours')return selected===dayKey(new Date(now))?Math.floor(now/HOUR)*HOUR+HOUR:midnight(addDays(selected,1));
  if(scale==='days')return midnight(addDays(selected,1));
  if(scale==='weeks'){const weekday=new Date(selected+'T12:00Z').getUTCDay()||7;return midnight(addDays(selected,8-weekday));}
  const next=new Date(selected.slice(0,7)+'-01T12:00Z');next.setUTCMonth(next.getUTCMonth()+1);return midnight(next.toISOString().slice(0,10));
}
function shift(end,scale,direction){
  if(scale==='hours')return end+direction*HOUR;
  const key=dayKey(new Date(end));
  if(scale!=='months')return midnight(addDays(key,direction*(scale==='weeks'?7:1)));
  const date=new Date(key+'T12:00Z');date.setUTCMonth(date.getUTCMonth()+direction);return midnight(date.toISOString().slice(0,10));
}
export function timelineBins(end,scale,count){
  const bins=[];for(let i=0;i<count;i++){const start=shift(end,scale,-1);bins.unshift({start,end,key:dayKey(new Date(start))});end=start;}return bins;
}
export function moveWindow(end,scale,count,direction){
  for(let i=0;i<count;i++)end=shift(end,scale,direction);return end;
}
export function visibleSlotCount(width,metadataWidth){return Math.max(1,Math.floor((width-26-metadataWidth-12+4)/28));}
// Rows are sorted once per device. Each circle visits only its overlapping hours.
export function recordsForBin(rows,bin){
  let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].endMs<=bin.start)lo=mid+1;else hi=mid;}
  const first=lo;while(lo<rows.length&&rows[lo].startMs<bin.end)lo++;return rows.slice(first,lo);
}
