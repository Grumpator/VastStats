import path from 'node:path';

export function readConfig(env=process.env){
  const integer=(name,fallback,min,max)=>{const n=env[name]===undefined?fallback:Number(env[name]);if(!Number.isInteger(n)||n<min||n>max)throw Error('Invalid '+name);return n;};
  return {host:env.HOST||'0.0.0.0',port:integer('PORT',3000,0,65535),dataDir:path.resolve(env.DATA_DIR||'var/data'),key:env.VAST_API_KEY||null,statusInterval:300000,historyInterval:1800000};
}
