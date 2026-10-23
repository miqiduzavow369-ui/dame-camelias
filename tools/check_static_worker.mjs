// Run only against a fresh local simulator; no production credentials or writes.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {STATIC_PAGES,PUBLIC_MEDIA_PATHS} from '../src/generated/static_pages.js';
import {mediaType} from './build_static_files.mjs';

const origin='http://127.0.0.1:8790';
const child=spawn('npx',['--yes','wrangler@4.152.0','dev','--local','--port','8790','--ip','127.0.0.1','--log-level','error'],{
 stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}
});
let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{logs=(logs+b).slice(-4000);});
const get=path=>fetch(origin+path,{signal:AbortSignal.timeout(3000),redirect:'manual'});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 let ready=false;
 for(let i=0;i<80;i++){
  if(child.exitCode!==null)throw Error('Local simulator exited: '+logs);
  try{const r=await get('/');if(r.ok&&(await r.text())==='DAME CAMELIAS bot is ready'){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.ok(ready,'Local simulator failed to start: '+logs);
 for(const [path,file] of [['/order','order/index.html'],['/anketa/mini-preview','anketa/mini-preview.html'],['/anketa/ratings','anketa/ratings.html']]){
  const res=await get(path);assert.equal(res.status,200,path);assert.equal(await res.text(),STATIC_PAGES[file]);
 }
 const shell=await get('/admin/preview');assert.equal(shell.status,200);assert.doesNotMatch(await shell.text(),/function renderMenDashboard/);
 const denied=await fetch(origin+'/api/admin/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
 for(const path of ['/admin/preview-v3.html','/media/admin/preview-v3.html','/media/src/index.js','/src/index.js','/src/generated/static_pages.js','/.git/config','/.env','/.github/workflows/deploy-existing-worker.yml'])
  assert.equal((await get(path)).status,404,path);
 for(const path of PUBLIC_MEDIA_PATHS){
  const source=await readFile(new URL('../'+path.slice('/media/'.length),import.meta.url));
  const res=await get(path);assert.equal(res.status,200,path);
  assert.equal(res.headers.get('Content-Type')?.split(';')[0],mediaType(path,source),path);
  assert.equal(digest(Buffer.from(await res.arrayBuffer())),digest(source),path);
 }
 console.log('Local Worker: public pages, protected ADMIN, denied internal paths and '+PUBLIC_MEDIA_PATHS.length+' exact media files verified');
}finally{
 child.kill('SIGTERM');
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);
 if(child.exitCode===null)child.kill('SIGKILL');
}
