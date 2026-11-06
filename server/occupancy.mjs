import {periods} from '../public/periods.js';
export const occupancyPeriods=periods.filter(period=>period.key!=='year');
export function occupancyTotal(occupied=0,observed=0){
  return {percent:observed>0?Math.min(100,occupied/observed*100):null,occupiedSeconds:occupied,observedSeconds:observed};
}
export function occupancyResult(value){return {...occupancyTotal(value.occupied,value.observed),coverage:value.elapsed>0?Math.min(1,value.observed/value.elapsed):null};}
