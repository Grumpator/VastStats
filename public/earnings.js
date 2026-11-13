import {demoEarnings} from './earnings-demo.js?v=1.3.1';
import {cachedAPI} from './api.js?v=1.3.1';
import {hourlyUsd} from './now.js?v=1.3.1';
import {recordedPeriod,recordedTotal} from './earnings-model.js?v=1.3.1';
import {icon} from './ui.js?v=1.3.1';
import {bindPopover} from './popover.js?v=1.3.1';
import {createEarningsChart} from './earnings-chart.js?v=1.3.1';

const $=selector=>document.querySelector(selector),get=cachedAPI(),money=hourlyUsd;
const stamp=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'}).format(Date.parse(value))+' UTC':'Not yet checked';
let data=null;
const chart=createEarningsChart({get});
const demo=new URLSearchParams(location.search).has('demo');
const periods={today:'Today',week:'This week',month:'This month',total:'Total'};
const figure=(report,key,now)=>key==='total'?recordedTotal(report):recordedPeriod(report,key,now);
const accountReport=()=>data?.accountReport??(data?.report?.version===2?data.report:null);
function earningsHelp(key){
  const report=accountReport(),value=figure(report,key);
  let title='Recorded earnings',copy='Money reported by Vast for UTC billing days. Week starts Monday and Month starts on the first. GPU, bandwidth (upload + download) and storage are included. No additional commission adjustment is applied. Today may lag while Vast posts earnings. This is separate from the current hourly rate, which excludes bandwidth.';
  if(value){title=periods[key]+' · recorded earnings';copy=(key==='total'?'Sum of the available daily report (up to 366 UTC dates). ':'')+'GPU '+money(value.computeUsd)+' · Bandwidth '+money(value.bandwidthUsd)+' · Storage '+money(value.storageUsd)+'. From '+stamp(value.from)+' to '+stamp(value.to)+'. Amounts are as reported by Vast.';if(key!=='today')copy+=' The daily average uses UTC days with a report, including today so far if reported.';}
  if(periods[key]&&!value){title=periods[key]+' · waiting for earnings';copy='Vast has not posted earnings for this UTC billing period yet.';}
  copy+=' Report checked '+stamp(report?.updatedAt)+'.'+(report?.lastReportedDay?' Latest reported day: '+report.lastReportedDay+'.':'');
  if(data?.collection?.earnings?.failed)copy+=' The last refresh failed; available saved figures are retained.';
  return {title,copy};
}
function render(){
  const report=accountReport(),now=Date.now();
  for(const key of Object.keys(periods)){
    const value=figure(report,key,now),amount=$('#earned-'+key),button=$('#earned-'+key+'-button');
    amount.replaceChildren(value?document.createTextNode(money(value.totalUsd)):icon('clock'));amount.classList.toggle('waiting-value',!value);
    const reportedDays=value&&key!=='today'?report.daily.filter(row=>row.day>=value.from.slice(0,10)&&row.day<=value.to.slice(0,10)).length:0;
    const average=reportedDays?money(value.totalUsd/reportedDays)+'/day':'';
    button.querySelector('.metric-note').textContent=periods[key]+(average?' ('+average+')':'');
    button.setAttribute('aria-label',periods[key]+(value?' earnings '+money(value.totalUsd)+(average?', average '+average:'')+'; show breakdown':' earnings awaiting Vast report; show explanation'));
    for(const part of ['compute','bandwidth','storage'])$('#earned-'+key+'-'+part).textContent=money(value?.[part+'Usd']);
  }
  const overdue=report&&now-Date.parse(report.updatedAt)>90*60000;
  $('#freshness').textContent=demo?'Sample data':report?'Earnings checked '+stamp(report.updatedAt):'Waiting for earnings';
  $('.freshness').classList.toggle('live',!!report&&!overdue&&!demo);
  const missingDays=data?.report?.missingDays?.length;
  $('#notice').textContent=demo?'SAMPLE DATA · Illustrative earnings, not actual rental figures.':missingDays?'Chart is waiting for per-device earnings on '+missingDays+' UTC dates.':'';
  if(overdue||data?.collection?.earnings?.failed)$('#freshness').textContent+=' · refresh overdue or failed; saved figures retained';
  chart.update(data?.report?.version===2?data.report:null);
}
async function load(){
  if(demo){data=demoEarnings();render();return;}
  try{data=await get('/api/earnings');render();}catch{$('#notice').textContent='Could not reach the earnings cache. Previously loaded figures are retained.';}
}
for(const button of document.querySelectorAll('[data-earnings-help]'))bindPopover(button,()=>earningsHelp(button.dataset.earningsHelp));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
load();setInterval(()=>{if(!document.hidden)load();},60000);
