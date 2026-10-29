import {dayKey,addDays,midnight,periodDays} from './model.js?v=2.6.0';
const HOUR=3600000;
// An exclusive end keeps adjacent pages contiguous, including clock-change hours.
export function compactEnd(selected,view,now=Date.now()){
  if(view==='hours')return selected===dayKey(new Date(now))?Math.floor(now/HOUR)*HOUR+HOUR:midnight(addDays(selected,1));
  if(view==='days')return midnight(addDays(selected,1));
  return midnight(addDays(periodDays(selected,view==='weeks'?'week':'month').at(-1),1));
}
function shift(end,view,direction){
  if(view==='hours')return end+direction*HOUR;
  const key=dayKey(new Date(end));
  if(view!=='months')return midnight(addDays(key,direction*(view==='weeks'?7:1)));
  const date=new Date(key+'T12:00Z');date.setUTCMonth(date.getUTCMonth()+direction);return midnight(date.toISOString().slice(0,10));
}
export function compactBins(end,view,count){
  const bins=[];for(let i=0;i<count;i++){const start=shift(end,view,-1);bins.unshift({start,end,key:dayKey(new Date(start))});end=start;}return bins;
}
export function moveCompact(end,view,count,direction){
  for(let i=0;i<count;i++)end=shift(end,view,direction);return end;
}
export function compactCount(width,metadataWidth){return Math.max(1,Math.floor((width-26-metadataWidth-12+4)/28));}
// Rows are sorted once per device. Each circle visits only its overlapping hours.
export function recordsForBin(rows,bin){
  let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].endMs<=bin.start)lo=mid+1;else hi=mid;}
  const first=lo;while(lo<rows.length&&rows[lo].startMs<bin.end)lo++;return rows.slice(first,lo);
}
