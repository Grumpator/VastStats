const rate=value=>Number.isFinite(value)&&value>=0?value:null;
// Match Vast's host CLI: listing bandwidth fields are per GB, but the
// contracts feed reports the booked bandwidth price on the per-TB basis.
const listingBandwidth=value=>rate(value)===null?null:value*1024;
const rentalTypes=new Map([
  ['on-demand','On demand'],['ondemand','On demand'],['on_demand','On demand'],
  ['reserved','Reserved'],['bid','Interruptible'],['interruptible','Interruptible']
]);

export function deviceRates(machine,contracts){
  return {
    ask:{
      gpu:rate(machine.listed_gpu_cost),disk:rate(machine.listed_storage_cost),volume:rate(machine.listed_volume_cost),
      upload:listingBandwidth(machine.listed_inet_up_cost),download:listingBandwidth(machine.listed_inet_down_cost)
    },
    // The caller only supplies contracts after the existing earnings validation succeeds.
    contracts:contracts?.map(contract=>({
      state:contract.state,type:rentalTypes.get(contract.rental_type)??null,
      gpus:rate(contract.num_gpus),
      // A stopped rental can retain its agreed GPU price while charging only for storage.
      gpu:contract.charge_types.includes('gpu')||contract.num_gpus>0||contract.gpu_price_dph>0?rate(contract.gpu_price_dph):null,
      gpuCharging:contract.state==='running'&&contract.charge_types.includes('gpu'),
      disk:contract.charge_types.includes('disk')?rate(contract.disk_price_dpgbm):null,
      volume:contract.charge_types.includes('volume')?rate(contract.vol_price_dpgbm):null,
      upload:rate(contract.inet_up_cost),download:rate(contract.inet_down_cost)
    }))??null
  };
}
