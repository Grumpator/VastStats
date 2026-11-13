import http from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {mergeStatus} from '../public/overview-model.js';
import {occupancyPeriods,occupancyResult} from './occupancy.mjs';
import {periods} from '../public/periods.js';
import {reportedDayHours} from '../public/earnings-chart-model.js';
import {deviceKey} from './views.mjs';
import {fleetEarnings} from '../scripts/earnings.mjs';

const emptySuspensions=new Map();
const tokenDigest=token=>createHash('sha256').update(token).digest();

function visibleFleet(boxes,suspended){
  return boxes.filter(box=>!suspended.has(deviceKey(box)));
}

export function dateWindow(url){
  const from=url.searchParams.get('from'),to=url.searchParams.get('to');
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value??'')&&Number.isFinite(Date.parse(value+'T12:00Z'))&&new Date(value+'T12:00Z').toISOString().slice(0,10)===value;
  if(!valid(from)||!valid(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>3660)throw Error('Use valid inclusive from/to dates, at most ten years apart');
  return {from,to};
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
export async function createServer({runtime,publicDir,now=Date.now}){
  // Only top-level application assets are public; data directories and config are not.
  const assets=new Set((await readdir(publicDir,{withFileTypes:true})).filter(f=>f.isFile()&&mime[path.extname(f.name)]).map(f=>f.name));
  let occupancyCache=null;
  const settingsDigest=runtime.settingsToken?tokenDigest('Bearer '+runtime.settingsToken):null;
  async function occupancySummary(){
    const time=now(),key=runtime.store.generation+':'+Math.floor(time/60000);
    if(occupancyCache?.key!==key){
      const pending=runtime.store.occupancy(time);occupancyCache={key,pending};
      pending.catch(()=>{if(occupancyCache?.key===key)occupancyCache=null;});
    }
    return occupancyCache.pending;
  }
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
    const send=(code,value,type='application/json; charset=utf-8')=>{
      const body=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value)),etag='"'+createHash('sha256').update(body).digest('hex').slice(0,24)+'"';
      res.setHeader('Content-Type',type);if(!res.hasHeader('Cache-Control'))res.setHeader('Cache-Control','no-cache');res.setHeader('ETag',etag);
      if(code===200&&req.headers['if-none-match']===etag){res.writeHead(304);res.end();return;}
      res.writeHead(code);res.end(req.method==='HEAD'?undefined:body);
    };
    try{
      const url=new URL(req.url,'http://localhost');
      const all=runtime.store.suspended??emptySuspensions;
      const includeSuspended=url.searchParams.get('includeSuspended')==='1';
      const suspended=includeSuspended?emptySuspensions:all;
      const scopeRevision=all.size?':'+tokenDigest(JSON.stringify([...all.keys()].sort())).toString('hex').slice(0,24)+(includeSuspended?':all':''):'';
      const filter=boxes=>visibleFleet(boxes,suspended);
      const addMissingSuspended=(boxes,index)=>{
        if(!includeSuspended||!all.size)return boxes;
        const missing=new Map(all);
        for(const box of index.boxes)if(missing.has(deviceKey(box)))missing.set(deviceKey(box),box);
        for(const box of boxes)missing.delete(deviceKey(box));
        return [...boxes,...[...missing.values()].map(box=>({...box,lastSample:null,discoveryMissing:true}))];
      };
      const roster=(boxes,index)=>filter(addMissingSuspended(boxes,index)).map(box=>all.has(deviceKey(box))?{...box,suspended:true}:box);
      if(url.pathname==='/api/settings/devices'){
        res.setHeader('Cache-Control','private, no-store');
        if(req.method==='PUT'){
          if(!settingsDigest){send(403,{error:'Set VASTSTATS_SETTINGS_TOKEN to enable edits.'});return;}
          if(!timingSafeEqual(settingsDigest,tokenDigest(req.headers.authorization??''))){send(401,{error:'The settings token is incorrect.'});return;}
          const key=url.searchParams.get('device'),state=url.searchParams.get('suspended');
          if(!key||!['0','1'].includes(state)){send(400,{error:'Select a device and suspension state.'});return;}
          if(!await runtime.store.setSuspended(key,state==='1')){send(404,{error:'Device is no longer available.'});return;}
          send(200,{deviceKey:key,suspended:state==='1'});return;
        }
        if(['GET','HEAD'].includes(req.method)){
          const devices=filter(await runtime.store.settingsDevices()).map(device=>({...device,suspended:all.has(device.deviceKey)}));
          send(200,{devices,editable:!!settingsDigest});return;
        }
      }
      if(!['GET','HEAD'].includes(req.method)){
        res.setHeader('Allow',url.pathname==='/api/settings/devices'?'GET, HEAD, PUT':'GET, HEAD');
        send(405,{error:'Method not allowed'});return;
      }
      if(url.pathname==='/details.html'){res.writeHead(302,{Location:'/occupancy.html'+url.search});res.end();return;}
      if(url.pathname==='/api/market'){
        res.setHeader('Cache-Control','private, no-store');
        const enabled=!!runtime.market;
        send(200,enabled?{enabled,...runtime.market.read(url.searchParams.getAll('watch'),suspended)}:{enabled:false});return;
      }
      if(url.pathname==='/api/devices'){
        res.setHeader('Cache-Control','private, no-store');
        const snapshot=runtime.store.status??await runtime.store.index();
        const stats=await occupancySummary();
        const privateRates=!!runtime.deviceRates;
        const rates=privateRates?runtime.deviceRates(snapshot.updatedAt):null;
        const report=privateRates?runtime.store.earningsReport:null;
        const reportedHours=report?.daily?.reduce((hours,row)=>hours+reportedDayHours(row.day,report.updatedAt),0)??0;
        const billedWork=reportedHours>0?runtime.store.workedInBillingReport(report):null;
        const history=new Map(stats.index.boxes.map(box=>[box.deviceKey??box.storageKey??box.name,box]));
        const boxes=roster(snapshot.boxes,stats.index).map(box=>{
          const key=box.deviceKey??box.storageKey??box.name;
          const windows=stats.windows.get(key),metadata=history.get(key),allTime=stats.devices.get(key);
          let workedSeconds=billedWork?.get(key)??null;
          if(!billedWork&&allTime?.observedSeconds>0)workedSeconds=allTime.occupiedSeconds;
          const earnedUsd=reportedHours>0?report?.machineTotals?.[key]??null:null;
          return {name:box.name,deviceKey:key,lastSample:box.lastSample,workedSeconds,suspended:box.suspended,
            dataThrough:metadata?.dataThrough,historyStart:metadata?.historyStart,historyError:metadata?.historyError,
            discoveryMissing:box.discoveryMissing??metadata?.discoveryMissing,lastSeenAt:box.lastSeenAt??metadata?.lastSeenAt,
            occupancy:Object.fromEntries([...occupancyPeriods.map(({key})=>[key,windows?.[key]?occupancyResult(windows[key]):null]),
              ['all',allTime??null]]),
            ...(privateRates?{rates:rates?.get(key)??null,earnedUsd,averageUsdPerHour:earnedUsd===null?null:earnedUsd/reportedHours}:{})};
        });
        const earningsWindow=reportedHours>0?{from:report.daily[0].day,to:report.daily.at(-1).day,hours:reportedHours}:null;
        send(200,{boxes,privateRates,earningsWindow,updatedAt:snapshot.updatedAt,historyUpdatedAt:stats.index.updatedAt,snapshotMaxAgeSeconds:snapshot.snapshotMaxAgeSeconds??900});return;
      }
      if(url.pathname==='/api/earnings'){
        const status=runtime.store.status,saved=runtime.store.earningsReport;
        const {machineTotals,...report}=saved??{};
        const boxes=filter(status?.boxes??[]);
        const currentDevices=boxes.map(({deviceKey,name,lastSample})=>({deviceKey,name,gpuModel:lastSample?.gpuModel??null,rate:lastSample?.earnings??null}));
        const scoped=saved?.version===2&&suspended.size?await runtime.scopedEarnings({...report,machines:filter(report.machines??[])},suspended):report;
        const accountReport=saved&&suspended.size?{...report,machines:undefined}:null;
        send(200,{version:1,report:saved?{...scoped,scopeRevision}:null,accountReport,currentRate:status?.earnings??null,currentDevices,statusUpdatedAt:status?.updatedAt??null,collection:runtime.health()});return;
      }
      if(url.pathname==='/api/earnings/series'){
        const keys=url.searchParams.has('series')?url.searchParams.getAll('series'):(url.searchParams.get('machines')||'').split(',').filter(Boolean);
        try{send(200,await runtime.machineEarnings(keys,{from:url.searchParams.get('from'),to:url.searchParams.get('to')},url.searchParams.get('group')||'machine',suspended));}catch{send(400,{error:'Select up to eight known series and a valid date range'});}return;
      }
      if(url.pathname==='/healthz'){
        const health=runtime.health(),index=await runtime.store.index();health.history.updatedAt=index.updatedAt??null;send(200,health);return;
      }
      if(url.pathname==='/api/status'||url.pathname==='/api/overview'){
        const status=runtime.store.status,index=await runtime.store.index();
        // Now has its own collection clock; history imports must not replace it.
        const source=status??{...index,version:1,source:'telemetry'};
        const boxes=filter(source.boxes);
        const snapshot={...source,boxes,earnings:suspended.size&&status?fleetEarnings(boxes):source.earnings};
        if(url.pathname==='/api/status'){
          const report=runtime.store.earningsReport;
          const earnedToday=report?.version===2?report.periods.today:null;
          send(200,{...snapshot,earnings:source.earnings,earnedToday,earningsUpdatedAt:report?.updatedAt??null,historyRevision:runtime.store.revision()+scopeRevision,collection:runtime.health()});return;
        }
        const stats=await occupancySummary(),totals={};
        for(const period of occupancyPeriods){
          const fleet={occupied:0,observed:0,elapsed:0};
          // Match Details, including historical devices no longer in the latest snapshot.
          for(const [key,windows] of stats.windows){if(suspended.has(key))continue;const value=windows[period.key];if(value)for(const field of ['occupied','observed','elapsed'])fleet[field]+=value[field];}
          totals[period.key]=occupancyResult(fleet);
        }
        const metadata=new Map(stats.index.boxes.map(box=>[box.deviceKey??box.storageKey??box.name,box]));
        send(200,{...snapshot,historyUpdatedAt:stats.index.updatedAt??null,occupancy:totals,boxes:roster(source.boxes,stats.index).map(box=>{
          const key=box.deviceKey??box.storageKey??box.name;
          return {...metadata.get(key),...box,totalOccupancy:stats.devices.get(key)??null};
        }),collection:runtime.health()});return;
      }
      if(url.pathname==='/api/details'){
        const period=url.searchParams.get('period'),at=url.searchParams.get('at');
        const reference=at===null?now():Number(at);
        if(!periods.some(p=>p.key===period)||!Number.isFinite(reference)||reference<Date.UTC(1970,0,1)||reference>Date.UTC(9999,11,31)){
          send(400,{error:'Use a valid period and optional Unix-millisecond at timestamp'});return;
        }
        const details=runtime.store.details(period,reference,now());
        send(200,{...details,revision:details.revision+scopeRevision,boxes:roster(details.boxes,details).map(box=>box.summaries?box:{...box,summaries:[]})});return;
      }
      if(url.pathname==='/api/history'){
        let window;try{window=dateWindow(url);}catch(e){send(400,{error:e.message});return;}
        const history=await runtime.store.history(window.from,window.to),status=runtime.store.status;
        const merged=mergeStatus(history,status);
        // A just-discovered device may have been added by mergeStatus during this request.
        for(const b of merged.boxes){b.hours??=[];b.days??=[];b.runCounts??=[];b.snapshots??=[];}
        send(200,{...merged,boxes:filter(merged.boxes),collection:runtime.health()});return;
      }
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!assets.has(name)){send(404,{error:'Not found'});return;}
      send(200,await readFile(path.join(publicDir,name)),mime[path.extname(name)]);
    }catch{send(503,{error:'Cached data is temporarily unavailable'});}
  });
}
