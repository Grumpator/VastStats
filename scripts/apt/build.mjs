import {mkdir,readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readDebControl} from '../deb/read-control.mjs';
const exec=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildRepository({packages,output,now=new Date(),fingerprint,gpg='gpg',home=process.env.GNUPGHOME,sign=true}={}){
  if(sign&&!/^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(fingerprint??''))throw Error('Set a full APT signing fingerprint');
  const root=path.resolve(output),pool=path.join(root,'pool/main/v/vaststats');
  await mkdir(pool,{recursive:true});
  for(const source of packages){
    const {fields}=await readDebControl(source);
    if(fields.Package!=='vaststats'||fields.Architecture!=='all'||!/^\d+\.\d+\.\d+$/.test(fields.Version))throw Error('Unexpected package name, architecture or version');
    const target=path.join(pool,'vaststats_'+fields.Version+'_all.deb'),bytes=await readFile(source);
    try{if(hash(await readFile(target))!==hash(bytes))throw Error('An existing version has different package bytes');}
    catch(error){if(error.code!=='ENOENT')throw error;await copyFile(source,target);}
  }
  const entries=[];
  for(const name of (await readdir(pool)).filter(name=>name.endsWith('.deb')).sort()){
    const file=path.join(pool,name),bytes=await readFile(file),{fields}=await readDebControl(file);
    if(fields.Package!=='vaststats'||fields.Architecture!=='all'||!/^\d+\.\d+\.\d+$/.test(fields.Version)||name!=='vaststats_'+fields.Version+'_all.deb')throw Error('Invalid package in repository pool');
    const metadata=Object.entries(fields).filter(([field])=>!['Filename','Size','SHA256','SHA512','MD5sum'].includes(field)).map(([field,value])=>field+': '+value).join('\n');
    entries.push(metadata+'\nFilename: pool/main/v/vaststats/'+name+'\nSize: '+bytes.length+'\nSHA256: '+hash(bytes)+'\nSHA512: '+createHash('sha512').update(bytes).digest('hex')+'\n');
  }
  if(!entries.length)throw Error('Repository has no packages');
  const index=Buffer.from(entries.join('\n')+'\n'),indexes=[];
  for(const arch of ['amd64','arm64'])for(const [name,bytes] of [['Packages',index],['Packages.gz',gzipSync(index)]]){
    const relative='main/binary-'+arch+'/'+name,target=path.join(root,'dists/stable',relative),digest=hash(bytes),byHash=path.join(path.dirname(target),'by-hash/SHA256',digest);
    await mkdir(path.dirname(byHash),{recursive:true});await writeFile(target,bytes);await writeFile(byHash,bytes);
    indexes.push({relative,digest,size:bytes.length});
  }
  const release='Origin: VastStats\nLabel: VastStats\nSuite: stable\nCodename: stable\nDate: '+now.toUTCString()+'\nArchitectures: amd64 arm64\nComponents: main\nAcquire-By-Hash: yes\nDescription: VastStats Debian and Ubuntu packages\nSHA256:\n'+indexes.map(item=>' '+item.digest+' '+item.size+' '+item.relative).join('\n')+'\n';
  const releaseFile=path.join(root,'dists/stable/Release');await writeFile(releaseFile,release);await writeFile(path.join(root,'.vaststats-apt'),'VastStats signed APT repository v1\n');
  if(sign){
    const posix=value=>value.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase());
    const invoke=args=>exec(gpg,process.platform==='win32'&&gpg.replaceAll('\\','/').includes('/Git/usr/bin/')?args.map(arg=>path.win32.isAbsolute(arg)?posix(arg):arg):args,{windowsHide:true});
    const oldKey=path.join(root,'vaststats.asc');
    try{
      await readFile(oldKey);
      const shown=await invoke(['--batch',...(home?['--homedir',home]:[]),'--with-colons','--show-keys',oldKey]);
      const previous=shown.stdout.split('\n').find(line=>line.startsWith('fpr:'))?.split(':')[9];
      if(previous?.toUpperCase()!==fingerprint.toUpperCase())throw Error('APT signing key changed; an explicit key-rotation plan is required');
    }catch(error){if(error.code!=='ENOENT')throw error;}
    const common=['--batch','--yes',...(home?['--homedir',home]:[]),'--local-user',fingerprint,'--digest-algo','SHA256'];
    await invoke([...common,'--armor','--detach-sign','--output',releaseFile+'.gpg',releaseFile]);
    await invoke([...common,'--clearsign','--output',path.join(root,'dists/stable/InRelease'),releaseFile]);
    const key=await invoke(['--batch',...(home?['--homedir',home]:[]),'--armor','--export-options','export-minimal','--export',fingerprint]);
    if(!key.stdout.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----'))throw Error('Signing public key export failed');
    await writeFile(path.join(root,'vaststats.asc'),key.stdout);
  }
  return {root,versions:entries.length,indexes};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const folder=path.resolve(process.env.DEB_DIR||'dist'),packages=(await readdir(folder)).filter(name=>name.endsWith('.deb')).map(name=>path.join(folder,name));
    const result=await buildRepository({packages,output:process.env.APT_OUTPUT||'dist/apt',fingerprint:process.env.APT_SIGNING_FINGERPRINT,gpg:process.env.GPG_BINARY||'gpg'});
    console.log('Signed APT repository contains '+result.versions+' version(s).');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
