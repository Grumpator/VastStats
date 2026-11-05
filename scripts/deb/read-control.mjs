import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
// Packages produced by build.mjs use the Debian 2.0 ar + gzip/ustar format.
export async function readDebControl(file){
  const bytes=await readFile(file);if(bytes.subarray(0,8).toString()!=='!<arch>\n')throw Error('Invalid Debian archive');
  let control=null;
  for(let offset=8;offset<bytes.length;){
    const header=bytes.subarray(offset,offset+60);if(header.length!==60||header.subarray(58).toString()!=='`\n')throw Error('Invalid ar header');
    const name=header.subarray(0,16).toString().trim().replace(/\/$/,''),size=Number(header.subarray(48,58).toString().trim());
    if(!Number.isSafeInteger(size)||size<0||offset+60+size>bytes.length)throw Error('Invalid ar size');
    if(name==='control.tar.gz')control=gunzipSync(bytes.subarray(offset+60,offset+60+size));
    offset+=60+size+size%2;
  }
  if(!control)throw Error('Expected gzip-compressed Debian control archive');
  for(let offset=0;offset+512<=control.length;){
    const header=control.subarray(offset,offset+512);if(header.every(value=>value===0))break;
    const name=header.subarray(0,100).toString().replace(/\0.*$/s,'').replace(/^\.\//,''),size=parseInt(header.subarray(124,136).toString().replace(/\0.*$/s,'').trim(),8);
    if(!Number.isSafeInteger(size)||size<0||offset+512+size>control.length)throw Error('Invalid control tar size');
    if(name==='control'){
      const text=control.subarray(offset+512,offset+512+size).toString('utf8'),fields={};let previous=null;
      for(const line of text.trimEnd().split(/\r?\n/)){
        if(/^[ \t]/.test(line)){if(!previous)throw Error('Invalid control continuation');fields[previous]+='\n'+line;continue;}
        const match=line.match(/^([A-Za-z0-9-]+):[ \t]*(.*)$/);if(!match||fields[match[1]]!==undefined)throw Error('Invalid control field');
        fields[match[1]]=match[2];previous=match[1];
      }
      return {text,fields};
    }
    offset+=512+Math.ceil(size/512)*512;
  }
  throw Error('Package control file is missing');
}
