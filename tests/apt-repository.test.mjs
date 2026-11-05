import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {tar,ar} from '../scripts/deb/build.mjs';
import {readDebControl} from '../scripts/deb/read-control.mjs';
import {buildRepository} from '../scripts/apt/build.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const deb=(version='1.0.0',name='vaststats')=>ar([{name:'debian-binary',content:'2.0\n'},{name:'control.tar.gz',content:gzipSync(tar([{name:'control',content:`Package: ${name}\nVersion: ${version}\nArchitecture: all\nDepends: nodejs (>= 24)\nDescription: Test package\n Test continuation\n` }]))},{name:'data.tar.gz',content:gzipSync(tar([]))}]);
test('APT repository indexes packages, declares dependency, and hashes immutable by-hash indexes',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'vaststats-apt-')),file=path.join(temp,'package.deb'),output=path.join(temp,'repo');
  try{
    await writeFile(file,deb());const result=await buildRepository({packages:[file],output,sign:false,now:new Date('2026-11-05T12:00Z')});assert.equal(result.versions,1);
    const index=await readFile(path.join(output,'dists/stable/main/binary-amd64/Packages'),'utf8');
    assert.match(index,/Filename: pool\/main\/v\/vaststats\/vaststats_1.0.0_all.deb/);assert.match(index,/Depends: nodejs \(>= 24\)/);assert.match(index,/Description: Test package\n Test continuation/);
    assert.ok(index.includes('SHA256: '+sha(await readFile(file))));
    for(const item of result.indexes){
      const bytes=await readFile(path.join(output,'dists/stable',item.relative));assert.equal(sha(bytes),item.digest);assert.equal(bytes.length,item.size);
      assert.deepEqual(await readFile(path.join(output,'dists/stable',path.dirname(item.relative),'by-hash/SHA256',item.digest)),bytes);
    }
    assert.equal(gunzipSync(await readFile(path.join(output,'dists/stable/main/binary-amd64/Packages.gz'))).toString(),index);
    const release=await readFile(path.join(output,'dists/stable/Release'),'utf8');assert.match(release,/Acquire-By-Hash: yes/);assert.match(release,/Architectures: amd64 arm64/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
test('new versions retain old packages and old index hashes; an existing version cannot silently change',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'vaststats-apt-upgrade-')),file=path.join(temp,'package.deb'),output=path.join(temp,'repo');
  try{
    await writeFile(file,deb());const first=await buildRepository({packages:[file],output,sign:false});
    await writeFile(file,deb('1.1.0'));const next=await buildRepository({packages:[file],output,sign:false});assert.equal(next.versions,2);
    for(const item of first.indexes)assert.ok((await readFile(path.join(output,'dists/stable',path.dirname(item.relative),'by-hash/SHA256',item.digest))).length);
    const changed=deb();changed[changed.length-2]^=1;await writeFile(file,changed);
    await assert.rejects(buildRepository({packages:[file],output,sign:false}),/different package bytes/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
test('APT refuses unknown packages and malformed control archives, and signing requires an explicit fingerprint',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'vaststats-apt-invalid-')),file=path.join(temp,'package.deb');
  try{
    await writeFile(file,deb('1.0.0','other'));await assert.rejects(buildRepository({packages:[file],output:path.join(temp,'repo'),sign:false}),/Unexpected package/);
    await writeFile(file,'not a package');await assert.rejects(readDebControl(file),/Invalid Debian archive/);
    await assert.rejects(buildRepository({packages:[],output:path.join(temp,'repo')}),/fingerprint/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
