import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {earningsReport,collectHistoricalEarnings,billingWindow,earningsRange} from '../server/earnings.mjs';
import {recordedPeriod,recordedTotal} from '../public/earnings-model.js';
import {HistoryApi} from '../scripts/history-api.mjs';
import {createRuntime} from '../server/runtime.mjs';
import {createServer} from '../server/app.mjs';
import {atomicJson} from '../server/store.mjs';

const now=Date.parse('2026-11-07T12:30Z'),DAY=86400000;
const day=value=>Date.parse(value+'T00:00Z')/DAY;
function raw(){const window=billingWindow(now);return {sday:window.start/DAY,eday:window.end/DAY-1,username:'PRIVATE',email:'PRIVATE',current:{balance:999},taxinfo:'PRIVATE',per_machine:[{machine_id:123}],summary:{total_gpu:32,total_stor:4,total_bwu:4,total_bwd:2},per_day:[{day:day('2026-11-01'),gpu_earn:10,sto_earn:1,bwu_earn:1,bwd_earn:1},{day:day('2026-11-02'),gpu_earn:20,sto_earn:2,bwu_earn:2,bwd_earn:1},{day:day('2026-11-06'),gpu_earn:2,sto_earn:1,bwu_earn:1,bwd_earn:0}]};}

test('daily earnings use UTC calendar periods, include bandwidth and omit PII and distinguish unreported days from zero',()=>{
  const report=earningsReport(raw(),now);
  assert.equal(report.periods.month.totalUsd,42);assert.equal(report.periods.week.totalUsd,29);
  assert.equal(report.periods.today.reported,false);assert.equal(recordedPeriod(report,'today',now),null);
  assert.equal(report.periods.yesterday.totalUsd,4);assert.equal(report.lastReportedDay,'2026-11-06');
  assert.equal(JSON.stringify(report).includes('PRIVATE'),false);assert.equal(JSON.stringify(report).includes('machine_id'),false);assert.equal('current' in report,false);
  const current=raw();current.per_day.push({day:day('2026-11-07'),gpu_earn:0,sto_earn:0,bwu_earn:0,bwd_earn:0});
  assert.equal(recordedPeriod(earningsReport(current,now),'today',now).totalUsd,0);
  assert.equal(recordedPeriod(report,'month',Date.parse('2026-12-01T00:01Z')),null);
});

test('UTC report boundaries include today even during London daylight saving and at month/week changes',()=>{
  const window=billingWindow(Date.parse('2026-06-01T00:30Z'));
  assert.equal(window.starts.today,day('2026-06-01'));assert.equal(window.starts.week,day('2026-06-01'));assert.equal(window.starts.month,day('2026-06-01'));
  assert.equal(window.start,Date.parse('2026-05-31T00:00Z'));assert.equal(window.end,Date.parse('2026-06-02T00:00Z'));
});

test('earnings rejects malformed, mismatched or incomplete reports rather than fabricating partial totals',()=>{
  for(const change of [b=>b.summary.total_gpu=100,b=>b.per_day.push(b.per_day[0]),b=>b.sday--,b=>b.per_day[0].gpu_earn='10',b=>b.per_day[0].sto_earn=NaN,b=>delete b.summary,b=>b.success=false]){
    const body=raw();change(body);assert.throws(()=>earningsReport(body,now));
  }
});

test('one fleet report provides all periods and the API uses the canonical URL without redirects',async()=>{
  let calls=0;const window=earningsRange(now);
  const report=await collectHistoricalEarnings({now,api:{earnings:async(start,end)=>{calls++;assert.equal(start,window.start);assert.equal(end,window.end);return {...raw(),sday:start/DAY,eday:end/DAY-1};}}});
  assert.equal(calls,1);assert.equal(report.periods.week.totalUsd,29);
  const api=new HistoryApi('test',{fetchImpl:async(url,options)=>{
    const u=new URL(url);assert.equal(u.pathname,'/api/v0/users/me/machine-earnings/');assert.equal(Number(u.searchParams.get('sday')),window.start/DAY);assert.equal(Number(u.searchParams.get('eday')),window.end/DAY-1);assert.equal(options.redirect,'error');return new Response('{}');
  }});await api.earnings(window.start,window.end);
});

test('earnings collection runs independently, retains saved reports after failure and survives restart',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-earned-'));let runtime,fail=false,release,entered;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  let machines=0;
  try{
    runtime=await createRuntime({config:{dataDir:root,key:'test',statusInterval:300000,historyInterval:1800000},now:()=>now,
      apiFactory:()=>({machines:async()=>{machines++;return {machines:[]};},earnings:async(start,end)=>{entered();await gate;if(fail)throw Error('PRIVATE');return {...raw(),per_machine:[{machine_id:123,gpu_earn:32,sto_earn:4,bwu_earn:4,bwd_earn:2}],sday:start/DAY,eday:end/DAY-1};}}),
      historyCollector:async({root})=>JSON.parse(await readFile(new URL('index.json',root),'utf8'))});
    const startup=runtime.start();await started;
    await runtime.statusJob.run();assert.equal(machines,2);assert.equal(runtime.earningsJob.state.running,true);
    release();await startup;const saved=runtime.store.earningsReport;assert.equal(saved.periods.week.totalUsd,29);
    assert.deepEqual(saved.machineTotals,{[saved.machines[0].deviceKey]:42});
    fail=true;await runtime.earningsJob.run();assert.equal(runtime.store.earningsReport,saved);assert.equal(runtime.health().earnings.failed,true);assert.equal(runtime.health().status.failed,false);assert.equal(JSON.stringify(runtime.health()).includes('PRIVATE'),false);
    await runtime.close();runtime=null;
    runtime=await createRuntime({config:{dataDir:root,key:null,statusInterval:300000,historyInterval:1800000},now:()=>now});assert.equal(runtime.store.earningsReport.periods.week.totalUsd,29);
  }finally{release();await runtime?.close();await rm(root,{recursive:true,force:true});}
});

test('earnings API reads only saved totals and renamed page redirects preserve query parameters',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-pages-'));let runtime,server;
  try{
    runtime=await createRuntime({config:{dataDir:root,key:null,statusInterval:300000,historyInterval:1800000}});
    await runtime.store.publishEarnings(earningsReport(raw(),now));
    server=await createServer({runtime,publicDir:path.resolve('public')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
    const body=await (await fetch(base+'/api/earnings')).json();assert.equal(body.report.periods.month.totalUsd,42);assert.equal(body.currentRate,null);assert.equal(JSON.stringify(body).includes('PRIVATE'),false);
    const old=await fetch(base+'/details.html?period=week&device=example',{redirect:'manual'});assert.equal(old.status,302);assert.equal(old.headers.get('location'),'/occupancy.html?period=week&device=example');
    for(const name of ['occupancy','earnings','market','settings'])assert.equal((await fetch(base+'/'+name+'.html')).status,200);
  }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await runtime?.close();await rm(root,{recursive:true,force:true});}
});

test('suspension uses cached per-device earnings and waits for missing billing days',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-scoped-earnings-'));
  let runtime,server;
  try{
    const active='device-'+'a'.repeat(32),suspended='device-'+'b'.repeat(32);
    runtime=await createRuntime({config:{dataDir:root,key:null},now:()=>now});
    const report=earningsReport(raw(),now);
    await runtime.store.publishEarnings({...report,machines:[{deviceKey:active,name:'Active'},{deviceKey:suspended,name:'Suspended'}]});
    runtime.store.suspended=new Map([[suspended,{deviceKey:suspended,name:'Suspended'}]]);
    for(const {day} of report.daily.slice(1))await atomicJson(path.join(root,'earnings-series','day-'+day+'.json'),{
      version:3,day,updatedAt:report.updatedAt,reported:true,byDevice:{
        [active]:{day,computeUsd:1,storageUsd:1,bandwidthUsd:0,totalUsd:2},
        [suspended]:{day,computeUsd:6,storageUsd:3,bandwidthUsd:1,totalUsd:10}
      }
    });
    server=await createServer({runtime,publicDir:path.resolve('public'),now:()=>now});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port+'/api/earnings';
    const {report:scoped,accountReport}=await (await fetch(base)).json();
    assert.equal(recordedTotal(accountReport).totalUsd,42);
    assert.equal(recordedPeriod(accountReport,'week',now).totalUsd,29);
    assert.equal(accountReport.machines,undefined);
    assert.deepEqual(scoped.machines.map(device=>device.deviceKey),[active]);
    assert.deepEqual(scoped.daily.map(row=>row.totalUsd),[2,2]);
    assert.deepEqual(scoped.missingDays,['2026-11-01']);
    assert.equal(recordedPeriod(scoped,'week',now).totalUsd,4);
    assert.equal(recordedPeriod(scoped,'month',now),null);
    assert.equal(recordedTotal(scoped),null);
    const full=(await (await fetch(base+'?includeSuspended=1')).json()).report;
    assert.equal(full.machines.length,2);
    assert.equal(recordedTotal(full).totalUsd,42);
  }finally{
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await runtime?.close();
    await rm(root,{recursive:true,force:true});
  }
});
