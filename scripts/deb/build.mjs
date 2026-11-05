import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const octal=(value,length)=>value.toString(8).padStart(length-1,'0')+'\0';
export function tar(entries,epoch=0){
  const output=[];
  for(const entry of entries){
    const content=Buffer.from(entry.content??''),header=Buffer.alloc(512),name=entry.name;
    if(Buffer.byteLength(name)>100||name.startsWith('/')||name.split('/').includes('..'))throw Error('Unsupported package archive path');
    header.write(name,0,100);header.write(octal(entry.mode??0o644,8),100);header.write(octal(0,8),108);header.write(octal(0,8),116);
    header.write(octal(content.length,12),124);header.write(octal(epoch,12),136);header.fill(32,148,156);header.write(entry.directory?'5':'0',156);
    header.write('ustar\0',257);header.write('00',263);header.write('root',265);header.write('root',297);
    const sum=header.reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
    output.push(header,content,Buffer.alloc((512-content.length%512)%512));
  }
  return Buffer.concat([...output,Buffer.alloc(1024)]);
}
export function ar(members,epoch=0){
  const output=[Buffer.from('!<arch>\n')];
  for(const {name,content} of members){
    const body=Buffer.from(content),header=(name+'/').padEnd(16)+String(epoch).padEnd(12)+'0'.padEnd(6)+'0'.padEnd(6)+'100644'.padEnd(8)+String(body.length).padEnd(10)+'`\n';
    if(Buffer.byteLength(header)!==60)throw Error('Invalid Debian archive header');
    output.push(Buffer.from(header),body);if(body.length%2)output.push(Buffer.from('\n'));
  }
  return Buffer.concat(output);
}
async function sourceFiles(root){
  const names=['package.json','server.mjs'];
  for(const folder of ['public','server','scripts'])for(const file of await readdir(path.join(root,folder),{withFileTypes:true})){
    if(file.isFile()&&(folder==='public'?/\.(js|html|css|svg|ico)$/:/\.mjs$/).test(file.name)&&!file.name.startsWith('.'))names.push(folder+'/'+file.name);
    else if(file.isSymbolicLink())throw Error('Application symlinks are not packaged');
  }
  return names.sort();
}
export async function buildDeb({root=path.resolve(fileURLToPath(new URL('../../',import.meta.url))),outputDir=path.join(root,'dist'),commit=null,epoch=0}={}){
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')),version=pkg.version;
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Expected a stable package version');
  if(commit&&!/^[a-f0-9]{40}$/.test(commit))throw Error('Expected full release commit');
  if(!Number.isSafeInteger(epoch)||epoch<0)throw Error('Invalid build timestamp');
  const data=[];
  for(const name of await sourceFiles(root))data.push({name:'usr/lib/vaststats/'+name,content:await readFile(path.join(root,name))});
  data.push({name:'usr/lib/vaststats/packaging/configure.mjs',content:await readFile(path.join(root,'packaging/debian/configure.mjs'))});
  data.push({name:'usr/lib/systemd/system/vaststats.service',content:await readFile(path.join(root,'packaging/debian/vaststats.service'))});
  data.push({name:'usr/share/doc/vaststats/config/vast-api-permissions.json',content:await readFile(path.join(root,'config/vast-api-permissions.json'))});
  data.push({name:'usr/share/doc/vaststats/README.md',content:await readFile(path.join(root,'README.md'))});
  for(const name of ['releasing.md','screenshots/overview.jpg','screenshots/details.jpg'])data.push({name:'usr/share/doc/vaststats/docs/'+name,content:await readFile(path.join(root,'docs',name))});
  if(commit)data.push({name:'usr/lib/vaststats/release.json',content:JSON.stringify({tag:'v'+version,commit})+'\n'});
  const directories=new Set();for(const file of data){let directory=path.posix.dirname(file.name);while(directory!=='.'){directories.add(directory+'/');directory=path.posix.dirname(directory);}}
  const payload=[...directories].sort().map(name=>({name,directory:true,mode:0o755}));payload.push(...data.sort((a,b)=>a.name.localeCompare(b.name)));
  const control=`Package: vaststats\nVersion: ${version}\nArchitecture: all\nSection: utils\nPriority: optional\nMaintainer: VastStats maintainers <Grumpator@users.noreply.github.com>\nDepends: nodejs (>= 24), debconf (>= 0.5) | debconf-2.0, adduser, init-system-helpers (>= 1.54), systemd\nInstalled-Size: ${Math.ceil(data.reduce((sum,file)=>sum+Buffer.byteLength(file.content),0)/1024)}\nHomepage: https://github.com/Grumpator/VastStats\nDescription: Vast.ai fleet occupancy dashboard\n Runs a local Node.js dashboard and periodic read-only telemetry collectors.\n Configuration and persistent history are retained during upgrades.\n`;
  const controls=[{name:'control',content:control},{name:'md5sums',content:data.map(file=>createHash('md5').update(file.content).digest('hex')+'  '+file.name).join('\n')+'\n'}];
  for(const name of ['config','postinst','prerm','postrm','templates'])controls.push({name,mode:name==='templates'?0o644:0o755,content:(await readFile(path.join(root,'packaging/debian',name),'utf8')).replaceAll('\r\n','\n')});
  const artifact=ar([{name:'debian-binary',content:'2.0\n'},{name:'control.tar.gz',content:gzipSync(tar(controls,epoch))},{name:'data.tar.gz',content:gzipSync(tar(payload,epoch))}],epoch);
  await mkdir(outputDir,{recursive:true});const file=path.join(outputDir,`vaststats_${version}_all.deb`);await writeFile(file,artifact);
  const digest=createHash('sha256').update(artifact).digest('hex');await writeFile(file+'.sha256',digest+'  '+path.basename(file)+'\n');
  return {file,version,digest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const result=await buildDeb({commit:process.env.RELEASE_COMMIT||null,epoch:Number(process.env.SOURCE_DATE_EPOCH||0)});console.log('Built '+result.file);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
