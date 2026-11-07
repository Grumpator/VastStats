// Vast contract storage prices are USD/GB/month, using a 30-day billing month.
const HOURS_PER_MONTH=30*24;
const valid=value=>Number.isFinite(value)&&value>=0;
export function contractEarnings(response,{includeGpuCount=false}={}){
  if(!Array.isArray(response?.contracts)||response.truncated||response.omitted_count>0||response.billing_degraded||response.aggregation_degraded)throw Error('Incomplete contract rates');
  let compute=0,storage=0,runningGpuCount=0;
  const seen=new Set();
  for(const contract of response.contracts){
    if(contract.contract_id!=null){const id=String(contract.contract_id);if(seen.has(id))throw Error('Duplicate contract');seen.add(id);}
    const {state,charge_types:types}=contract;
    if(!['running','stopped','offline'].includes(state)||!Array.isArray(types)||types.some(type=>!['gpu','disk','volume'].includes(type)))throw Error('Unknown contract state or charge type');
    if(state==='offline')continue;
    if(state==='running'&&types.includes('gpu')){
      if(!Number.isInteger(contract.num_gpus)||contract.num_gpus<0||!valid(contract.gpu_price_dph))throw Error('Invalid GPU rate');
      compute+=contract.num_gpus*contract.gpu_price_dph;
      runningGpuCount+=contract.num_gpus;
    }
    for(const [type,size,price] of [['disk','disk_size_gb','disk_price_dpgbm'],['volume','vol_size_gb','vol_price_dpgbm']])if(types.includes(type)){
      if(!valid(contract[size])||(contract[size]>0&&!valid(contract[price])))throw Error('Invalid storage rate');
      if(contract[size]>0)storage+=contract[size]*contract[price]/HOURS_PER_MONTH;
    }
  }
  if(!valid(compute+storage))throw Error('Invalid contract total');
  const earnings={computeUsdPerHour:compute,storageUsdPerHour:storage,totalUsdPerHour:compute+storage};
  if(includeGpuCount)earnings.runningGpuCount=runningGpuCount;
  return earnings;
}
export function fleetEarnings(boxes){
  const unavailableDevices=boxes.filter(box=>!box.lastSample?.earnings).length;
  if(!boxes.length||unavailableDevices)return {computeUsdPerHour:null,storageUsdPerHour:null,totalUsdPerHour:null,unavailableDevices};
  const computeUsdPerHour=boxes.reduce((total,box)=>total+box.lastSample.earnings.computeUsdPerHour,0),storageUsdPerHour=boxes.reduce((total,box)=>total+box.lastSample.earnings.storageUsdPerHour,0);
  return {computeUsdPerHour,storageUsdPerHour,totalUsdPerHour:computeUsdPerHour+storageUsdPerHour,unavailableDevices:0};
}
