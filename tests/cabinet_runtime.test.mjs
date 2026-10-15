import test from "node:test";
import assert from "node:assert/strict";
import {OrderReminder} from "../src/reminders.js";
import {registry,pinRecord} from "../src/client_registry.js";
import {cabinetEvent,privateActor,cabinetEndpoint} from "../src/cabinet_runtime.js";
import {createCabinet} from "../src/owner_anketa.js";
import {credits} from "../src/publication_credits.js";
import {claimPublication} from "../src/publication_claim.js";
globalThis.fetch=async()=>new Response("Mock external service unavailable",{status:503});
const owner="5866034656",a="123456789",b="987654321",profile="771053";
function memory(){const map=new Map();return {map,async get(k){return structuredClone(map.get(k));},async put(k,v){map.set(k,structuredClone(v));},async delete(k){map.delete(k);},async setAlarm(){},async deleteAlarm(){}};}
function setup(){
 const kv=new Map(),objects=new Map();const env={BOT_TOKEN:"test-token",ANKETA_CALLBACK_TOKEN:"callback",VISITORS_KV:{async get(k,format){const v=kv.get(k)??null;return format==="json"&&v!==null?JSON.parse(v):v;},async put(k,v){kv.set(k,v);},async delete(k){kv.delete(k);}}};
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
 const create=async(uid,pin="777777",grant=3)=>registry(env,{action:"create",actorId:owner,userId:uid,credential:await pinRecord(pin),grant,operation:uid.padStart(16,"a")});
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
 const calls=[];const original=globalThis.fetch;
 globalThis.fetch=async(url,opt)=>{calls.push({url:String(url),opt});if(String(url).includes("/dispatches"))return new Response(null,{status:204});return new Response("missing",{status:404});};
 try{
  const url="https://b.intimcity.rip/indi/anketa"+profile+".htm";
  await s.run(a,url);
  let state=JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);
  assert.equal(state.step,"loading");
  assert.equal(JSON.parse(calls.find(x=>x.url.includes("dispatches")).opt.body).inputs.user_id,a);
  const result={user_id:a,profile_id:profile,nonce:state.nonce,mode:"profile",status:"found",profile:{id:profile,name:"Anna",age:28,metro:"Центр",url}};
  const deliver=value=>cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"result",url:"https://worker/api/anketa/result",method:"POST",headers:{Authorization:"Bearer callback"},body:JSON.stringify(value)}},s.send);
  assert.equal((await deliver({...result,nonce:"bbbbbbbbbbbb"})).status,409);
  assert.equal((await deliver(result)).status,200);
  state=JSON.parse(s.store(a).map.get("private:owner_anketa_state:"+a).value);assert.equal(state.step,"confirm");
  await s.run(a,"owner_anketa:confirm:"+state.nonce);
  const saved=JSON.parse(s.store(a).map.get("private:owner_anketa_saved:"+a+":"+profile).value);
  assert.equal(saved.confirmed,true);assert.equal(saved.profile.name,"Anna");
  assert.equal((await deliver(result)).status,409);
  const before=calls.filter(x=>x.url.includes("dispatches")).length;await s.run(a,url);
  assert.equal(calls.filter(x=>x.url.includes("dispatches")).length,before);
  assert.equal(s.store(b).map.has("private:owner_anketa_saved:"+a+":"+profile),false);
 }finally{globalThis.fetch=original;}
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
  const before=s.sent.length;await s.run(a,"owner_anketa:home");
  assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/ВАШ ЛИМИТ ИСЧЕРПАН/);
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
 for(const action of ["owner_anketa:home","owner_anketa:saved:"+profile,"owner_anketa:savedreview:"+profile,"owner_anketa:proofthanks:"+profile]){
  await s.run(a,action);
  const p=latest();assert.match(p.text,/ВАШ ЛИМИТ ИСЧЕРПАН/);
  assert.ok(buttons(p).some(x=>x.callback_data==="owner_anketa:balance_empty:"+profile));
  assert.ok(!buttons(p).some(x=>/:(?:new|savedreview|savedrating):?/.test(x.callback_data||"")));
  assert.ok(!JSON.stringify(p).includes("222333"));
 }
 const update={callback_query:{id:"general",from:{id:a},message:{message_id:22,chat:{id:a,type:"private"}},data:"services"}};
 assert.equal((await cabinetEvent(s.store(a),s.env,{userId:a,event:{kind:"update",update}},s.send)).handled,true);
 assert.match(latest().text,/ВАШ ЛИМИТ ИСЧЕРПАН/);
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
 assert.match(s.sent.filter(x=>x.payload.text).at(-1).payload.text,/Telegram ID клиента/);
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
