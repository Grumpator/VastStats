// Read-only investigation. Never log tokens, machine/instance IDs or raw API responses.
const key=process.env.VAST_API_KEY;
if(!key)throw Error('VAST_API_KEY is required');
const map=JSON.parse(process.env.VAST_BOX_MAP||'{}');
let phase='token';
const fields=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).filter(k=>/^[a-z_]+$/i.test(k)):[];
async function request(url,token,body){
  const response=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
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
    const entity=entities.find(e=>String(typeof e==='object'?(e.id??e.entity):e)===id);
    if(entity===undefined){console.log(JSON.stringify({box:name,archiveFound:false}));continue;}
    const entityId=typeof entity==='object'?(entity.id??entity.entity):entity;
    phase='metadata';
    const meta=await request(base+'/api/v1/archives/machine/'+encodeURIComponent(entityId)+'/meta',auth.token);
    console.log(JSON.stringify({box:name,phase,fields:fields(meta)}));
    phase='container-history';
    const stop=Math.floor(Date.now()/1000),start=stop-7*86400;
    const result=await request(base+'/api/v1/archives/machine/'+encodeURIComponent(entityId)+'/query',auth.token,{start,stop,sections:{conts:{}}});
    const conts=result.sections?.conts,active=conts?.active;
    const rows=Array.isArray(active)?active:[];
    console.log(JSON.stringify({box:name,phase,requestedDays:7,resultFields:fields(result),sectionFields:fields(result.sections),containerSectionFields:fields(conts),containerCount:rows.length,containerFields:fields(rows[0]),runFields:fields(rows[0]?.runs?.[0]),approximateContainers:rows.filter(r=>r.approx).length,fragmentedRuns:rows.flatMap(r=>r.runs||[]).filter(r=>r.fragmented).length,runCount:rows.reduce((n,r)=>n+(r.runs?.length||0),0),reportedRunningSeconds:rows.reduce((n,r)=>n+(r.running_s||0),0)}));
  }
}catch{
  console.error('History inspection failed at '+phase+'. No raw response was logged.');
  process.exitCode=1;
}
