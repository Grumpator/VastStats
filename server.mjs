import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseInfo} from './server/release-info.mjs';
import {readConfig} from './server/config.mjs';
import {createRuntime} from './server/runtime.mjs';
import {createServer} from './server/app.mjs';

const project=path.dirname(fileURLToPath(import.meta.url));
let runtime,server,closing=false;
async function shutdown(){
  if(closing)return;closing=true;
  // Let bounded upstream work settle before releasing the data-directory lock.
  if(server)await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});
  await runtime?.close();
}
try{
  const config=readConfig(),publicDir=path.join(project,'public'),relative=path.relative(publicDir,config.dataDir);
  if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('DATA_DIR must be outside public/');
  runtime=await createRuntime({config:{...config,...await releaseInfo(project)}});
  server=await createServer({runtime,publicDir});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});
  console.log('VastStats: http://'+config.host+':'+server.address().port);
  console.log(config.key?'Collection enabled: Now every 5 minutes; history every 30 minutes.':'Cache-only mode: set local credentials to enable collection.');
  runtime.start();
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{shutdown().catch(()=>{process.exitCode=1;});});
}catch{console.error('VastStats could not start. Check configuration, DATA_DIR permissions/integrity and port availability.');await shutdown();process.exitCode=1;}
