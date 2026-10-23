import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import worker from '../src/index.js';
import {STATIC_PAGES,PUBLIC_MEDIA_PATHS} from '../src/generated/static_pages.js';
import {PUBLIC_MEDIA_BASE,readPublicMedia} from '../src/static_media.js';
import {staticInputs,HTML_FILES,mediaType} from '../tools/build_static_files.mjs';

const TOKEN='synthetic-static-bot';
function signed(id,age=0){
 const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)-age),user:JSON.stringify({id})});
 const message=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
 const key=createHmac('sha256','WebAppData').update(TOKEN).digest();
 p.set('hash',createHmac('sha256',key).update(message).digest('hex'));return p.toString();
}
const request=(path,options={})=>new Request('https://bot.test'+path,options);
test('four packaged HTML pages match source and manifest contains only valid decorative media',async()=>{
 const input=await staticInputs();
 assert.deepEqual(Object.keys(STATIC_PAGES),HTML_FILES);
 assert.deepEqual(input.pages,STATIC_PAGES);
 assert.equal(await readFile('src/generated/static_pages.js','utf8'),input.module,'Run node tools/build_static_files.mjs after editing HTML/manifest');
 assert.deepEqual(input.media.map(m=>'/media/'+m.path),PUBLIC_MEDIA_PATHS);
 for(const path of PUBLIC_MEDIA_PATHS)assert.match(path,/^\/media\/(?:assets|anketa)\//);
 assert.ok(input.media.length>=150);
 for(const path of PUBLIC_MEDIA_PATHS)assert.doesNotMatch(path,/\.html|src\/|\.env|\.git|\.json|\.js$|\.py$|\.md$/);
 assert.throws(()=>mediaType('secret.png',Buffer.from('<svg>not a PNG</svg>')));
});
test('public pages work with all external fetch blocked, without touching live storage',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Public GitHub and all network unavailable');};
 const env=new Proxy({}, {get(){throw Error('Public HTML must not touch storage/secrets');}});
 try{
  for(const [path,file]of [['/order','order/index.html'],['/anketa/mini-preview','anketa/mini-preview.html'],['/anketa/ratings','anketa/ratings.html']]){
   const res=await worker.fetch(request(path),env,{});assert.equal(res.status,200);
   assert.equal(await res.text(),STATIC_PAGES[file]);assert.match(res.headers.get('Content-Type'),/text\/html/);
  }
 }finally{globalThis.fetch=old;}
});
test('ADMIN HTML remains behind signed fresh owner identity and is never a public asset',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No external HTML allowed');};
 try{
  const env={BOT_TOKEN:TOKEN};
  for(const initData of ['',signed(920000001),signed(5866034656,1000)]){
   const res=await worker.fetch(request('/api/admin/preview',{method:'POST',body:JSON.stringify({initData})}),env,{});
   assert.equal(res.status,403);
  }
  const res=await worker.fetch(request('/api/admin/preview',{method:'POST',body:JSON.stringify({initData:signed(5866034656)})}),env,{});
  assert.equal(res.status,200);assert.equal(res.headers.get('Cache-Control'),'no-store');
  assert.equal(await res.text(),STATIC_PAGES['admin/preview-v3.html']);
  assert.doesNotMatch(await (await worker.fetch(request('/admin/preview'),{},{})).text(),/function renderMenDashboard/);
  for(const path of ['/admin/preview-v3.html','/media/admin/preview-v3.html','/media/src/index.js','/src/generated/static_pages.js','/.env','/.git/config','/.github/workflows/deploy-existing-worker.yml'])
   assert.equal((await worker.fetch(request(path),env,{})).status,404,path);
 }finally{globalThis.fetch=old;}
});
test('media reads stay on the local binding, with only reviewed paths and GET/HEAD',async()=>{
 const calls=[],png=await readFile('assets/balance_cards/balance_03.png');
 const env={ASSETS:{fetch:async req=>{calls.push({url:req.url,method:req.method,headers:[...req.headers]});return new Response(req.method==='HEAD'?null:png,{headers:{'Content-Type':'image/png'}});}}};
 const url=PUBLIC_MEDIA_BASE+'assets/balance_cards/balance_03.png';
 assert.deepEqual(new Uint8Array(await (await readPublicMedia(env,url)).arrayBuffer()),new Uint8Array(png));
 assert.equal((await readPublicMedia(env,url,{method:'HEAD'})).status,200);
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.url==='https://assets.local/media/assets/balance_cards/balance_03.png'&&c.headers.length===0));
 for(const value of [url+'?token=secret',url+'#fragment',url.replace('dame-camelias.gptjjjgpt.workers.dev','evil.test'),PUBLIC_MEDIA_BASE+'src/index.js'])
  assert.equal((await readPublicMedia(env,value)).status,404);
 assert.equal((await readPublicMedia(env,url,{method:'POST'})).status,405);assert.equal(calls.length,2);
 assert.equal((await readPublicMedia({},url)).status,503);
});
test('webhook still requires the existing secret and never treats non-media POST as static',async()=>{
 const env={BOT_TOKEN:TOKEN,WEBHOOK_SECRET:'synthetic-webhook'};
 assert.equal((await worker.fetch(request('/webhook',{method:'POST',body:'{}'}),env,{})).status,403);
 assert.equal((await worker.fetch(request('/media/assets/balance_cards/balance_03.png',{method:'POST'}),env,{})).status,405);
});
test('production transport has no raw GitHub dependency and HTML only changed media origins',async()=>{
 for(const file of ['src/index.js','src/owner_anketa.js','src/trial_cabinet.js',...HTML_FILES])
  assert.doesNotMatch(await readFile(file,'utf8'),/raw\.githubusercontent\.com/);
 // Every own media URL embedded in HTML points at a file from the reviewed manifest.
 for(const html of Object.values(STATIC_PAGES))for(const m of html.matchAll(/\/media\/(?:assets|anketa)\/[A-Za-z0-9_/-]+\.(?:webp|jpg|png|mp4)/g))
  assert.ok(PUBLIC_MEDIA_PATHS.includes(m[0]),m[0]);
});
