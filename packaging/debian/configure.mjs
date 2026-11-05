import {readFile,writeFile,mkdir,rename,rm,lstat,chmod} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export async function configureFile(file,key){
  if(key&&!/^[A-Za-z0-9._~+/=-]+$/.test(key))throw Error('API key contains unsupported whitespace or characters');
  let text=null;
  try{if(!(await lstat(file)).isFile())throw Error('Configuration must be a regular file');text=await readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(text!==null&&!key){await chmod(file,0o600);return !!parseEnv(text).VAST_API_KEY;}
  if(text===null)text='# VastStats configuration; preserved on upgrades.\nHOST=0.0.0.0\nPORT=3000\nDATA_DIR=/var/lib/vaststats/data\n';
  if(key){
    let replaced=false;
    text=text.replace(/^[ \t]*(?:export\s+)?VAST_API_KEY\s*=.*$/gm,()=>{if(replaced)return '';replaced=true;return 'VAST_API_KEY='+JSON.stringify(key);});
    if(!replaced)text+=(text.endsWith('\n')?'':'\n')+'VAST_API_KEY='+JSON.stringify(key)+'\n';
  }else text+='VAST_API_KEY=\n';
  await mkdir(path.dirname(file),{recursive:true});
  const temp=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,text,{mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}
  return !!parseEnv(text).VAST_API_KEY;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
    const configured=await configureFile('/etc/vaststats/vaststats.env',Buffer.concat(chunks).toString('utf8'));
    console.log(configured?'VastStats configuration saved.':'VastStats installed without collection credentials. Run sudo dpkg-reconfigure vaststats to configure the key.');
  }catch{console.error('VastStats configuration failed; existing configuration was retained.');process.exitCode=1;}
}
