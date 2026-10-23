import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {handleAdminApi} from '../src/admin_app_api.js';
import {readTelegramAvatar} from '../src/admin_client_avatar.js';
import {OWNER_ID} from '../src/client_registry.js';
const TOKEN='synthetic-avatar-bot';
const PNG=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6uzQAAAAASUVORK5CYII=','base64'));
function signed(actor=OWNER_ID){
 const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(actor)})});
 const data=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update(TOKEN).digest();
 p.set('hash',createHmac('sha256',secret).update(data).digest('hex'));return p.toString();
}
function fixture(uid,{registered=true}={}){
 const calls=[];
 const client={id:uid,active:true,grant:4,revision:1};
 const env={BOT_TOKEN:TOKEN,ORDER_REMINDERS:{idFromName:x=>x,get:name=>({fetch:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({name,body});
  if(name==='client-registry:v1'&&body.action==='get')return Response.json({client:registered?client:null});
  if(name==='client-registry:v1'&&body.action==='list')return Response.json({ok:true,clients:[client]});
  if(name==='publication-credits:'+uid&&body.type==='credits_status')return Response.json({available:4,reserved:0,spent:0});
  throw Error('Unexpected operation '+name+':'+JSON.stringify(body));
 }})}};
 const request=(action='client_avatar',actor=OWNER_ID)=>handleAdminApi(new Request('https://test.invalid/api/admin/app',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:signed(actor),action,userId:uid})}),env);
 return {env,calls,request};
}
test('real avatar stays owner-only, bound to a registered Telegram ID and separate from credits',async()=>{
 const uid='910000001',f=fixture(uid),old=globalThis.fetch,network=[];
 globalThis.fetch=async(url,options)=>{
  network.push({url:String(url),body:options?.body});
  if(String(url).endsWith('/getChat')){assert.equal(JSON.parse(options.body).chat_id,uid);return Response.json({ok:true,result:{id:Number(uid),username:'avatar_user',photo:{small_file_id:'avatar_one'}}});}
  if(String(url).endsWith('/getFile'))return Response.json({ok:true,result:{file_id:'avatar_one',file_path:'photos/file_1.png',file_size:PNG.length}});
  if(String(url).endsWith('/photos/file_1.png'))return new Response(PNG, {headers:{'Content-Type':'image/png'}});
  throw Error('Unexpected outbound request');
 };
 try{
  const list=await f.request('clients'),data=await list.json();
  assert.equal(data.clients[0].username,'avatar_user');assert.equal(data.clients[0].avatarAvailable,true);
  assert.equal(data.clients[0].available,4);assert.equal(network.length,1,'listing never downloads avatars');
  assert.doesNotMatch(JSON.stringify(data),/avatar_one|file_path|synthetic-avatar-bot|api\.telegram/);
  f.calls.length=0;
  const image=await f.request();assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/png');
  assert.equal(image.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()),PNG);
  assert.ok(f.calls.every(x=>x.name==='client-registry:v1'&&x.body.action==='get'));
  const before=network.length;assert.equal((await f.request()).status,200);assert.equal(network.length,before,'bounded memory cache avoids repeated downloads');
  assert.equal((await f.request('client_avatar','910000099')).status,403);assert.equal(network.length,before);
  assert.equal((await fixture('910000002',{registered:false}).request()).status,404);assert.equal(network.length,before);
 }finally{globalThis.fetch=old;}
});
test('missing/private photo and mismatched Telegram identity retain a harmless fallback',async()=>{
 const old=globalThis.fetch;
 try{
  for(const [uid,result]of [['910000003',{id:910000003,username:'no_photo'}],['910000004',{id:910000099,photo:{small_file_id:'wrong_person'}}]]){
   let count=0;globalThis.fetch=async url=>{count++;assert.ok(String(url).endsWith('/getChat'));return Response.json({ok:true,result});};
   assert.equal((await fixture(uid).request()).status,204);assert.equal(count,1);
  }
 }finally{globalThis.fetch=old;}
});
test('avatar download rejects unsafe paths, wrong file IDs, HTML and oversized responses',async()=>{
 const old=globalThis.fetch,env={BOT_TOKEN:TOKEN};
 try{
  for(const [id,file,download]of [
   ['unsafe_path',{file_path:'photos/../../secret.jpg'},PNG],
   ['wrong_file',{file_id:'somebody_else',file_path:'photos/file_2.jpg'},PNG],
   ['html_response',{file_path:'photos/file_3.jpg'},new TextEncoder().encode('<html>not an avatar</html>')],
   ['too_large',{file_path:'photos/file_4.jpg'},new Uint8Array(256*1024+1)]
  ]){
   const calls=[];globalThis.fetch=async url=>{calls.push(String(url));
    return String(url).endsWith('/getFile')?Response.json({ok:true,result:{file_id:id,...file}}):new Response(download);};
   assert.equal((await readTelegramAvatar(env,id)).status,204,id);
   assert.ok(calls.every(u=>u.startsWith('https://api.telegram.org/')));
   if(id==='unsafe_path'||id==='wrong_file')assert.equal(calls.length,1);
  }
  globalThis.fetch=async()=>{throw Error('network unavailable');};
  assert.equal((await readTelegramAvatar(env,'temporary_failure')).status,204);
 }finally{globalThis.fetch=old;}
});
