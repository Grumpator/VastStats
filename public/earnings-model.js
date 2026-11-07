const DAY=86400000;
export function billingWindow(now=Date.now()){
  const today=Math.floor(now/DAY),date=new Date(today*DAY),weekday=date.getUTCDay()||7;
  const starts={today,yesterday:today-1,week:today-weekday+1,month:Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1)/DAY};
  return {starts,start:Math.min(...Object.values(starts))*DAY,end:(today+1)*DAY};
}
export function recordedPeriod(report,key,now=Date.now()){
  const value=report?.periods?.[key];
  return value&&value.reported!==false&&Date.parse(value.from)===billingWindow(now).starts[key]*DAY?value:null;
}
export function recordedTotal(report){
  const daily=report?.daily;
  if(!daily?.length)return null;
  const sum=key=>daily.reduce((total,row)=>total+row[key],0);
  return {from:daily[0].day+'T00:00:00Z',to:report.updatedAt,computeUsd:sum('computeUsd'),bandwidthUsd:sum('bandwidthUsd'),storageUsd:sum('storageUsd'),totalUsd:sum('totalUsd')};
}
