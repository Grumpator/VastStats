export const occupancyPeriods=[{key:'day',hours:24},{key:'week',hours:168},{key:'month',hours:720}];
export function occupancyTotal(occupied=0,observed=0){
  return {percent:observed>0?Math.min(100,occupied/observed*100):null,occupiedSeconds:occupied,observedSeconds:observed};
}
export function occupancyResult(value){return {...occupancyTotal(value.occupied,value.observed),coverage:value.elapsed>0?Math.min(1,value.observed/value.elapsed):null};}
