import {aggregate} from './model.js?v=1.1.1';

const fields=['observed','occupied','offline','maintenance','connectionObserved','maintenanceObserved','listed','unlisted','listingObserved'];
// Confirmed totals do not grow between imports. Only elapsed time/coverage changes.
export function summaryValue(value,bin,now=Date.now(),historyStart=-Infinity){
  const empty=aggregate([],bin.start,bin.end,now,historyStart),result={...empty,...value,elapsed:empty.elapsed};
  result.percent=result.observed?Math.min(100,result.occupied/result.observed*100):null;
  result.coverage=result.elapsed?Math.min(1,result.observed/result.elapsed):0;
  result.state=empty.state==='not-tracked'||!result.elapsed?empty.state:!result.observed?'unknown':result.percent>=99.999?'full':result.percent>0?'partial':'idle';
  return result;
}
export function combineSummaries(values,bin,now=Date.now(),historyStart=-Infinity){
  const total=aggregate([],bin.start,bin.end,now,historyStart);let income=0,hasIncome=true;
  for(const value of values){
    for(const field of fields)total[field]+=value[field]??0;
    if(value.observed){if(value.income==null)hasIncome=false;else income+=value.income;}
  }
  total.income=total.observed&&hasIncome?income:null;
  return summaryValue(total,bin,now,historyStart);
}

// Preserve all evidence used by tooltips/border precedence, not thousands of sightings.
export function compactSnapshots(snapshots){
  const latest=new Map();
  for(const sample of snapshots){
    for(const [key,match] of [['latest',true],['offline',sample.connection==='offline'],['maintenance',sample.maintenance===true],['unlisted',sample.listed===false],['listed',sample.listed===true]]){
      if(match&&(!latest.has(key)||sample.at>latest.get(key).at))latest.set(key,sample);
    }
  }
  return [...new Map([...latest.values()].map(sample=>[sample.at,sample])).values()].sort((a,b)=>a.at.localeCompare(b.at));
}
