import {AGREEMENT_SECTIONS,AGREEMENT_VERSION} from "../src/agreement.js";
import {handleModeration,MODERATION_CHAT,MODERATOR_ID} from "../src/review_moderation.js";
import test from "node:test";
import assert from "node:assert/strict";
import {OrderReminder} from "../src/reminders.js";
import {registry,pinRecord} from "../src/client_registry.js";
import {cabinetRPC,cabinetEvent,privateActor,cabinetEndpoint} from "../src/cabinet_runtime.js";
import {createCabinet} from "../src/owner_anketa.js";
import {credits} from "../src/publication_credits.js";
import {claimPublication} from "../src/publication_claim.js";
globalThis.fetch=async()=>new Response("Mock external service unavailable",{status:503});
const owner="5866034656",a="123456789",b="987654321",profile="771053";
function memory(){const map=new Map();return {map,async get(k){return structuredClone(map.get(k));},async list({prefix,limit=1000,startAfter}){return new Map([...map].filter(([key])=>key.startsWith(prefix)&&(!startAfter||key>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit));},async put(k,v){map.set(k,structuredClone(v));},async delete(k){map.delete(k);},async setAlarm(){},async deleteAlarm(){}};}
function setup(){
 const kv=new Map(),objects=new Map();const env={BOT_TOKEN:"test-token",ANKETA_CALLBACK_TOKEN:"callback",VISITORS_KV:{async get(k,format){if(Array.isArray(k))return new Map(k.map(key=>[key,kv.get(key)??null]));const v=kv.get(k)??null;return format==="json"&&v!==null?JSON.parse(v):v;},async list({prefix,cursor,limit=1000}){const keys=[...kv.keys()].filter(k=>k.startsWith(prefix)).sort(),start=Number(cursor||0);return {keys:keys.slice(start,start+limit).map(name=>({name})),list_complete:start+limit>=keys.length,cursor:String(start+limit)};},async put(k,v){kv.set(k,v);},async delete(k){kv.delete(k);}}};
 env.ORDER_REMINDERS={idFromName:n=>n,get:n=>{
  if(!objects.has(n)){
   const storage=memory();let tail=Promise.resolve();
   const ctx={storage,blockConcurrencyWhile(fn){const job=tail.then(fn);tail=job.catch(()=>{});return job;}};
   objects.set(n,{storage,obj:new OrderReminder(ctx,env)});
  }
  return {fetch:(url,options)=>objects.get(n).obj.fetch(new Request(url,options))};
 }};
 const stores=new Map(),sent=[];
 const store=uid=>{if(!stores.has(uid))stores.set(uid,memory());return stores.get(uid);};
 const send=async(e,method,payload)=>{sent.push({method,payload});return {message_id:sent.length};};
 const update=(uid,data)=>typeof data==="string"&&data.startsWith("owner_anketa:")||typeof data==="string"&&data.startsWith("clients:")?{callback_query:{id:"test",from:{id:uid},message:{message_id:44,chat:{id:uid,type:"private"}},data}}:{message:{message_id:77,from:{id:uid},chat:{id:uid,type:"private"},text:data}};
 const run=(uid,data)=>cabinetEvent(store(uid),env,{userId:uid,event:{kind:"update",update:update(uid,data)}},send);
 const create=async(uid,pin="777777",grant=3,signed=true)=>{const result=await registry(env,{action:"create",actorId:owner,userId:uid,credential:await pinRecord(pin),grant,operation:uid.padStart(16,"a")});if(signed){const obj=env.ORDER_REMINDERS.get("agreement:v1:"+uid);const storage=objects.get("agreement:v1:"+uid)?.storage;if(storage&&!await storage.get("accepted"))await storage.put("accepted",{userId:uid,acceptedAt:Date.now(),version:AGREEMENT_VERSION,sections:structuredClone(AGREEMENT_SECTIONS)});}return result;};
 const login=async(uid,pin="777777")=>{await run(uid,"owner_anketa:open");await run(uid,pin);};
 return {env,kv,objects,store,sent,run,create,login,update,send};
}
test("registry creates, hashes, locks concurrent incorrect attempts, resets PIN and revokes sessions",async()=>{
 const s=setup();assert.equal((await s.create(a)).ok,true);
 const records=s.objects.get("client-registry:v1").storage.map;
 assert.ok(!JSON.stringify([...records]).includes("777777"));
 const attempts=await Promise.all(Array.from({length:8},()=>registry(s.env,{action:"login",userId:a,pin:"bad"})));
 assert.equal(attempts.filter(x=>x.ok).length,0);assert.equal(attempts.at(-1).locked,true);
 const credential=await pinRecord("888888");
 assert.equal((await registry(s.env,{action:"pin",actorId:b,userId:a,credential,operation:"bbbbbbbbbbbbbbbb"})).ok,false);
 assert.equal((await registry(s.env,{action:"pin",actorId:owner,userId:a,credential,operation:"bbbbbbbbbbbbbbbb"})).ok,true);
 assert.equal((await registry(s.env,{action:"login",userId:a,pin:"888888"})).ok,true);
});
test("two client cabinets have separate sessions, drafts, balances and message recipients",async()=>{
 const s=setup();await s.create(a);await s.create(b,"777777",8);await s.login(a);await s.login(b);
 assert.equal((await credits(s.env,a,"status")).available,3);assert.equal((await credits(s.env,b,"status")).available,8);
 for(const uid of [a,b]){
  await s.env.VISITORS_KV.put("owner_anketa_saved:"+uid+":"+profile,JSON.stringify({profile:{id:profile,name:"Anna"},host:"b.intimcity.rip"}));
  await s.env.VISITORS_KV.put("owner_anketa_selected_account:"+uid,JSON.stringify({profileId:profile,account:"yan_first",expiresAt:Date.now()+100000}));
  await s.run(uid,"owner_anketa:savedreview:"+profile);
 }
 await Promise.all([s.run(a,"Первый персональный текст настоящего отзыва"),s.run(b,"Второй персональный текст настоящего отзыва")]);
 const draftA=JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);
 const draftB=JSON.parse(s.store(b).map.get("private:owner_anketa_state:"+b).value);
 assert.notEqual(draftA.text,draftB.text);
 assert.equal(s.kv.has("owner_anketa_state:"+owner),false);
 assert.ok(s.sent.filter(x=>x.payload.text?.includes("Первый персональный")).every(x=>x.payload.chat_id===a));
 assert.ok(s.sent.filter(x=>x.payload.text?.includes("Второй персональный")).every(x=>x.payload.chat_id===b));
});
test("admin requires owner private identity and PIN; create is reviewable and idempotent",async()=>{
 const s=setup();await s.create(a);await s.login(a);
 await s.run(a,"clients:add");assert.equal(s.store(a).map.has("admin_pending"),false);
 await s.run(owner,"clients:add");assert.equal(s.store(owner).map.has("admin_pending"),false);
 s.store(owner).map.set("private:owner_cabinet_session:"+owner,{value:JSON.stringify({authorized:true}),expires:0});
 for(const text of ["clients:add",b,"222345","7"])await s.run(owner,text);
 assert.equal((await registry(s.env,{action:"get",userId:b})).client,null);
 assert.ok(!JSON.stringify([...s.store(owner).map]).includes("222345"));
 const confirmation=s.sent.filter(x=>x.payload.reply_markup).at(-1).payload.reply_markup.inline_keyboard[0][0].callback_data;
 await s.run(owner,confirmation);assert.equal((await credits(s.env,b,"status")).available,7);
 await s.run(owner,confirmation);assert.equal((await credits(s.env,b,"status")).available,7);
 const group=s.update(owner,"clients:add");group.callback_query.message.chat={id:-1,type:"group"};assert.equal(privateActor(group),null);
});

test("administrator menu has two actions, requires owner PIN and cancels stale input on return",async()=>{
 const s=setup();await s.create(a);await s.login(a);
 await s.run(a,"clients:menu");
 assert.equal(s.store(a).map.has("admin_navigation"),false);
 await s.run(owner,"clients:menu");
 assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/индивидуальный код/);
 s.store(owner).map.set("private:owner_cabinet_session:"+owner,{value:JSON.stringify({authorized:true}),expires:0});
 await s.run(owner,"clients:menu");
 const menu=s.sent.filter(x=>x.payload.text).at(-1).payload;
 assert.deepEqual(menu.reply_markup.inline_keyboard.flat(),[
  {text:"➕ Добавить ID клиентки",callback_data:"clients:add"},
  {text:"👥 Клиентки",callback_data:"clients:list"},
  {text:"🏠 В начало",callback_data:"owner_anketa:home"}
 ]);
 await s.run(owner,"clients:add");
 assert.equal((await s.store(owner).get("admin_pending")).mode,"id");
 await s.run(owner,"clients:menu");
 assert.equal(await s.store(owner).get("admin_pending"),undefined);
 await s.run(owner,"clients:list");
 assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/КЛИЕНТКИ/);
 await s.run(owner,"clients:add");
 assert.equal((await s.run(owner,"owner_anketa:home")).home,true);
 assert.equal(await s.store(owner).get("admin_pending"),undefined);
 assert.equal(await s.store(owner).get("admin_navigation"),undefined);
});

test("owner personal cabinet no longer exposes client administration buttons",async()=>{
 const s=setup();s.kv.set("owner_cabinet_session:"+owner,JSON.stringify({authorized:true}));
 await s.run(owner,"owner_anketa:open");
 const markup=s.sent.filter(x=>x.payload.reply_markup).at(-1).payload.reply_markup;
 assert.ok(!markup.inline_keyboard.flat().some(x=>x.callback_data?.startsWith("clients:")));
});

test("agreement signed before account creation appears before grant, in admin card and under add profile even at zero balance",async()=>{
 const s=setup();s.env.ORDER_REMINDERS.get("agreement:v1:"+a);
 const signed={userId:a,version:AGREEMENT_VERSION,acceptedAt:Date.parse("2026-10-15T20:00:00Z"),sections:AGREEMENT_SECTIONS};
 await s.objects.get("agreement:v1:"+a).storage.put("accepted",signed);
 s.kv.set("owner_cabinet_session:"+owner,JSON.stringify({authorized:true}));
 await s.run(owner,"clients:add");await s.run(owner,a);
 assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/Соглашение подписано/);
 await s.create(a);await s.login(a);
 const rows=s.sent.filter(x=>x.payload.reply_markup&&x.payload.chat_id===a).at(-1).payload.reply_markup.inline_keyboard;
 const add=rows.findIndex(row=>row.some(x=>x.callback_data==="owner_anketa:new"));
 assert.equal(rows[add+1][0].callback_data,"agreement:signed");
 await s.run(owner,"clients:view:"+a);assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/✅ Соглашение подписано/);
 const {adjustCredits}=await import("../src/publication_credits.js");await adjustCredits(s.env,a,0,3,"ffffffffffffffff",owner);await s.run(a,"owner_anketa:open");
 assert.ok(s.sent.filter(x=>x.payload.reply_markup&&x.payload.chat_id===a).at(-1).payload.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==="agreement:signed"));
 assert.deepEqual(await s.objects.get("agreement:v1:"+a).storage.get("accepted"),signed);
 await s.create(b);s.env.ORDER_REMINDERS.get("agreement:v1:"+b);await s.objects.get("agreement:v1:"+b).storage.put("declinedAt",Date.now());
 await s.login(b);assert.ok(s.sent.filter(x=>x.payload.chat_id===b&&x.payload.reply_markup).at(-1).payload.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==="owner_anketa:new"));
 await s.run(owner,"clients:view:"+b);assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/❌ Отказалась от соглашения/);
 assert.equal((await credits(s.env,b,"status")).available,3);
});

test("public agreement webhook completes before registration and returns to main without creating a client or spending credits",async()=>{
 const {default:worker}=await import("../src/index.js");const s=setup();s.env.WEBHOOK_SECRET="test-webhook";
 const sent=[],original=globalThis.fetch;let nextId=100;
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes("api.telegram.org")){const method=String(url).split("/").at(-1),p=typeof options.body==="string"?JSON.parse(options.body):Object.fromEntries(options.body.entries());sent.push({method,p});return Response.json({ok:true,result:{message_id:p.message_id||++nextId}});}return new Response("missing",{status:404});
 };
 const perform=async(data,messageId)=>{
  const update={callback_query:{id:"agree",from:{id:Number(a)},message:{message_id:messageId,chat:{id:Number(a),type:"private"}},data}},jobs=[];
  await worker.fetch(new Request("https://x/webhook",{method:"POST",headers:{"X-Telegram-Bot-Api-Secret-Token":"test-webhook"},body:JSON.stringify(update)}),s.env,{waitUntil:p=>jobs.push(p)});await Promise.all(jobs);
 };
 try{
  await perform("agreement:start",1);
  for(let i=0;i<6;i++){
   const message=sent.filter(x=>x.p.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith("agreement:")).at(-1);
   const storage=s.objects.get("agreement:v1:"+a).storage;
   await perform(message.p.reply_markup.inline_keyboard[0][0].callback_data,(await storage.get("navigation")).id);
  }
  assert.equal((await s.objects.get("agreement:v1:"+a).storage.get("accepted")).userId,a);
  assert.equal((await registry(s.env,{action:"get",userId:a})).client,null);
  assert.ok(!s.objects.has("publication-credits:"+a));
  const home=sent.filter(x=>x.p.reply_markup?.inline_keyboard?.flat().some(b=>b.callback_data==="agreement:start")).at(-1);assert.ok(home);
  assert.equal(await s.objects.get("agreement:v1:"+a).storage.get("navigation"),undefined);
 }finally{globalThis.fetch=original;}
});

test("only authenticated owner can select a premium waiting hourglass without touching credits",async()=>{
 const s=setup();await s.create(a);await s.login(a);
 const update=uid=>({message:{message_id:7,from:{id:uid},chat:{id:uid,type:"private"},text:"⏳",entities:[{type:"custom_emoji",offset:0,length:1,custom_emoji_id:"1234567890123456789"}]}});
 const run=uid=>cabinetEvent(s.store(uid),s.env,{userId:uid,event:{kind:"update",update:update(uid)}},s.send);
 const initial=await credits(s.env,a,"status");
 await run(a);assert.equal(s.kv.has("cabinet_loading_emoji_v1"),false);
 await run(owner);assert.equal(s.kv.has("cabinet_loading_emoji_v1"),false);
 s.store(owner).map.set("private:owner_cabinet_session:"+owner,{value:JSON.stringify({authorized:true}),expires:0});
 await run(owner);
 assert.deepEqual(JSON.parse(s.kv.get("cabinet_loading_emoji_v1")),{id:"1234567890123456789",alt:"⏳"});
 const p=s.sent.filter(x=>x.payload.entities).at(-1).payload;assert.equal(p.chat_id,owner);assert.match(p.text,/ЧАСЫ ОЖИДАНИЯ ПОДКЛЮЧЕНЫ/);
 assert.equal(p.text.slice(p.entities[0].offset,p.entities[0].offset+p.entities[0].length),"⏳");
 assert.deepEqual(await credits(s.env,a,"status"),initial);
});

test("owner archive groups only this client's dates and accounts, shows first profile card and retained receipts",async()=>{
 const s=setup();await s.create(a,"777777",0);await s.create(b);
 s.kv.set("owner_cabinet_session:"+owner,JSON.stringify({authorized:true}));
 const objectName="cabinet-events:v1:"+a;s.env.ORDER_REMINDERS.get(objectName);
 const target=s.objects.get(objectName).storage;
 const put=async(key,value)=>target.put("private:"+key,{value:JSON.stringify(value),expires:0});
 const base="cabinet_v3:"+a+":";
 for(const [id,kind,at,fileId] of [["111111","rating","2026-10-14T20:59:00Z","old_rating"],[profile,"rating","2026-10-14T21:01:00Z","new_rating"],[profile,"review","2026-10-14T21:02:00Z","new_review"]]){
  await put(base+(kind==="rating"?"owner_anketa_proof_archive_v1:yan_first:":"owner_anketa_review_proof_archive_v1:yan_first:")+id,{account:"yan_first",profileId:id,fileId,savedAt:at});
 }
 await put("owner_anketa_saved:"+a+":111111",{host:"b.intimcity.rip",profile:{id:"111111"}});
 s.kv.set("profile-thumbnails/b.intimcity.rip/111111.card.jpg",new Uint8Array([1,2]));
 s.kv.set("cabinet_v3:"+b+":owner_anketa_proof_archive_v1:yan_first:333333",JSON.stringify({account:"yan_first",profileId:"333333",fileId:"other_client_file",savedAt:"2026-10-16T12:00:00Z"}));
 const original=structuredClone([...target.map]);
 await s.run(owner,"clients:view:"+a);
 const card=s.sent.filter(x=>x.method==="sendPhoto").at(-1).payload;
 assert.equal(card.chat_id,owner);assert.match(card.photo,/\/card\/111111\?/);assert.match(card.caption,/КАРТОЧКА КЛИЕНТКИ/);
 assert.equal(card.reply_markup.inline_keyboard[0][0].callback_data,"clients:pubs:"+a);
 await s.run(owner,"clients:pubs:"+a);
 const dates=s.sent.filter(x=>x.payload.text).at(-1).payload.reply_markup.inline_keyboard.flat();
 assert.deepEqual(dates.filter(x=>x.callback_data.startsWith("clients:pubday:")).map(x=>x.text),["📅 15.10.2026","📅 14.10.2026"]);
 await s.run(owner,"clients:pubday:"+a+":20261015");
 const profiles=s.sent.filter(x=>x.payload.text).at(-1).payload.reply_markup.inline_keyboard.flat();
 assert.deepEqual(profiles.filter(x=>x.callback_data.startsWith("clients:pubprofile:")).map(x=>x.text),["🌹 Анкета №"+profile]);
 await s.run(owner,"clients:pubprofile:"+a+":20261015:"+profile);
 const accounts=s.sent.filter(x=>x.payload.text).at(-1).payload.reply_markup.inline_keyboard.flat();
 assert.deepEqual(accounts.filter(x=>x.callback_data.startsWith("clients:p:")).map(x=>x.text),["👨‍💻 Ян Первый"]);
 const send=async(e,m,p)=>{const result=await s.send(e,m,p);return m==="sendMediaGroup"?[{message_id:8001},{message_id:8002}]:result;};
 const run=data=>cabinetEvent(s.store(owner),s.env,{userId:owner,event:{kind:"update",update:s.update(owner,data)}},send);
 await run("clients:p:"+a+":20261015:"+profile+":yan_first:0");
 const gallery=s.sent.find(x=>x.method==="sendMediaGroup").payload;
 assert.equal(gallery.chat_id,owner);assert.deepEqual(gallery.media.map(x=>x.media),["new_rating","new_review"]);
 assert.ok(!JSON.stringify(gallery).includes("other_client_file"));
 await run("clients:pubday:"+a+":20261015");
 const deleted=s.sent.filter(x=>x.method==="deleteMessage").map(x=>x.payload.message_id);
 assert.ok(deleted.includes(8001)&&deleted.includes(8002));
 assert.deepEqual([...target.map],original);assert.equal((await credits(s.env,a,"status")).spent,0);
});

test("archive access requires owner identity and PIN; empty clients have no preview or date buttons",async()=>{
 const s=setup();await s.create(a);await s.login(a);
 const before=s.sent.length;await s.run(a,"clients:pubs:"+a);assert.equal(s.sent.length,before);
 assert.equal((await cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"admin_archive",actorId:b}},s.send)).status,403);
 await s.run(owner,"clients:pubs:"+a);
 assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/индивидуальный код/);
 s.store(owner).map.set("private:owner_cabinet_session:"+owner,{value:JSON.stringify({authorized:true}),expires:0});
 const start=s.sent.length;await s.run(owner,"clients:view:"+a);
 assert.ok(!s.sent.slice(start).some(x=>x.method==="sendPhoto"));
 await s.run(owner,"clients:pubs:"+a);
 const p=s.sent.filter(x=>x.payload.text).at(-1).payload;
 assert.match(p.text,/публикаций пока нет/);
 assert.ok(!p.reply_markup.inline_keyboard.flat().some(x=>x.callback_data.startsWith("clients:pubday:")));
});

test("archive profiles paginate and receipts stay scoped to date, profile and account",async()=>{
 const s=setup();await s.create(a);s.kv.set("owner_cabinet_session:"+owner,JSON.stringify({authorized:true}));
 for(let i=0;i<13;i++)s.kv.set("cabinet_v3:"+a+":owner_anketa_proof_archive_v1:yan_first:"+(111111+i),JSON.stringify({account:"yan_first",profileId:String(111111+i),fileId:"receipt_"+i,savedAt:"2026-10-15T12:00:00Z"}));
 s.kv.set("cabinet_v3:"+a+":owner_anketa_proof_archive_v1:yan_second:111111",JSON.stringify({account:"yan_second",profileId:"111111",fileId:"second_account",savedAt:"2026-10-15T12:00:00Z"}));
 s.kv.set("cabinet_v3:"+a+":owner_anketa_publication_v1:review:999999",JSON.stringify({status:"published",account:"yan_second",at:"2026-10-16T12:00:00Z"}));
 const latest=()=>s.sent.filter(x=>x.payload.text).at(-1).payload;
 const buttons=()=>latest().reply_markup.inline_keyboard.flat();
 await s.run(owner,"clients:pubday:"+a+":20261015");
 assert.equal(buttons().filter(x=>x.callback_data.startsWith("clients:pubprofile:")).length,12);
 assert.ok(buttons().some(x=>x.callback_data==="clients:pubday:"+a+":20261015:1"));
 await s.run(owner,"clients:pubday:"+a+":20261015:1");
 assert.deepEqual(buttons().filter(x=>x.callback_data.startsWith("clients:pubprofile:")).map(x=>x.text),["🌹 Анкета №111123"]);
 await s.run(owner,"clients:pubprofile:"+a+":20261015:111112");
 assert.deepEqual(buttons().filter(x=>x.callback_data.startsWith("clients:p:")).map(x=>x.text),["👨‍💻 Ян Первый"]);
 assert.ok(buttons().some(x=>x.text==="⬅️ К анкетам"));
 await s.run(owner,"clients:p:"+a+":20261015:111111:yan_first:0");
 assert.equal(s.sent.filter(x=>x.method==="sendPhoto").at(-1).payload.photo,"receipt_0");
 assert.ok(buttons().some(x=>x.text==="⬅️ К аккаунтам"));
 await s.run(owner,"clients:p:"+a+":20261015:111111:yan_second:0");
 assert.equal(s.sent.filter(x=>x.method==="sendPhoto").at(-1).payload.photo,"second_account");
 const before=s.sent.length;await s.run(owner,"clients:p:"+a+":20261016:999999:yan_second:0");
 assert.ok(!s.sent.slice(before).some(x=>["sendPhoto","sendMediaGroup"].includes(x.method)));
 assert.match(latest().text,/Сохранённых скриншотов.*нет/);
 await s.run(owner,"clients:pubacct:"+a+":20261015:yan_first:0");
 assert.match(latest().text,/Выберите анкету/);
 assert.ok(Buffer.byteLength("clients:p:1234567890123456:20261015:123456789:abcdefghijkl:99999")<=64);
});

test("welcome and home show ADMINISTRATOR only in the owner's private chat",async()=>{
 const {default:worker}=await import("../src/index.js");
 const s=setup();s.env.WEBHOOK_SECRET="test-webhook";
 const original=globalThis.fetch;const messages=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith("https://api.telegram.org/")){
   const data=typeof options.body==="string"?JSON.parse(options.body):Object.fromEntries(options.body.entries());
   if(typeof data.reply_markup==="string")data.reply_markup=JSON.parse(data.reply_markup);
   messages.push(data);
   return Response.json({ok:true,result:{message_id:messages.length+100,photo:[{file_id:"mock"}]}});
  }
  return new Response("No external network in tests",{status:503});
 };
 try{
  for(const uid of [owner,b])for(const page of ["welcome","home"]){
   const start=messages.length;
   const update=page==="welcome"?{message:{message_id:1,from:{id:uid},chat:{id:uid,type:"private"},text:"/start"}}:
     {callback_query:{id:"home",from:{id:uid},message:{message_id:1,chat:{id:uid,type:"private"}},data:"home"}};
   const jobs=[];
   await worker.fetch(new Request("https://test/webhook",{method:"POST",headers:{"X-Telegram-Bot-Api-Secret-Token":"test-webhook"},body:JSON.stringify(update)}),s.env,{waitUntil:job=>jobs.push(job)});
   await Promise.all(jobs);
   const buttons=messages.slice(start).flatMap(x=>x.reply_markup?.inline_keyboard?.flat()||[]);
   assert.equal(buttons.some(x=>x.text==="👑 АДМИНИСТРАТОР"&&x.callback_data==="clients:menu"),uid===owner,page+":"+uid);
   if(page==="home")assert.ok(buttons.some(x=>x.text==="📜 Соглашение"&&x.callback_data==="agreement:start"));
  }
 }finally{globalThis.fetch=original;}
});
test("atomic rating claims admit exactly one client; credit reserves settle only once",async()=>{
 const s=setup();await s.create(a);await s.create(b);
 const claims=await Promise.all([claimPublication(s.env,a,profile,"rating","aaaaaaaaaaaa"),claimPublication(s.env,b,profile,"rating","bbbbbbbbbbbb")]);
 assert.equal(claims.filter(x=>x.ok).length,1);
 const first=await credits(s.env,a,"reserve","rating",profile,"aaaaaaaaaaaa");assert.equal(first.ok,true);
 assert.equal((await credits(s.env,a,"status")).available,2);
 await Promise.all([credits(s.env,a,"complete","rating",profile,"aaaaaaaaaaaa"),credits(s.env,a,"complete","rating",profile,"aaaaaaaaaaaa")]);
 assert.equal((await credits(s.env,a,"status")).spent,1);
 const grant=await registry(s.env,{action:"topup",actorId:owner,userId:a,amount:4,operation:"cccccccccccccccc"});assert.equal(grant.ok,true);
 await registry(s.env,{action:"topup",actorId:owner,userId:a,amount:4,operation:"cccccccccccccccc"});
 assert.equal((await credits(s.env,a,"status")).available,6);
});
test("suspension blocks old callbacks and private payloads; resume needs a new PIN session",async()=>{
 const s=setup();await s.create(a);await s.login(a);
 await registry(s.env,{action:"suspend",actorId:owner,userId:a,operation:"dddddddddddddddd"});
 const before=s.sent.length;assert.equal((await s.run(a,"owner_anketa:open")).handled,true);assert.equal(s.sent.length,before);
 const response=await cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"review",url:"https://x/api?user_id="+a,method:"GET",headers:{Authorization:"Bearer callback"},body:null}},s.send);
 assert.equal(response.status,403);
 await registry(s.env,{action:"resume",actorId:owner,userId:a,operation:"eeeeeeeeeeeeeeee"});await s.run(a,"owner_anketa:open");
 assert.match(s.sent.at(-1).payload.text,/код доступа/);
});
test("workflow payload redemption is once-only across concurrent runner retries",async()=>{
 const s=setup();await s.create(a);await s.login(a);
 await s.store(a).put("private:owner_anketa_state:"+a,{value:JSON.stringify({step:"publishing",id:profile,nonce:"aaaaaaaaaaaa",profile:{id:profile},dispatchPending:true,agreedAt:Date.now(),selected:{0:"5"},catalog:[{label:"Test",options:["5"]}]}),expires:0});
 const request=()=>new Request("https://x/api/anketa/dryfill-payload?profile_id="+profile+"&nonce=aaaaaaaaaaaa&user_id="+a,{headers:{Authorization:"Bearer callback"}});
 // Real coordinator routing uses OrderReminder's serialization, with seeded private state.
 s.env.ORDER_REMINDERS.get(s.env.ORDER_REMINDERS.idFromName("cabinet-events:v1:"+a));
 s.objects.get("cabinet-events:v1:"+a).storage.map.set("private:owner_anketa_state:"+a,s.store(a).map.get("private:owner_anketa_state:"+a));
 const results=await Promise.all([cabinetEndpoint(request(),s.env,"dryfill"),cabinetEndpoint(request(),s.env,"dryfill")]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
});
test("untrusted or cross-user result cannot mutate an existing operation",async()=>{
 const s=setup();const engine=createCabinet(a);
 const request=new Request("https://x/result",{method:"POST",headers:{Authorization:"Bearer callback"},body:JSON.stringify({user_id:b,profile_id:profile,nonce:"aaaaaaaaaaaa"})});
 assert.equal((await engine.handleAnketaLookupResult(request,s.env,s.send)).status,403);
 const denied=await cabinetEndpoint(new Request("https://x/result",{method:"POST",body:"{}"}),s.env,"result");assert.equal(denied.status,403);
});

test("profile lookup, stale result, user confirmation and saved URL reuse use the common engine",async()=>{
 const s=setup();await s.create(a);await s.login(a);s.env.DC_ACTIONS_TOKEN="test-actions";
 s.kv.set("cabinet_loading_emoji_v1",JSON.stringify({id:"1234567890123456789",alt:"⏳"}));
 await credits(s.env,a,"reserve","rating","111111","aaaaaaaaaaaa");
 await credits(s.env,a,"complete","rating","111111","aaaaaaaaaaaa");
 await credits(s.env,a,"reserve","review","222222","bbbbbbbbbbbb");
 const initialBalance=await credits(s.env,a,"status");
 const ledger=s.objects.get("publication-credits:"+a).storage;
 const initialLedger=await ledger.get("credits_v1");
 const calls=[];const original=globalThis.fetch;
 globalThis.fetch=async(url,opt)=>{calls.push({url:String(url),opt});if(String(url).includes("/dispatches"))return new Response(null,{status:204});return new Response("missing",{status:404});};
 try{
  const url="https://b.intimcity.rip/indi/anketa"+profile+".htm";
  await s.run(a,url);
  assert.deepEqual(await credits(s.env,a,"status"),initialBalance);
  let state=JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);
  assert.equal(state.step,"loading");
  assert.ok(s.sent.some(x=>x.payload.text?.startsWith("⏳ ")&&x.payload.entities?.[0].custom_emoji_id==="1234567890123456789"));
  assert.equal(JSON.parse(calls.find(x=>x.url.includes("dispatches")).opt.body).inputs.user_id,a);
  const result={user_id:a,profile_id:profile,nonce:state.nonce,mode:"profile",status:"found",profile:{id:profile,name:"Anna",age:28,metro:"Центр",url}};
  const deliver=value=>cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"result",url:"https://worker/api/anketa/result",method:"POST",headers:{Authorization:"Bearer callback"},body:JSON.stringify(value)}},s.send);
  assert.equal((await deliver({...result,nonce:"bbbbbbbbbbbb"})).status,409);
  assert.equal((await deliver(result)).status,200);
  assert.deepEqual(await ledger.get("credits_v1"),initialLedger);
  state=JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);assert.equal(state.step,"confirm");
  await s.run(a,"owner_anketa:confirm:"+state.nonce);
  const saved=JSON.parse(s.store(a).map.get("private:owner_anketa_saved:"+a+":"+profile).value);
  assert.equal(saved.confirmed,true);assert.equal(saved.profile.name,"Anna");
  assert.deepEqual(await ledger.get("credits_v1"),initialLedger);
  assert.equal((await deliver(result)).status,409);
  const before=calls.filter(x=>x.url.includes("dispatches")).length;await s.run(a,url);
  assert.equal(calls.filter(x=>x.url.includes("dispatches")).length,before);
  await s.run(a,"owner_anketa:saved:"+profile);
  await s.run(a,"owner_anketa:accounts:"+profile);
  await s.run(a,"owner_anketa:open");
  assert.deepEqual(await credits(s.env,a,"status"),initialBalance);
  assert.deepEqual(await ledger.get("credits_v1"),initialLedger);
  assert.equal(s.store(b).map.has("private:owner_anketa_saved:"+a+":"+profile),false);
 }finally{globalThis.fetch=original;}
});

test("cabinet displays unspent balance separately from reservations until proof is delivered",async()=>{
 const s=setup();await s.create(a,"777777",1);await s.login(a);
 await credits(s.env,a,"reserve","rating",profile,"aaaaaaaaaaaa");
 await s.run(a,"owner_anketa:open");
 const pending=s.sent.filter(x=>x.payload.text).at(-1).payload.text;
 assert.match(pending,/ВАМ ДОСТУПНО: 1 ПУБЛИКАЦИЙ/);
 assert.match(pending,/В резерве: 1/);assert.match(pending,/только после подтверждения/);
 assert.doesNotMatch(pending,/ЛИМИТ ИСЧЕРПАН/);
 assert.equal((await credits(s.env,a,"status")).spent,0);
 await credits(s.env,a,"release","rating",profile,"aaaaaaaaaaaa");
 await s.run(a,"owner_anketa:open");
 const released=s.sent.filter(x=>x.payload.text).at(-1).payload.text;
 assert.match(released,/ВАМ ДОСТУПНО: 1 ПУБЛИКАЦИЙ/);assert.doesNotMatch(released,/В резерве/);
});

test("trial migration preserves original profile, authorization, spent credits and legacy KV",async()=>{
 const s=setup(),uid="5627932577";
 s.kv.set("trial_cabinet_v1:"+uid+":session",JSON.stringify({verified:true}));
 s.kv.set("trial_cabinet_v1:"+uid+":profiles",JSON.stringify([{id:"698842",url:"https://b.intimcity.rip/indi/anketa698842.htm"}]));
 await credits(s.env,uid,"reserve","review","123456","aaaaaaaaaaaa");await credits(s.env,uid,"complete","review","123456","aaaaaaaaaaaa");
 await s.run(uid,"owner_anketa:open");
 assert.equal(s.store(uid).map.get("client_session").version,1);
 assert.deepEqual(JSON.parse(s.store(uid).map.get("private:owner_anketa_library:"+uid).value),["698842"]);
 assert.equal((await credits(s.env,uid,"status")).available,1);assert.equal((await credits(s.env,uid,"status")).spent,1);
 assert.equal(s.store(uid).map.get("private:owner_anketa_saved:"+uid+":698842")?.value,undefined);
 assert.ok(s.kv.has("trial_cabinet_v1:"+uid+":profiles"));
 await s.run(uid,"owner_anketa:open");assert.equal((await credits(s.env,uid,"status")).available,1);
});

test("old suffix is never visited and replacement must verify the same profile before resuming",async()=>{
 const s=setup();await s.create(a);await s.login(a);s.env.DC_ACTIONS_TOKEN="test-actions";
 const initial=await credits(s.env,a,"status"),calls=[],original=globalThis.fetch;
 const state=()=>JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);
 const deliver=body=>cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"result",url:"https://x/result",method:"POST",headers:{Authorization:"Bearer callback"},body:JSON.stringify({user_id:a,...body})}},s.send);
 globalThis.fetch=async(url,opt)=>{if(String(url).includes("/dispatches")){calls.push(JSON.parse(opt.body).inputs);return new Response(null,{status:204});}return new Response("missing",{status:404});};
 try{
  await s.run(a,"owner_anketa:new");await s.run(a,"https://a.intimcity.gip/indi/anketa"+profile+".htm");
  assert.equal(state().step,"domain_recovery");assert.equal(calls.length,0);
  assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/действующий сайт/);
  await s.run(a,"https://b.intimcity.rip/indi/anketa999999.htm");assert.equal(calls.length,0);
  await s.run(a,"https://example.com/indi/anketa"+profile+".htm");assert.equal(calls.length,0);
  const beforeLink=s.sent.length;
  const url="https://b.intimcity.rip/indi/anketa"+profile+".htm";await s.run(a,url);
  const checking=s.sent.slice(beforeLink);
  const removed=checking.findIndex(x=>x.method==="deleteMessage"&&x.payload.chat_id===a&&x.payload.message_id===77);
  const waiting=checking.findIndex(x=>x.payload.text?.startsWith("⏳ Проверяю новую ссылку"));
  assert.ok(removed>=0&&waiting>removed,"remove only the submitted link before showing recovery progress");
  assert.equal(calls.at(-1).mode,"domain_probe");const probe=state();
  const reply={profile_id:profile,nonce:probe.nonce,mode:"domain_probe",status:"found",profile:{id:profile,name:"Anna",age:28,metro:"Центр",url}};
  assert.equal((await deliver({...reply,nonce:"aaaaaaaaaaaa"})).status,409);
  assert.equal((await deliver(reply)).status,200);assert.equal(calls.at(-1).mode,"profile");
  const resumed=state();assert.equal(resumed.host,"b.intimcity.rip");assert.equal(resumed.step,"loading");
  assert.equal((await deliver({profile_id:profile,nonce:resumed.nonce,mode:"profile",status:"found",profile:reply.profile})).status,200);
  assert.equal(state().step,"confirm");await s.run(a,"owner_anketa:confirm:"+state().nonce);
  assert.equal(JSON.parse(s.store(a).map.get("private:owner_anketa_saved:"+a+":"+profile).value).host,"b.intimcity.rip");
  assert.deepEqual(await credits(s.env,a,"status"),initial);
  assert.ok(!calls.some(x=>["publish","review_publish"].includes(x.mode)));
 }finally{globalThis.fetch=original;}
});

test("domain recovery preserves every workflow snapshot and never repeats accepted publications",async()=>{
 const modes={profile:"loading",ratings:"ratings_loading",mapping:"audit_loading",dryfill:"dryfill_loading",publish:"publishing",proof:"proof_loading",review_publish:"review_dispatch",review_proof:"review_recheck"};
 const original=globalThis.fetch;
 try{for(const [mode,step] of Object.entries(modes)){
  const s=setup();await s.create(a);await s.login(a);s.env.DC_ACTIONS_TOKEN="test-actions";
  await credits(s.env,a,"reserve","rating",profile,"aaaaaaaaaaaa");
  const ledger=s.objects.get("publication-credits:"+a).storage,initial=await ledger.get("credits_v1"),calls=[];
  globalThis.fetch=async(url,opt)=>{if(String(url).includes("/dispatches")){calls.push(JSON.parse(opt.body).inputs);return new Response(null,{status:204});}return new Response("missing",{status:404});};
  const host="a.intimcity.rip",url="https://"+host+"/indi/anketa"+profile+".htm";
  const saved={host,confirmed:true,profile:{id:profile,name:"Anna",age:28,metro:"Центр",url},catalog:[{label:"Test",options:["5"]}]};
  s.kv.set("owner_anketa_saved:"+a+":"+profile,JSON.stringify(saved));
  s.kv.set("owner_anketa_saved:"+a+":999999",JSON.stringify({...saved,profile:{...saved.profile,id:"999999"}}));
  s.kv.set("cabinet_rating_draft:"+a+":"+profile,JSON.stringify({host,url,selected:{0:"5"},catalog:saved.catalog}));
  s.kv.set("profile-thumbnails/"+host+"/"+profile+".card.jpg",new Uint8Array([1,2,3]));
  const proofKey="cabinet_v3:"+a+":owner_anketa_proof_archive_v1:yan_first:"+profile;
  s.kv.set(proofKey,JSON.stringify({fileId:"existing_receipt",savedAt:"2026-10-15T10:00:00Z"}));const proof=s.kv.get(proofKey);
  const snapshot={step,id:profile,nonce:"bbbbbbbbbbbb",previousNonce:"cccccccccccc",account:"yan_first",host,profile:saved.profile,catalog:saved.catalog,selected:{0:"5"},metElsewhere:true,text:"Текст ранее согласованного отзыва клиентки",creditNonce:"aaaaaaaaaaaa",claimNonce:"dddddddddddddddd",dailyDate:"2026-10-15",agreedAt:Date.now()-3600000,prepublish:true};
  await s.store(a).put("private:owner_anketa_state:"+a,{value:JSON.stringify(snapshot),expires:0});
  if(["publish","proof","review_publish","review_proof"].includes(mode))await s.store(a).put("private:cabinet_operation:"+a+":"+snapshot.nonce,{value:JSON.stringify(snapshot),expires:0});
  const get=()=>JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);
  const deliver=body=>cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"result",url:"https://x/result",method:"POST",headers:{Authorization:"Bearer callback"},body:JSON.stringify({user_id:a,profile_id:profile,...body})}},s.send);
  assert.equal((await deliver({nonce:snapshot.nonce,mode,status:"error"})).status,200,mode);
  assert.equal(get().step,"domain_recovery");
  assert.equal(JSON.parse(s.kv.get("owner_anketa_saved:"+a+":"+profile)).host,host);
  if(mode==="dryfill"){
   assert.equal((await s.run(a,"owner_anketa:home")).home,true);
   await s.run(a,"owner_anketa:saved:"+profile);
   assert.ok(s.sent.filter(x=>x.payload.reply_markup).at(-1).payload.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==="owner_anketa:domain_resume:"+profile));
  }
  await s.run(a,"https://b.intimcity.rip/indi/anketa"+profile+".htm");const probe=get();
  assert.equal(calls.at(-1).mode,"domain_probe");
  assert.equal((await deliver({nonce:probe.nonce,mode:"domain_probe",status:"found",profile:{...saved.profile,url:"https://b.intimcity.rip/indi/anketa"+profile+".htm"}})).status,200);
  const resumed=get(),expectedMode=mode==="publish"?"proof":mode==="review_publish"?"review_proof":mode;
  assert.equal(calls.at(-1).mode,expectedMode,mode);assert.equal(calls.at(-1).site_host,"b.intimcity.rip");
  assert.equal(resumed.host,"b.intimcity.rip");assert.deepEqual(resumed.selected,snapshot.selected);assert.equal(resumed.text,snapshot.text);
  assert.equal(resumed.creditNonce,snapshot.creditNonce);assert.equal(resumed.claimNonce,snapshot.claimNonce);assert.equal(resumed.dailyDate,snapshot.dailyDate);
  assert.equal(JSON.parse(s.store(a).map.get("private:owner_anketa_saved:"+a+":"+profile).value).host,"b.intimcity.rip");
  assert.equal(JSON.parse(s.kv.get("owner_anketa_saved:"+a+":999999")).host,host);
  assert.equal(s.kv.get(proofKey),proof);assert.deepEqual(await ledger.get("credits_v1"),initial);
  assert.deepEqual(s.kv.get("profile-thumbnails/b.intimcity.rip/"+profile+".card.jpg"),new Uint8Array([1,2,3]));
  assert.equal((await deliver({nonce:snapshot.nonce,mode,status:"error"})).status,409);
  assert.ok(!calls.some(x=>["publish","review_publish"].includes(x.mode)));
 }}finally{globalThis.fetch=original;}
});

test("failed domain probe preserves saved host and late recovery does not replace another open profile",async()=>{
 const s=setup();await s.create(a);await s.login(a);s.env.DC_ACTIONS_TOKEN="test-actions";
 const active={step:"ratings",profile:{id:"999999"},host:"a.intimcity.rip",nonce:"cccccccccccc"};
 const archived={step:"proof_loading",id:profile,host:"a.intimcity.rip",nonce:"bbbbbbbbbbbb",account:"yan_first"};
 await s.store(a).put("private:owner_anketa_state:"+a,{value:JSON.stringify(active),expires:0});
 await s.store(a).put("private:cabinet_operation:"+a+":"+archived.nonce,{value:JSON.stringify(archived),expires:0});
 const deliver=body=>cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"result",url:"https://x/result",method:"POST",headers:{Authorization:"Bearer callback"},body:JSON.stringify({user_id:a,profile_id:profile,...body})}},s.send);
 assert.equal((await deliver({nonce:archived.nonce,mode:"proof",status:"error"})).status,200);
 assert.deepEqual(JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value),active);
 assert.ok(s.sent.filter(x=>x.payload.reply_markup).at(-1).payload.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==="owner_anketa:domain_resume:"+profile));
 await s.run(a,"owner_anketa:domain_resume:"+profile);
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(null,{status:204});
 try{
  await s.run(a,"https://b.intimcity.rip/indi/anketa"+profile+".htm");
  const probe=JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);
  assert.equal((await deliver({nonce:probe.nonce,mode:"domain_probe",status:"error"})).status,200);
  assert.equal(JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value).step,"domain_recovery");
 }finally{globalThis.fetch=original;}
});

test("setting available balance preserves spends and reservations and does not revive deducted credits on topup",async()=>{
 const {adjustCredits}=await import("../src/publication_credits.js");
 const s=setup();await s.create(a,"777777",10);
 await credits(s.env,a,"reserve","rating",profile,"aaaaaaaaaaaa");await credits(s.env,a,"complete","rating",profile,"aaaaaaaaaaaa");
 await credits(s.env,a,"reserve","review",profile,"bbbbbbbbbbbb");
 assert.equal((await adjustCredits(s.env,a,2,8,"cccccccccccccccc",owner)).ok,true);
 let status=await credits(s.env,a,"status");assert.equal(status.available,2);assert.equal(status.spent,1);assert.equal(status.reserved,1);
 assert.equal((await adjustCredits(s.env,a,2,8,"cccccccccccccccc",owner)).already,true);
 await registry(s.env,{action:"topup",actorId:owner,userId:a,amount:2,operation:"dddddddddddddddd"});
 assert.equal((await credits(s.env,a,"status")).available,4);
 assert.equal((await adjustCredits(s.env,a,0,99,"eeeeeeeeeeeeeeee",owner)).reason,"balance_changed");
 await assert.rejects(adjustCredits(s.env,a,0,4,"ffffffffffffffff",b));
});

test("prepared banner uploads valid PNG bytes to the correct chat and fails to clean text safely",async()=>{
 const {readFile}=await import("node:fs/promises");
 const png=await readFile(new URL("../assets/balance_cards/balance_03.png",import.meta.url));
 const s=setup();await s.create(a);const original=globalThis.fetch;const photos=[];
 globalThis.fetch=async(url,opt)=>{
  if(String(url).includes("raw.githubusercontent.com"))return new Response(png,{headers:{"Content-Type":"image/png"}});
  if(String(url).endsWith("/sendPhoto")){
   photos.push(opt.body);return Response.json({ok:true,result:{message_id:300}});
  }throw Error("Unexpected network call");
 };
 try{
  await s.login(a);assert.equal(photos.length,1);const form=photos[0];
  assert.equal(form.get("chat_id"),a);assert.equal(form.get("protect_content"),"true");assert.equal(form.get("photo").type,"image/png");
  assert.deepEqual(new Uint8Array(await form.get("photo").arrayBuffer()),new Uint8Array(png));
  globalThis.fetch=async()=>new Response("invalid bytes",{status:200});await s.run(a,"owner_anketa:open");
  const fallback=s.sent.filter(x=>x.method==="sendMessage"||x.method==="editMessageText").at(-1).payload.text;
  assert.match(fallback,/3 ПУБЛИКАЦИЙ/);assert.doesNotMatch(fallback,/Диагностика|Техническая информация/);
 }finally{globalThis.fetch=original;}
});

test("rating drafts survive switching profiles and never become another client's draft",async()=>{
 const s=setup();await s.create(a);await s.create(b);await s.login(a);await s.login(b);
 const catalog=[{label:"Test",options:["5"],group:"Оценки анкеты",subgroup:""}];
 const saved={profile:{id:profile,name:"Anna",url:"https://b.intimcity.rip/indi/anketa"+profile+".htm",photoUrl:"https://cdn2.intimtur.com/test.jpg"},host:"b.intimcity.rip",catalog};
 for(const uid of [a,b]){
  s.kv.set("owner_anketa_saved:"+uid+":"+profile,JSON.stringify(saved));
  s.kv.set("owner_anketa_selected_account:"+uid,JSON.stringify({profileId:profile,account:"yan_first",expiresAt:Date.now()+100000}));
 }
 await s.run(a,"owner_anketa:savedrating:"+profile);
 const state=JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);
 const input={initData:"user="+encodeURIComponent(JSON.stringify({id:a})),key:state.nonce,action:"save",selected:{0:"5"}};
 const response=await cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"ratings",url:"https://x/ratings",method:"POST",headers:{},body:JSON.stringify(input)}},s.send,async()=>true);
 assert.equal(response.status,200);
 assert.ok(s.store(a).map.has("private:cabinet_rating_draft:"+a+":"+profile));
 await s.run(a,"owner_anketa:open");await s.run(a,"owner_anketa:savedrating:"+profile);
 const restored=JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);
 assert.deepEqual(restored.selected,{0:"5"});assert.notEqual(restored.nonce,state.nonce);assert.equal(restored.agreedAt,undefined);
 await s.run(b,"owner_anketa:savedrating:"+profile);
 const other=JSON.parse(s.store(b).map.get("private:owner_anketa_state:"+b).value);
 assert.deepEqual(other.selected,{});
 assert.equal(s.store(b).map.has("private:cabinet_rating_draft:"+a+":"+profile),false);
});

test("settlement outbox retries ledger completion without issuing another publication",async()=>{
 const s=setup();await s.create(a);await credits(s.env,a,"reserve","rating",profile,"aaaaaaaaaaaa");
 s.env.ORDER_REMINDERS.get("cabinet-events:v1:"+a);
 const target=s.objects.get("cabinet-events:v1:"+a);
 await target.storage.put("ledger_outbox",{one:{ledger:"credits",userId:a,kind:"rating",profileId:profile,nonce:"aaaaaaaaaaaa"}});
 await target.obj.alarm();assert.equal((await credits(s.env,a,"status")).spent,1);
 assert.deepEqual(await target.storage.get("ledger_outbox"),{});await target.obj.alarm();
 assert.equal((await credits(s.env,a,"status")).spent,1);
});

test("last-credit proof completes, settles once and remains visible after exhausted navigation",async()=>{
 const {dailyLimit,moscowDay}=await import("../src/daily_publication_limit.js");
 const s=setup();await s.create(a,"777777",1);await s.create(b);await s.login(a);const date=moscowDay();
 await credits(s.env,a,"reserve","rating",profile,"aaaaaaaaaaaa");await dailyLimit(s.env,a,profile,"reserve","rating","aaaaaaaaaaaa",date);
 const current={step:"proof_loading",id:profile,nonce:"bbbbbbbbbbbb",account:"yan_first",host:"b.intimcity.rip",creditNonce:"aaaaaaaaaaaa",dailyDate:date};
 await s.store(a).put("private:cabinet_operation:"+a+":"+current.nonce,{value:JSON.stringify(current),expires:0});
 await s.store(a).put("private:owner_anketa_state:"+a,{value:JSON.stringify({step:"number",nonce:"cccccccccccc"}),expires:0});
 const image=Buffer.alloc(1200);image[0]=255;image[1]=216;image[1198]=255;image[1199]=217;
 const body={user_id:a,profile_id:profile,nonce:current.nonce,mode:"proof",status:"found",proof:{profile_id:profile,account:"yan_first",date:"15.10.2026",mime:"image/jpeg",image:image.toString("base64")}};
 const original=globalThis.fetch;const photos=[];
 globalThis.fetch=async(url,opt)=>{
  if(String(url).endsWith("sendPhoto")){photos.push(opt.body);return Response.json({ok:true,result:{message_id:800,photo:[{file_id:"private-proof-file"}]}});}
  return new Response("missing",{status:404});
 };
 try{
  const deliver=()=>cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"result",url:"https://x/result",method:"POST",headers:{Authorization:"Bearer callback"},body:JSON.stringify(body)}},s.send);
  assert.equal((await deliver()).status,200);assert.equal(photos.length,1);
  assert.equal(photos[0].get("chat_id"),a);assert.equal(photos[0].get("protect_content"),"true");
  assert.equal((await credits(s.env,a,"status")).spent,1);assert.equal((await credits(s.env,b,"status")).spent,0);
  assert.equal((await credits(s.env,a,"status")).available,0);
  assert.equal((await dailyLimit(s.env,a,profile,"status")).remaining,1);
  assert.equal((await deliver()).status,409);assert.equal(photos.length,1);
  assert.equal(JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value).step,"number");
  assert.ok(s.store(a).map.has("private:cabinet_v3:"+a+":owner_anketa_proof_archive_v1:yan_first:"+profile));
  const before=s.sent.length;assert.equal((await s.run(a,"owner_anketa:home")).home,true);
  assert.ok(!s.sent.slice(before).some(x=>x.method==="deleteMessage"&&x.payload.message_id===800));
 }finally{globalThis.fetch=original;}
});

test("zero-credit client buttons return to own library and profile selection offers topup only",async()=>{
 const s=setup();await s.create(a,"777777",0);await s.create(b);
 s.kv.set("owner_anketa_library:"+a,JSON.stringify([profile]));
 s.kv.set("owner_anketa_saved:"+a+":"+profile,JSON.stringify({profile:{id:profile,name:"Anna"},host:"b.intimcity.rip"}));
 s.kv.set("owner_anketa_library:"+b,JSON.stringify(["222333"]));
 await s.login(a);
 const latest=()=>s.sent.filter(x=>x.payload.text||x.payload.caption).at(-1).payload;
 const buttons=p=>p.reply_markup.inline_keyboard.flat();
 for(const action of ["owner_anketa:saved:"+profile,"owner_anketa:savedreview:"+profile,"owner_anketa:proofthanks:"+profile]){
  await s.run(a,action);
  const p=latest();assert.match(p.text,/ВАШ ЛИМИТ ИСЧЕРПАН/);
  assert.ok(buttons(p).some(x=>x.callback_data==="owner_anketa:balance_empty:"+profile));
  assert.ok(!buttons(p).some(x=>/:(?:new|savedreview|savedrating):?/.test(x.callback_data||"")));
  assert.ok(!JSON.stringify(p).includes("222333"));
 }
 const update={callback_query:{id:"general",from:{id:a},message:{message_id:22,chat:{id:a,type:"private"}},data:"services"}};
 const before=s.sent.length;
 assert.equal((await cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"update",update}},s.send)).handled,false);
 assert.equal(s.sent.length,before);
 assert.equal((await s.run(a,"owner_anketa:home")).home,true);
 await s.run(a,"owner_anketa:balance_empty:"+profile);
 assert.match(latest().text,/ЛИМИТ ПУБЛИКАЦИЙ ИСЧЕРПАН/);
 assert.match(latest().text,/пополнения баланса/);
 assert.ok(buttons(latest()).some(x=>x.url==="https://t.me/DameCamelias"));
 assert.ok(!buttons(latest()).some(x=>/savedrating|savedreview|deleteask/.test(x.callback_data||"")));
 assert.equal((await credits(s.env,a,"status")).spent,0);
 assert.equal((await credits(s.env,b,"status")).available,3);
});

test("topup unlocks old zero-balance profile buttons without resetting history",async()=>{
 const s=setup();await s.create(a,"777777",1);
 await credits(s.env,a,"reserve","rating",profile,"aaaaaaaaaaaa");
 await credits(s.env,a,"complete","rating",profile,"aaaaaaaaaaaa");
 s.kv.set("owner_anketa_library:"+a,JSON.stringify([profile]));
 s.kv.set("owner_anketa_saved:"+a+":"+profile,JSON.stringify({profile:{id:profile,name:"Anna"},host:"b.intimcity.rip"}));
 await s.login(a);
 await registry(s.env,{action:"topup",actorId:owner,userId:a,amount:2,operation:"eeeeeeeeeeeeeeee"});
 await s.run(a,"owner_anketa:balance_empty:"+profile);
 assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/Anna/);
 const balance=await credits(s.env,a,"status");assert.equal(balance.available,2);assert.equal(balance.spent,1);
 assert.equal(s.objects.get("publication-credits:"+a).storage.map.get("credits_v1").history.length,1);
});

test("home and public navigation bypass cabinet balance and session while cancelling only draft input",async()=>{
 const s=setup();await s.create(a,"777777",0);await s.login(a);
 const key="private:owner_anketa_state:"+a;
 for(const action of ["services","order","quick_order","contacts","home","/start","/order"]){
  s.store(a).map.set(key,{value:JSON.stringify({step:"review_input",id:profile}),expires:0});
  const update=action.startsWith("/")?s.update(a,action):{callback_query:{id:"public",from:{id:a},message:{message_id:44,chat:{id:a,type:"private"}},data:action}};
  assert.equal((await cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"update",update}},s.send)).handled,false);
  assert.equal(JSON.parse(s.store(a).map.get(key).value),null);
  assert.equal((await s.run(a,"Ответ для оформления заказа")).handled,false);
 }
 await s.store(a).delete("client_session");s.env.CABINET_CLIENTS_ENABLED="false";
 s.store(a).map.set(key,{value:JSON.stringify({step:"publishing",id:profile}),expires:0});
 assert.equal((await s.run(a,"owner_anketa:home")).home,true);
 assert.equal(JSON.parse(s.store(a).map.get(key).value).step,"publishing");
 assert.equal((await credits(s.env,a,"status")).available,0);
});

test("reserved last credit is not exhaustion and zero balance denies stale rating forms",async()=>{
 const s=setup();await s.create(a,"777777",1);await s.login(a);
 await credits(s.env,a,"reserve","rating",profile,"aaaaaaaaaaaa");
 await s.run(a,"owner_anketa:new");
 assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/полную ссылку/);
 await credits(s.env,a,"complete","rating",profile,"aaaaaaaaaaaa");
 await s.run(a,"https://b.intimcity.rip/indi/anketa123123.htm");
 assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/ВАШ ЛИМИТ ИСЧЕРПАН/);
 const response=await cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"ratings",url:"https://x/ratings",method:"POST",headers:{},body:"{}"}},s.send);
 assert.equal(response.status,403);assert.match(response.body,/balance exhausted/);
});

test("zero-credit policy leaves owner administration accessible",async()=>{
 const {adjustCredits}=await import("../src/publication_credits.js");
 const s=setup();s.kv.set("owner_cabinet_session:"+owner,JSON.stringify({authorized:true}));
 await adjustCredits(s.env,owner,0,10,"dddddddddddddddd",owner);
 await s.run(owner,"clients:add");
 assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/Telegram ID клиентки/);
});

test("completed publication card renders HTML on photo and text fallback with clear next action",async()=>{
 for(const hasPhoto of [true,false]){
  const s=setup();await s.create(a);await s.login(a);
  s.kv.set("owner_anketa_saved:"+a+":"+profile,JSON.stringify({profile:{id:profile,name:"Anna"},host:"b.intimcity.rip"}));
  for(const kind of ["rating","review"])s.kv.set("cabinet_v3:"+a+":owner_anketa_publication_v1:"+kind+":"+profile,JSON.stringify({status:"published"}));
  if(hasPhoto)s.kv.set("profile-thumbnails/b.intimcity.rip/"+profile+".card.jpg","image bytes");
  await s.run(a,"owner_anketa:account1:"+profile);
  const p=s.sent.filter(x=>x.payload.text?.includes("Все доступные публикации")||x.payload.caption?.includes("Все доступные публикации")).at(-1).payload;
  assert.equal(p.parse_mode,"HTML");
  assert.match(p.text||p.caption,/Подтверждения ваших публикаций доступны ниже/);
  assert.ok(!(p.text||p.caption).includes("Выберите действие"));
 }
});

test("review payload and submission boundary are single use and cannot be borrowed by another client",async()=>{
 const {reviewGuard}=await import("../src/review_publication_guard.js");
 const s=setup();await s.create(a);await s.create(b);
 const claimNonce="aaaaaaaaaaaaaaaa",requestNonce="bbbbbbbbbbbb";
 await reviewGuard(s.env,profile,"review_claim",claimNonce);
 const key="cabinet-events:v1:"+a;s.env.ORDER_REMINDERS.get(key);
 const state={step:"review_dispatch",id:profile,nonce:requestNonce,claimNonce,account:"yan_first",text:"Подробный текст настоящего отзыва клиента",agreedAt:Date.now(),payloadIssued:false};
 await s.objects.get(key).storage.put("private:owner_anketa_state:"+a,{value:JSON.stringify(state),expires:0});
 s.kv.set("owner_anketa_saved:"+a+":"+profile,JSON.stringify({profile:{id:profile},host:"b.intimcity.rip"}));
 const req=uid=>new Request("https://x/api/anketa/review-payload?profile_id="+profile+"&nonce="+requestNonce+"&mode=review_publish&user_id="+uid,{headers:{Authorization:"Bearer callback"}});
 const replies=await Promise.all([cabinetEndpoint(req(a),s.env,"review"),cabinetEndpoint(req(a),s.env,"review")]);
 assert.deepEqual(replies.map(x=>x.status).sort(),[200,409]);
 const success=replies.find(x=>x.status===200);assert.equal((await success.json()).text,state.text);
 assert.equal((await cabinetEndpoint(req(b),s.env,"review")).status,409);
 const stage=type=>cabinetEndpoint(new Request("https://x/api/anketa/review-stage",{method:"POST",headers:{Authorization:"Bearer callback"},body:JSON.stringify({user_id:a,profile_id:profile,nonce:requestNonce,type})}),s.env,"stage");
 assert.equal((await stage("review_submit_boundary")).status,200);
 assert.equal((await stage("review_submit_boundary")).status,409);
 assert.equal((await stage("review_preflight_failed")).status,409);
});

test("review moderation edits in group, dispatches automatically after correction and attaches verified proof",async()=>{
 const s=setup();await s.create(a);s.env.DC_ACTIONS_TOKEN="test-actions";
 s.env.ORDER_REMINDERS.get("cabinet-events:v1:"+a);const storage=s.objects.get("cabinet-events:v1:"+a).storage;
 await storage.put("client_session",{version:1});
 const ticket="aaaaaaaaaaaaaaaa",text="Исходный отзыв клиентки, ожидающий проверки.";
 const put=(key,value)=>storage.put("private:"+key,{value:JSON.stringify(value),expires:0});
 await put("owner_anketa_saved:"+a+":"+profile,{host:"b.intimcity.rip",profile:{id:profile,name:"Anna"}});
 await put("owner_anketa_selected_account:"+a,{profileId:profile,account:"yan_first",expiresAt:Date.now()+100000});
 await put("owner_anketa_state:"+a,{step:"review_agreed",id:profile,nonce:ticket,account:"yan_first",text,agreedAt:Date.now()});
 const sent=[],dispatches=[];let nextId=100;const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes("/dispatches")){dispatches.push(JSON.parse(options.body).inputs);return new Response(null,{status:204});}
  if(String(url).includes("api.telegram.org")){
   const method=String(url).split("/").at(-1),payload=typeof options.body==="string"?JSON.parse(options.body):Object.fromEntries(options.body.entries());sent.push({method,payload});
   return Response.json({ok:true,result:{message_id:payload.message_id||++nextId,...(method==="sendPhoto"?{photo:[{file_id:"review_proof_file"}]}:{})}});
  }return new Response("missing",{status:404});
 };
 const record=()=>s.objects.get("review-moderation:v1:"+a+":"+ticket).storage.map.get("moderation");
 const groupAction=(name,version=record().version)=>({callback_query:{id:"group",from:{id:Number(MODERATOR_ID)},message:{message_id:record().messageId,chat:{id:Number(MODERATION_CHAT),type:"supergroup"}},data:"reviewmod:"+name+":"+a+":"+ticket+":"+version}});
 try{
  const update=s.update(a,"owner_anketa:reviewfinal:"+ticket);update.callback_query.from.username="test_client";
  await cabinetRPC(s.env,a,{kind:"update",update});assert.equal(dispatches.length,0);assert.equal((await credits(s.env,a,"status")).reserved,0);
  assert.equal(record().status,"pending");assert.equal(record().username,"test_client");
  const clientWaiting=sent.filter(x=>String(x.payload.chat_id)===a&&x.payload.text?.includes("ПУБЛИКУЕМ ОТЗЫВ")).length;
  await handleModeration(groupAction("edit"),s.env);
  const corrected="Исправленный администратором реальный текст отзыва.";
  await handleModeration({message:{message_id:999,from:{id:Number(MODERATOR_ID)},chat:{id:Number(MODERATION_CHAT),type:"supergroup"},reply_to_message:{message_id:record().editPromptId},text:corrected}},s.env);
  assert.equal(record().text,corrected);assert.equal(dispatches.length,1);
  await handleModeration(groupAction("approve",1),s.env);assert.equal(dispatches.length,1);
  const approvedButton=groupAction("approve");await handleModeration(approvedButton,s.env);await handleModeration(approvedButton,s.env);
  assert.equal(dispatches.length,1);assert.equal(dispatches[0].mode,"review_publish");assert.equal((await credits(s.env,a,"status")).spent,0);assert.equal((await credits(s.env,a,"status")).reserved,1);
  assert.equal(sent.filter(x=>String(x.payload.chat_id)===a&&x.payload.text?.includes("ПУБЛИКУЕМ ОТЗЫВ")).length,clientWaiting);
  const active=JSON.parse(storage.map.get("private:owner_anketa_state:"+a).value);assert.equal(active.text,corrected);
  const image=Buffer.alloc(1200);image[0]=255;image[1]=216;image[1198]=255;image[1199]=217;
  const result={user_id:a,profile_id:profile,nonce:active.nonce,mode:"review_publish",status:"found",review_publication:{confirmed:true,proof:{account:"yan_first",profile_id:profile,text_verified:true,mime:"image/jpeg",image:image.toString("base64")}}};
  const deliver=()=>cabinetEndpoint(new Request("https://x/api/anketa/result",{method:"POST",headers:{Authorization:"Bearer callback"},body:JSON.stringify(result)}),s.env,"result");
  assert.equal((await deliver()).status,200);assert.equal(record().status,"published");
  assert.equal((await credits(s.env,a,"status")).spent,1);assert.equal((await credits(s.env,a,"status")).reserved,0);
  const moderation=s.objects.get("review-moderation:v1:"+a+":"+ticket);await moderation.obj.alarm();await moderation.obj.alarm();
  const photo=sent.findIndex(x=>x.method==="sendPhoto"&&String(x.payload.chat_id)===a);
  const notices=sent.map((x,i)=>({x,i})).filter(({x})=>x.method==="sendPhoto"&&String(x.payload.chat_id)===MODERATION_CHAT&&x.payload.caption==="✅ ОПУБЛИКОВАНО");
  assert.equal(notices.length,1);assert.ok(notices[0].i>photo);assert.equal(notices[0].x.payload.reply_parameters.message_id,record().messageId);
  assert.equal((await deliver()).status,409);assert.equal(dispatches.length,1);
 }finally{globalThis.fetch=original;}
});

test("cancelling moderation preserves credits and draft, removes waiting and rejects other actors",async()=>{
 const s=setup();await s.create(a);await s.login(a);
 const ticket="aaaaaaaaaaaaaaaa",text="Сохранённый реальный текст отзыва клиентки.";
 s.kv.set("owner_anketa_saved:"+a+":"+profile,JSON.stringify({profile:{id:profile},host:"b.intimcity.rip"}));
 await s.store(a).put("private:cabinet_review_moderation:"+a+":"+ticket,{value:JSON.stringify({status:"pending",snapshot:{step:"review_agreed",id:profile,nonce:ticket,account:"yan_first",text},waitingMessageId:800}),expires:0});
 await s.store(a).put("private:owner_anketa_state:"+a,{value:JSON.stringify({step:"review_moderation",moderationTicket:ticket}),expires:0});
 const call=actorId=>cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"review_moderation",actorId,action:"cancel",ticket}},s.send);
 const balance=await credits(s.env,a,"status");assert.equal((await call(b)).status,403);
 assert.equal((await call(owner)).ok,true);assert.equal((await call(owner)).already,true);
 assert.deepEqual(await credits(s.env,a,"status"),balance);
 assert.equal(JSON.parse(s.store(a).map.get("private:cabinet_v3:"+a+":owner_anketa_review_draft_v1:yan_first:"+profile).value).text,text);
 assert.equal(s.sent.filter(x=>x.payload.text?.includes("ПОПРОБУЕМ ДРУГОЙ ОТЗЫВ")).length,1);
 assert.ok(s.sent.some(x=>x.method==="deleteMessage"&&x.payload.message_id===800&&x.payload.chat_id===a));
 const notice=s.sent.filter(x=>x.payload.text?.includes("ПОПРОБУЕМ ДРУГОЙ ОТЗЫВ")).at(-1);
 assert.ok(notice.payload.reply_markup.inline_keyboard.flat().some(x=>x.text==="✍️ Ввести другой отзыв"));
 await s.run(b,"owner_anketa:reviewretry:"+ticket);
 assert.ok(!JSON.stringify(s.sent.filter(x=>x.payload.chat_id===b)).includes(text));
 await s.run(a,"owner_anketa:reviewretry:"+ticket);
 assert.equal(JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value).id,profile);
 const prompt=s.sent.filter(x=>x.payload.text?.includes("НОВЫЙ ТЕКСТ ОТЗЫВА")).at(-1);
 assert.equal(prompt.method,"editMessageText","reuse navigation instead of leaving the rejection message behind");
 const replacement="Другой новый реальный отзыв клиентки для повторной проверки.";
 await s.run(a,replacement);
 const preview=JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);assert.equal(preview.step,"review_preview");assert.notEqual(preview.nonce,ticket);
 assert.equal(preview.text,replacement);await s.run(a,"owner_anketa:reviewagree:"+preview.nonce);
 const get=s.env.ORDER_REMINDERS.get,queued=[];
 s.env.ORDER_REMINDERS.get=name=>name.startsWith("review-moderation:v1:")?{fetch:async(url,options)=>{queued.push(JSON.parse(options.body));return Response.json({ok:true});}}:get(name);
 await s.run(a,"owner_anketa:reviewfinal:"+preview.nonce);
 assert.equal(queued.length,1);assert.equal(queued[0].event.text,replacement);assert.equal(queued[0].ticket,preview.nonce);
 assert.equal(JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value).step,"review_moderation");
 assert.deepEqual(await credits(s.env,a,"status"),balance);
});

test("stale administrative confirmation cannot apply a different pending change",async()=>{
 const s=setup();await s.create(a);s.kv.set("owner_cabinet_session:"+owner,JSON.stringify({authorized:true}));
 await s.run(owner,"clients:suspend:"+a);
 const stale=s.sent.filter(x=>x.payload.reply_markup).at(-1).payload.reply_markup.inline_keyboard[0][0].callback_data;
 await s.run(owner,"clients:topup:"+a);await s.run(owner,"5");
 await s.run(owner,stale);assert.equal((await credits(s.env,a,"status")).available,3);
 assert.equal((await registry(s.env,{action:"get",userId:a})).client.active,true);
 const confirm="clients:confirm:"+(await s.store(owner).get("admin_pending")).operation;
 await s.run(owner,confirm);assert.equal((await credits(s.env,a,"status")).available,8);
});

test("private DO state is used after legacy KV is unavailable, while unknown balances fail closed",async()=>{
 const s=setup();await s.create(a);await s.login(a);
 const storage=s.store(a);
 await storage.put("private:owner_anketa_library:"+a,{value:"[]",expires:0});
 s.env.VISITORS_KV.get=async()=>{throw Error("KV offline");};
 const result=await s.run(a,"owner_anketa:open");assert.equal(result.handled,true);
 // The complete flow is not allowed to publish when the coordinator is absent.
 const engine=createCabinet(a),sent=[];
 await engine.handleOwnerAnketa(s.update(a,"owner_anketa:open"),{VISITORS_KV:{get:async()=>null,put:async()=>{}},__cabinetAuthorized:a},async(e,m,p)=>{sent.push(p);});
 assert.match(sent.at(-1).text,/баланс/);
});

test("rollout switches block new client work and new submissions while preserving accepted results",async()=>{
 const s=setup();await s.create(a);await s.login(a);s.env.CABINET_CLIENTS_ENABLED="false";
 assert.equal((await s.run(a,"owner_anketa:new")).handled,true);assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/обслуживании/);
 const denied=await cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"dryfill",url:"https://x/payload?nonce=aaaaaaaaaaaa&profile_id="+profile,method:"GET",headers:{Authorization:"Bearer callback"},body:null}},s.send);
 assert.equal(denied.status,403);
 s.env.CABINET_CLIENTS_ENABLED="true";s.env.CABINET_PUBLICATIONS_ENABLED="false";
 await s.run(a,"owner_anketa:publish_confirm:aaaaaaaaaaaa");assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/приостановлены/);
});
