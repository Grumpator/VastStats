import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {HistoryApi} from './history-api.mjs';
import {contractEarnings,fleetEarnings} from './earnings.mjs';
import {sanitizeMachines} from './collect.mjs';
import {identityNamespace,discoverMachines} from './history-discovery.mjs';

async function read(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function collectStatus({api,root,now=Date.now(),identitySeed}={}){
  if(!root)throw Error('A runtime storage directory is required');
  api??=new HistoryApi(process.env.VAST_API_KEY);
  const namespace=identityNamespace(identitySeed);
  const index=await read(new URL('index.json',root),{boxes:[]}),previous=await read(new URL('status.json',root),{boxes:[]});
  for(const source of [index,previous])if(source.identityNamespace&&source.identityNamespace!==namespace)throw Error('Device identity seed changed');
  const raw=await api.machines(); // One fleet request, followed by sequential read-only contract requests.
  const known=[...previous.boxes,...index.boxes.filter(b=>!previous.boxes.some(p=>p.deviceKey===b.deviceKey))];
  const devices=discoverMachines(raw,{seed:identitySeed,previous:known});
  const samples=sanitizeMachines(raw,Object.fromEntries(devices.map(d=>[d.id,d.name])),now),stamp=new Date(now).toISOString();
  const boxes=[];
  for(const device of devices){
    const {name,deviceKey,storageKey,previous:old}=device;
    const sample=samples.find(s=>s.name===name);
    let earnings=null;
    try{earnings=sample.connection==='offline'?{computeUsdPerHour:0,storageUsdPerHour:0,totalUsdPerHour:0}:sample.connection==='online'?contractEarnings(await api.contracts(device.id),{includeGpuCount:true}):null;}catch{/* Rate failure must not discard a successful machine-state check. */}
    const {name:unused,...fields}=sample;
    boxes.push({name,deviceKey,storageKey,firstSeenAt:old?.firstSeenAt??old?.historyStart??stamp,lastSample:{at:stamp,...fields,gpuModel:device.gpuModel,earnings}});
  }
  const result={version:1,source:'machines',identityNamespace:namespace,updatedAt:stamp,snapshotMaxAgeSeconds:900,refreshIntervalSeconds:300,earnings:fleetEarnings(boxes),boxes};
  await mkdir(root,{recursive:true});
  const file=new URL('status.json',root),temp=new URL('status.json.tmp',root);
  await writeFile(temp,JSON.stringify(result)+'\n');await rename(temp,file);
  console.log('Saved current status for '+boxes.length+' devices.');return result;
}
