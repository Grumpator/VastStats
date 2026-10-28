const ORIGINS=new Set(['https://telemetry.vast.ai','https://candidate-telemetry.vast.ai','https://alpha-telemetry.vast.ai']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export class HistoryApi {
  constructor(key,{fetchImpl=fetch,pause=sleep}={}){if(!key)throw Error('VAST_API_KEY is required');this.key=key;this.fetch=fetchImpl;this.pause=pause;}
  async request(url,token,body){
    for(let attempt=0;attempt<4;attempt++){
      let response;
      try{response=await this.fetch(url,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});}catch{throw Error('Vast connection failed');}
      if(response.ok){try{return await response.json();}catch{throw Error('Invalid Vast JSON response');}}
      if([429,502,503,504].includes(response.status)&&attempt<3){
        const header=response.headers.get('retry-after');
        const delay=header===null?2000*2**attempt:Number.isFinite(Number(header))?Number(header)*1000:Date.parse(header)-Date.now();
        if(Number.isFinite(delay)&&delay<=30000){await response.body?.cancel();await this.pause(Math.max(1000,delay));continue;}
      }
      throw Error('Vast request failed (HTTP '+response.status+')');
    }
  }
  machines(){return this.request('https://console.vast.ai/api/v0/machines/?owner=me&include_offline=1',this.key);}
  async connect(){
    const auth=await this.request('https://cloud.vast.ai/api/v0/telemetry/token/',this.key);
    let url;try{url=new URL(auth.telemetry_url||'https://telemetry.vast.ai');}catch{throw Error('Invalid telemetry origin');}
    if(!ORIGINS.has(url.origin)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Untrusted telemetry origin');
    if(typeof auth.token!=='string'||!auth.token)throw Error('Missing telemetry token');
    this.origin=url.origin;this.token=auth.token;
    const result=await this.request(this.origin+'/api/v1/archives',this.token);
    const entities=result.archives?.find(a=>a.type==='machine')?.entities;
    if(!Array.isArray(entities)||entities.some(e=>typeof e!=='string'))throw Error('Invalid machine archive list');
    this.entities=new Set(entities);
  }
  route(id){if(!this.entities?.has(String(id)))throw Error('Machine archive unavailable');return this.origin+'/api/v1/archives/machine/'+encodeURIComponent(id);}
  meta(id){return this.request(this.route(id)+'/meta',this.token);}
  query(id,start,stop,sections){return this.request(this.route(id)+'/query',this.token,{start,stop,sections});}
}
