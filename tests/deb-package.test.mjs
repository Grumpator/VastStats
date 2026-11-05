import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildDeb} from '../scripts/deb/build.mjs';
import {configureFile} from '../packaging/debian/configure.mjs';
const exec=promisify(execFile);
test('Debian package is readable by independent archive tools, declares Node dependency and separates code/config/data',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'vaststats-deb-'));
  try{
    const result=await buildDeb({outputDir:temp,commit:'a'.repeat(40),epoch:1234567890}),bytes=await readFile(result.file);
    assert.equal(bytes.subarray(0,8).toString(),'!<arch>\n');
    const members=(await exec(process.platform==='win32'?'tar':'ar',process.platform==='win32'?['-tf',result.file]:['t',result.file])).stdout.trim().split(/\r?\n/);assert.deepEqual(members,['debian-binary','control.tar.gz','data.tar.gz']);
    for(const name of ['control.tar.gz','data.tar.gz']){
      const content=(await exec(process.platform==='win32'?'tar':'ar',process.platform==='win32'?['-xOf',result.file,name]:['p',result.file,name],{encoding:'buffer',maxBuffer:8*1024*1024})).stdout;await writeFile(path.join(temp,name),content);
    }
    const control=(await exec('tar',['-xOf',path.join(temp,'control.tar.gz'),'control'])).stdout;
    assert.match(control,/^Package: vaststats$/m);assert.match(control,/^Architecture: all$/m);assert.ok(control.includes('nodejs (>= 24)'));assert.ok(control.includes('debconf'));
    const scripts=(await exec('tar',['-tvf',path.join(temp,'control.tar.gz')])).stdout;assert.match(scripts,/-rwxr-xr-x[^\n]+postinst/);
    const files=(await exec('tar',['-tf',path.join(temp,'data.tar.gz')])).stdout.trim().split(/\r?\n/);
    assert.ok(files.includes('usr/lib/vaststats/server.mjs'));assert.ok(files.includes('usr/lib/systemd/system/vaststats.service'));
    assert.equal(files.some(file=>file.startsWith('var/')||file.startsWith('etc/')||file.includes('identity.json')||file.endsWith('/.env')),false);
    const manifest=(await exec('tar',['-xOf',path.join(temp,'data.tar.gz'),'usr/lib/vaststats/release.json'])).stdout;assert.equal(JSON.parse(manifest).commit,'a'.repeat(40));
    const again=await buildDeb({outputDir:temp,commit:'a'.repeat(40),epoch:1234567890});assert.equal(again.digest,result.digest);
  }finally{await rm(temp,{recursive:true,force:true});}
});
test('first-time configuration supports an empty unattended install and a later key without exposing it in output',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-deb-config-')),file=path.join(root,'config','vaststats.env');
  try{
    assert.equal(await configureFile(file,''),false);assert.match(await readFile(file,'utf8'),/^DATA_DIR=\/var\/lib\/vaststats\/data$/m);
    assert.equal(await configureFile(file,'test-key'),true);assert.match(await readFile(file,'utf8'),/^VAST_API_KEY="test-key"$/m);
    if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('upgrade retains configuration byte for byte; key rotation preserves administrator settings and data paths',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-deb-upgrade-')),file=path.join(root,'vaststats.env');
  try{
    const original='# custom\nHOST=127.0.0.1\nPORT=4567\nDATA_DIR=/srv/separate-data\nVAST_API_KEY="old-key"\nCUSTOM=value\n';await writeFile(file,original);
    assert.equal(await configureFile(file,''),true);assert.equal(await readFile(file,'utf8'),original);
    await configureFile(file,'new-key');const updated=await readFile(file,'utf8');assert.equal(updated,original.replace('old-key','new-key'));
    await assert.rejects(configureFile(file,'bad\nINJECT=value'));assert.equal(await readFile(file,'utf8'),updated);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('configuration refuses to replace a directory or follow a non-regular configuration path',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-deb-path-'));
  try{await assert.rejects(configureFile(root,'test-key'),/regular file/);assert.ok((await stat(root)).isDirectory());}
  finally{await rm(root,{recursive:true,force:true});}
});
