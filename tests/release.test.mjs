import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveRelease} from '../scripts/release/resolve.mjs';
import {releaseInfo} from '../server/release-info.mjs';
const exec=promisify(execFile);
test('a release resolves only a matching stable tag whose exact commit belongs to main',async()=>{
  const cwd=await mkdtemp(path.join(tmpdir(),'vaststats-release-')),git=args=>exec('git',args,{cwd});
  try{
    await writeFile(path.join(cwd,'package.json'),JSON.stringify({version:'1.0.0'}));await git(['init','-q']);await git(['add','.']);
    await git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','initial commit']);
    await git(['tag','v1.0.0']);await git(['update-ref','refs/remotes/origin/main','HEAD']);
    const result=await resolveRelease({tag:'v1.0.0',cwd});assert.match(result.commit,/^[a-f0-9]{40}$/);assert.equal(result.version,'1.0.0');
    for(const tag of ['v1','v1.0.0-beta','v01.0.0','v1.1.0'])await assert.rejects(resolveRelease({tag,cwd}));
    await writeFile(path.join(cwd,'package.json'),JSON.stringify({version:'1.1.0'}));await git(['add','.']);await git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','not main']);await git(['tag','v1.1.0']);
    await assert.rejects(resolveRelease({tag:'v1.1.0',cwd}));
  }finally{await rm(cwd,{recursive:true,force:true});}
});
test('deployment identity is optional locally and validates the package version and full commit',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-release-info-'));
  try{
    await writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.0.0'}));assert.deepEqual(await releaseInfo(root),{version:'1.0.0',release:null});
    const release={tag:'v1.0.0',commit:'a'.repeat(40)};await writeFile(path.join(root,'release.json'),JSON.stringify({...release,digest:'not-for-health'}));
    assert.deepEqual(await releaseInfo(root),{version:'1.0.0',release});
    await writeFile(path.join(root,'release.json'),JSON.stringify({...release,tag:'v1.1.0'}));await assert.rejects(releaseInfo(root),/Invalid deployment identity/);
  }finally{await rm(root,{recursive:true,force:true});}
});
