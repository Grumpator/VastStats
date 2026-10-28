// Read-only investigation. Never log tokens, machine/instance IDs or raw API responses.
const key=process.env.VAST_API_KEY;
if(!key)throw Error('VAST_API_KEY is required');
const map=JSON.parse(process.env.VAST_BOX_MAP||'{}');
const days=Math.min(366,Math.max(1,Number(process.env.HISTORY_DAYS)||7));
let phase='token';
const fields=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).filter(k=>/^[a-z_]+$/i.test(k)):[];
async function request(url,token,body){
  let response;
  for(let attempt=0;attempt<3;attempt++){
    response=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
    if(response.status!==429||attempt===2)break;
    const header=response.headers.get('retry-after');
    const delay=header===null?2000*2**attempt:Number.isFinite(Number(header))?Number(header)*1000:Date.parse(header)-Date.now();
    if(!Number.isFinite(delay)||delay>60000)break;
    await response.arrayBuffer();
    console.log(JSON.stringify({phase,status:'rate-limited',retryAfterSeconds:Math.max(1,Math.ceil(delay/1000))}));
    await new Promise(resolve=>setTimeout(resolve,Math.max(1000,delay)));
  }
  if(!response.ok){
    let reason;
    try{
      const error=await response.json();
      const message=error.error_code??error.error??error.msg??error.detail;
      if(typeof message==='string'){
        reason=message.split(key).join('[credential]').replace(/\b[A-Za-z0-9_-]{32,}\b/g,'[redacted]').replace(/\b\d{4,}\b/g,'[number]').slice(0,240);
        for(const id of Object.keys(map))reason=reason.split(id).join('[machine]');
      }
    }catch{}
    console.log(JSON.stringify({phase,httpStatus:response.status,reason}));throw Error('Request failed');
  }
  return response.json();
}
try{
  phase='machine-key-check';
  const current=await request('https://console.vast.ai/api/v0/machines/?owner=me&include_offline=1',key);
  console.log(JSON.stringify({phase,status:'success',machineCount:current.machines?.length}));
  phase='token';
  const auth=await request('https://cloud.vast.ai/api/v0/telemetry/token/',key);
  console.log(JSON.stringify({phase,status:'success',fields:fields(auth)}));
  const base=auth.telemetry_url||'https://telemetry.vast.ai';
  if(!['https://telemetry.vast.ai','https://candidate-telemetry.vast.ai','https://alpha-telemetry.vast.ai'].includes(base.replace(/\/$/,'')))throw Error('Unexpected telemetry origin');
  phase='archives';
  const archives=await request(base+'/api/v1/archives',auth.token);
  const archive=archives.archives?.find(a=>a.type==='machine');
  const entities=archive?.entities||[];
  console.log(JSON.stringify({phase,fields:fields(archives),entityCount:entities.length,entityType:typeof entities[0],entityFields:fields(entities[0])}));
  for(const [id,name] of Object.entries(map)){
    if(process.env.HISTORY_BOX&&process.env.HISTORY_BOX!==name)continue;
    const entity=entities.find(e=>String(typeof e==='object'?(e.id??e.entity):e)===id);
    if(entity===undefined){console.log(JSON.stringify({box:name,archiveFound:false}));continue;}
    const entityId=typeof entity==='object'?(entity.id??entity.entity):entity;
    phase='metadata';
    const meta=await request(base+'/api/v1/archives/machine/'+encodeURIComponent(entityId)+'/meta',auth.token);
    const timestamp=value=>Number.isFinite(value)&&value>0&&value<1e11?new Date(value*1000).toISOString():null;
    const currentBox=current.machines?.find(m=>String(m.id)===id);
    console.log(JSON.stringify({box:name,phase,fields:fields(meta),extentFields:fields(meta.extent),availableFrom:timestamp(meta.extent?.t0),availableTo:timestamp(meta.extent?.end),manifestFields:fields(meta.manifest),currentRunning:currentBox?.current_rentals_running,currentStored:currentBox?.current_rentals_resident}));
    if(process.env.HISTORY_META_ONLY==='1')continue;
    phase='container-history';
    const stop=Math.floor(Date.now()/1000),start=stop-days*86400;
    const result=await request(base+'/api/v1/archives/machine/'+encodeURIComponent(entityId)+'/query',auth.token,{start,stop,sections:{conts:{},...(process.env.HISTORY_COVERAGE==='1'?{metric:{points:Number(process.env.HISTORY_POINTS)||400}}:{})}});
    if(process.env.HISTORY_COVERAGE==='1'){
      const metric=result.sections?.metric,channels=Object.values(metric?.channels||{}),channel=channels[0];
      const delta=metric?.t?.slice(1).map((t,i)=>t-metric.t[i]).filter(n=>n>0).sort((a,b)=>a-b)||[];
      console.log(JSON.stringify({box:name,phase:'coverage-shape',metricFields:fields(metric),step:metric?.step,raw:metric?.raw,level:result.level,minLeafLevel:meta.manifest?.min_leaf_level,metricManifest:meta.manifest?.metric,pointCount:metric?.t?.length,channelFields:fields(channel),view:metric?.view??result.view,firstPoint:metric?.t?.[0],lastPoint:metric?.t?.at(-1),medianDelta:delta[Math.floor(delta.length/2)],minDelta:delta[0],maxDelta:delta.at(-1),sampleCounts:channel?.n?{min:Math.min(...channel.n),max:Math.max(...channel.n)}:null,nonNullAverageCount:channel?.avg?.filter(n=>n!==null).length}));
    }
    const conts=result.sections?.conts,active=conts?.active;
    const rows=Array.isArray(active)?active:[];
    const runs=rows.flatMap(r=>r.runs||[]),latestSeen=rows.reduce((n,r)=>Math.max(n,r.last_seen||0),0);
    const intervals=runs.filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>r.start).map(r=>[Math.max(start,r.start),Math.min(stop,r.end)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
    let unionSeconds=0,lastEnd=-Infinity;
    for(const [a,b] of intervals){unionSeconds+=Math.max(0,b-Math.max(a,lastEnd));lastEnd=Math.max(lastEnd,b);}
    console.log(JSON.stringify({box:name,phase,requestedDays:days,resultFields:fields(result),sectionFields:fields(result.sections),containerSectionFields:fields(conts),containerCount:rows.length,containerFields:fields(rows[0]),runFields:fields(runs[0]),approximateContainers:rows.filter(r=>r.approx).length,fragmentedRuns:runs.filter(r=>r.fragmented).length,runCount:runs.length,reportedRunningSeconds:rows.reduce((n,r)=>n+(r.running_s||0),0),unionRunningHours:Math.round(unionSeconds/36)/100,lastContainerObservation:timestamp(latestSeen),latestContainerLagHours:latestSeen?Math.round((stop-latestSeen)/36)/100:null,nonpositiveContainerIds:rows.filter(r=>Number(r.id)<=0).length,queryLevel:result.level}));
  }
}catch{
  console.error('History inspection failed at '+phase+'. No raw response was logged.');
  process.exitCode=1;
}
