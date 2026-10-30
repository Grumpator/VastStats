import {createHmac} from 'node:crypto';

export const validStorageKey=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9 _-]{0,63}$/.test(value);
export function identityNamespace(seed){
  if(typeof seed!=='string'||seed.length<16)throw Error('A stable private device identity seed is required');
  return createHmac('sha256',seed).update('VastStats identity namespace').digest('hex').slice(0,32);
}

// Only the chosen display name and keyed anonymous identity leave the collector.
// The secret seed is independent of the API credential, so key rotation is safe.
export function discoverMachines(raw,{seed,legacyMap={},previous=[]}={}){
  identityNamespace(seed);
  const rows=Array.isArray(raw)?raw:raw?.machines;
  if(!Array.isArray(rows))throw Error('Unexpected machine response');
  const seen=new Set();
  const devices=rows.map(row=>{
    const id=String(row?.id);
    if(!/^\d+$/.test(id)||seen.has(id))throw Error('Invalid or duplicate machine identity');
    seen.add(id);
    const deviceKey='device-'+createHmac('sha256',seed).update('VastStats machine\0'+id).digest('hex').slice(0,32);
    const old=previous.find(b=>b.deviceKey===deviceKey)||previous.find(b=>!b.deviceKey&&legacyMap[id]===b.name);
    const storageKey=old?.storageKey??old?.name??deviceKey;
    if(!validStorageKey(storageKey))throw Error('Invalid device storage key');
    const hostname=typeof row.hostname==='string'?row.hostname.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim().slice(0,96):'';
    return {id,deviceKey,storageKey,name:hostname||'Unnamed-'+deviceKey.slice(-8),previous:old??null};
  });
  const counts=new Map();
  for(const d of devices){const key=d.name.toLowerCase();counts.set(key,(counts.get(key)||0)+1);}
  for(const d of devices)if(counts.get(d.name.toLowerCase())>1)d.name+=' ['+d.deviceKey.slice(-8)+']';
  const used=new Set();
  for(const d of [...devices].sort((a,b)=>a.deviceKey.localeCompare(b.deviceKey))){
    if(used.has(d.name.toLowerCase()))d.name+=' ['+d.deviceKey.slice(-16)+']';
    used.add(d.name.toLowerCase());
  }
  // Sorting by the stable identity makes API response ordering irrelevant.
  return devices.sort((a,b)=>a.deviceKey.localeCompare(b.deviceKey));
}
