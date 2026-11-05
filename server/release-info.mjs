import {readFile} from 'node:fs/promises';
import path from 'node:path';
export async function releaseInfo(project){
  const version=JSON.parse(await readFile(path.join(project,'package.json'),'utf8')).version;
  let release=null;
  try{
    const value=JSON.parse(await readFile(path.join(project,'release.json'),'utf8'));
    if(!/^[a-f0-9]{40}$/.test(value.commit??'')||value.tag!=='v'+version)throw Error('Invalid deployment identity');
    release={tag:value.tag,commit:value.commit};
  }catch(e){if(e.code!=='ENOENT')throw e;}
  return {version,release};
}
