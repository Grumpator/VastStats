import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {appendFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const exec=promisify(execFile);
export async function resolveRelease({tag,cwd=process.cwd()}={}){
  if(typeof tag!=='string'||!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))throw Error('Use a stable release tag such as v1.0.0');
  const git=async args=>(await exec('git',args,{cwd})).stdout.trim();
  const commit=await git(['rev-parse','HEAD']),manifest=JSON.parse(await git(['show',commit+':package.json']));
  if(tag!=='v'+manifest.version)throw Error('Release tag must match package.json');
  if(await git(['rev-parse','refs/tags/'+tag+'^{commit}'])!==commit)throw Error('Checkout does not match the release tag');
  await git(['merge-base','--is-ancestor',commit,'refs/remotes/origin/main']);
  return {tag,commit,version:manifest.version};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const result=await resolveRelease({tag:process.argv[2]});
    if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,Object.entries(result).map(([key,value])=>key+'='+value).join('\n')+'\n');
    console.log('Validated '+result.tag+' at '+result.commit);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
