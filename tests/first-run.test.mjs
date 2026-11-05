import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRuntime} from '../server/runtime.mjs';
import {readConfig} from '../server/config.mjs';
import {DataStore,atomicJson} from '../server/store.mjs';
import {createServer} from '../server/app.mjs';
import {statusSource} from '../public/status-data.js';

test('only the API key is required; host, port and storage have optional defaults',()=>{
  const config=readConfig({VAST_API_KEY:'private-test-key'});
  assert.equal(config.key,'private-test-key');assert.equal(config.host,'0.0.0.0');assert.equal(config.port,3000);assert.equal(config.dataDir,path.resolve('var/data'));
  assert.equal('identitySeed' in config,false);
  assert.equal(readConfig({HOST:'127.0.0.1',PORT:'8080'}).host,'127.0.0.1');
});

test('fresh startup ignores bundled data, creates its own identity and serves an empty UI without credentials',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-empty-'));let runtime,server;
  try{
    const dataDir=path.join(root,'new-data'),foreign=path.join(root,'foreign');
    await atomicJson(path.join(foreign,'index.json'),{version:2,boxes:[{name:'Do not import this fleet'}]});
    runtime=await createRuntime({config:readConfig({DATA_DIR:dataDir}),seed:foreign}); // Unknown options cannot enable seed import.
    assert.deepEqual((await runtime.store.index()).boxes,[]);assert.equal(runtime.store.status,null);
    const identity=JSON.parse(await readFile(path.join(dataDir,'identity.json'),'utf8'));assert.match(identity.secret,/^[a-f0-9]{64}$/);
    server=await createServer({runtime,publicDir:path.resolve('public')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const source=statusSource({fetchImpl:url=>fetch(base+url)}),status=await source();
    assert.deepEqual(status.boxes,[]);assert.equal(status.updatedAt,null);assert.equal(status.collection.configured,false);
    const history=await (await fetch(base+'/api/history?from=2026-10-01&to=2026-11-01')).json();assert.deepEqual(history.boxes,[]);
    assert.equal((await fetch(base+'/identity.json')).status,404);
    await runtime.close();runtime=null;
    const restarted=await new DataStore(dataDir).open();assert.equal(restarted.identitySeed,identity.secret);await restarted.close();
  }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await runtime?.close();await rm(root,{recursive:true,force:true});}
});

test('first collection discovers hostnames and backfills API history across months without any old files or map',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vaststats-first-import-'));
  const now=Date.parse('2026-11-01T01:00:00Z'),first=Date.parse('2026-10-31T23:30:00Z')/1000;
  let runtime,machineCalls=0,queries=0;
  const apiFactory=()=>({
    machines:async()=>{machineCalls++;return {machines:[{id:123456789,hostname:'fresh-hostname',timeout:0,listed:true,num_gpus:2,current_rentals_running:1,current_rentals_resident:2,machine_maintenance:[],alloc_disk_space:80,api_key:'PRIVATE',public_ipaddr:'PRIVATE_IP'}]};},
    connect:async()=>{},meta:async()=>({extent:{t0:first}}),
    query:async(id,start,stop,sections)=>{
      queries++;const t=[];for(let at=start;at<stop;at+=32)t.push(at);
      return {sections:{metric:{raw:false,step:32,t,channels:{cpu:{avg:t.map(()=>1)}}},...(sections.conts?{conts:{active:[{id:987654321,first_seen:first,last_seen:now/1000,end_witnessed:true,runs:[{start:first,end:now/1000}]}]}}:{})}};
    }
  });
  try{
    const config=readConfig({VAST_API_KEY:'new-key',DATA_DIR:root});
    runtime=await createRuntime({config,now:()=>now,apiFactory});assert.equal((await runtime.store.index()).boxes.length,0);
    await runtime.start();assert.equal(runtime.statusJob.state.failed,false);assert.equal(runtime.historyJob.state.failed,false);assert.equal(machineCalls,1);assert.ok(queries>=3);
    const index=await runtime.store.index(),box=index.boxes[0];assert.equal(box.name,'fresh-hostname');assert.deepEqual(box.months,['2026-10','2026-11']);assert.equal(box.historyStart,new Date(first*1000).toISOString());
    const history=await runtime.store.history('2026-10-31','2026-11-01');
    assert.equal(history.boxes[0].hours.reduce((sum,row)=>sum+row.observedSeconds,0),5400);
    assert.equal(history.boxes[0].hours.reduce((sum,row)=>sum+row.occupiedSeconds,0),5400);
    assert.deepEqual(history.boxes[0].hours.map(row=>row.runningSessions),[1,1]);
    const serialized=JSON.stringify(history);for(const value of ['PRIVATE','PRIVATE_IP','123456789','987654321',runtime.store.identitySeed])assert.equal(serialized.includes(value),false);
    const identity=runtime.store.identitySeed,generation=runtime.store.generation;await runtime.close();runtime=null;
    runtime=await createRuntime({config:{...config,key:'rotated-key'},now:()=>now,apiFactory});
    assert.equal(runtime.store.identitySeed,identity);assert.equal(runtime.store.generation,generation);assert.equal((await runtime.store.index()).boxes[0].deviceKey,box.deviceKey);
    // A brand-new install gets a different anonymous identity without requiring configuration.
    const separate=await new DataStore(path.join(root,'second-install')).open();assert.notEqual(separate.identitySeed,identity);await separate.close();
  }finally{await runtime?.close();await rm(root,{recursive:true,force:true});}
});
