import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {discoverMachines} from '../scripts/history-discovery.mjs';
import {collectHistory} from '../scripts/collect-history.mjs';
import {loadHistoryData} from '../public/history-data.js';

const seed='private-test-identity-seed';
test('discovery uses hostnames, stable private identities and anonymous missing/duplicate names',()=>{
 const rows=[{id:123,hostname:'spark-gamma',api_key:'secret',public_ipaddr:'192.0.2.1'},{id:456,hostname:'same'},{id:789,hostname:'same'},{id:987,hostname:null}];
 const result=discoverMachines({machines:rows},{seed});
 assert.deepEqual(result,discoverMachines({machines:[...rows].reverse()},{seed}));
 assert.equal(new Set(result.map(d=>d.name.toLowerCase())).size,4);
 assert.equal(result.find(d=>d.id==='123').name,'spark-gamma');
 assert.match(result.find(d=>d.id==='987').name,/^Unnamed-[a-f0-9]{8}$/);
 assert.match(result.find(d=>d.id==='456').name,/^same \[[a-f0-9]{8}\]$/);
 assert.ok(result.every(d=>/^device-[a-f0-9]{32}$/.test(d.deviceKey)));
 assert.equal(result.find(d=>d.id==='123').deviceKey,discoverMachines([{id:123,hostname:'renamed'}],{seed})[0].deviceKey);
 assert.throws(()=>discoverMachines(rows,{seed:'short'}));
 assert.throws(()=>discoverMachines([{id:123},{id:123}],{seed}));
 assert.throws(()=>discoverMachines({error:'bad shape'},{seed}));
 assert.throws(()=>discoverMachines([{id:'../../private'}],{seed}));
});

test('names may contain dots or markup but never determine file paths',()=>{
 const [box]=discoverMachines([{id:123,hostname:'  ../spark.<b>box</b>\n  '}],{seed});
 assert.equal(box.name,'../spark.<b>box</b>');assert.match(box.storageKey,/^device-[a-f0-9]{32}$/);
 assert.throws(()=>discoverMachines([{id:123,hostname:'x'}],{seed,previous:[{name:'../private'}],legacyMap:{123:'../private'}}));
});

test('automatic collection migrates old history, discovers additions, survives renames and retains missing machines',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'vaststats-discovery-')),root=pathToFileURL(folder+'/');
 const now=Date.parse('2026-10-02T12:00Z'),first=Date.parse('2026-10-01T00:00Z')/1000;
 let machines=[{id:123,hostname:'spark-alpha'}],fail=false;
 const api={machines:async()=>({machines:machines.map(m=>({...m,num_gpus:2,timeout:0,current_rentals_running:1,current_rentals_resident:1,api_key:'private-api-key',public_ipaddr:'192.0.2.1'}))}),connect:async()=>{},meta:async()=>{if(fail)throw Error('private raw response');return {extent:{t0:first}};},query:async(id,start,stop,sections)=>({sections:{metric:{raw:false,step:15,t:[start],channels:{cpu:{avg:[1]}}},...(sections.conts?{conts:{active:[]}}:{})}})};
 try{
  // First create v3 history using the old private map.
  const legacy=await collectHistory({api,root,now,mapping:{123:'Alpha'}});
  const oldFile=new URL('Alpha/2026-10.json',root),oldHours=JSON.parse(await readFile(oldFile,'utf8')).hours;
  const opts={api,root,now,identitySeed:seed,legacyMapping:{123:'Alpha'}};
  const migrated=await collectHistory(opts),alpha=migrated.boxes[0];
  assert.equal(alpha.name,'spark-alpha');assert.equal(alpha.storageKey,'Alpha');assert.deepEqual(alpha.months,legacy.boxes[0].months);
  assert.deepEqual(JSON.parse(await readFile(oldFile,'utf8')).hours,oldHours);
  // Include a finalized month to ensure rename updates every cached file, not just recent data.
  await writeFile(new URL('Alpha/2026-09.json',root),JSON.stringify({...JSON.parse(await readFile(oldFile,'utf8')),name:'spark-alpha',month:'2026-09'}));
  alpha.months.unshift('2026-09');await writeFile(new URL('index.json',root),JSON.stringify(migrated));
  machines=[{id:123,hostname:'renamed.example'},{id:456,hostname:'spark-new'}];fail=true;
  const renamed=await collectHistory(opts).catch(async e=>{if(e.message!=='No box history could be refreshed')throw e;return JSON.parse(await readFile(new URL('index.json',root),'utf8'));});
  const again=renamed.boxes.find(b=>b.deviceKey===alpha.deviceKey);
  assert.equal(again.name,'renamed.example');assert.equal(again.storageKey,'Alpha');assert.equal(again.historyError,true);
  assert.deepEqual(JSON.parse(await readFile(oldFile,'utf8')).hours,oldHours);
  assert.equal(JSON.parse(await readFile(new URL('Alpha/2026-09.json',root),'utf8')).name,'renamed.example');
  assert.equal(renamed.boxes.length,2);assert.match(renamed.boxes.find(b=>b.name==='spark-new').storageKey,/^device-/);
  fail=false;const refreshed=await collectHistory(opts);
  machines=[{id:456,hostname:'spark-new'}];const missing=await collectHistory(opts),retained=missing.boxes.find(b=>b.deviceKey===alpha.deviceKey);
  assert.equal(retained.discoveryMissing,true);assert.equal(retained.lastSample,null);assert.deepEqual(retained.months,again.months);
  machines=[{id:123,hostname:'renamed.example'},{id:456,hostname:'spark-new'}];const returned=await collectHistory(opts);
  assert.equal(returned.boxes.find(b=>b.deviceKey===alpha.deviceKey).discoveryMissing,undefined);
  const serialized=JSON.stringify(returned);
  for(const value of ['private-api-key','192.0.2.1',seed,'private raw response','"id":'])assert.equal(serialized.includes(value),false);
  const fetchImpl=async url=>new Response(await readFile(new URL(new URL(url).pathname.slice(1),root),'utf8'));
  const loaded=await loadHistoryData('https://test.invalid/',['2026-09-15','2026-10-02'],{fetchImpl});
  assert.equal(loaded.boxes.find(b=>b.name==='renamed.example').hours.length>0,true);
  await assert.rejects(collectHistory({...opts,identitySeed:'a-different-private-seed'}),/Device identity seed changed/);
  assert.equal(JSON.parse(await readFile(new URL('index.json',root),'utf8')).identityNamespace,refreshed.identityNamespace);
  machines=[];const empty=await collectHistory(opts);assert.equal(empty.boxes.length,2);assert.ok(empty.boxes.every(b=>b.discoveryMissing));
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('frontend rejects path traversal in a discovery index',async()=>{
 const fetchImpl=async()=>new Response(JSON.stringify({version:2,boxes:[{name:'spark.example',storageKey:'../private',months:[]}]}));
 await assert.rejects(loadHistoryData('https://test.invalid/',['2026-10-01'],{fetchImpl}),/Invalid public history index/);
});
