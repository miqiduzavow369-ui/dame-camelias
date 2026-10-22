import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {OrderReminder} from "../src/reminders.js";
import {cabinetEvent} from "../src/cabinet_runtime.js";
import worker from "../src/index.js";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
import {saveSecondaryOriginalJpeg} from "../src/secondary_man_original_screenshot.js";
import {deliverSecondaryCompletedResult} from "../src/secondary_man_result_delivery.js";
import {dailyLimit,moscowDay} from "../src/daily_publication_limit.js";
import {createHash} from "node:crypto";
import {Script,createContext} from "node:vm";
import {readFileSync} from "node:fs";
const uid="5866034656",pid="690230";
const i={userId:uid,accountId:"yan_second",profileId:pid,kind:"rating",nonce:"abcdef123456"};
const at=Date.now();
class Memory{
 map=new Map();async get(k){return structuredClone(this.map.get(k));}async put(k,v){this.map.set(k,structuredClone(v));}
 async delete(k){this.map.delete(k);}async transaction(fn){return fn(this);}async setAlarm(){}
 async list({prefix="",startAfter="",limit=1000}={}){return new Map([...this.map].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit));}
}
function initData(token){
 const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(uid)})});
 const secret=createHmac("sha256","WebAppData").update(token).digest();
 p.set("hash",createHmac("sha256",secret).update([...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n")).digest("hex"));return String(p);
}
async function fixture(){
 const storage=new Memory(),values=new Map(),objects=new Map(),calls=[];
 const kv={get:async(k,type)=>{
  if(Array.isArray(k))return new Map(k.map(n=>[n,values.get(n)||null]));
  const v=values.get(k)??null;return type==="json"&&typeof v==="string"?JSON.parse(v):v;
 },put:async(k,v)=>values.set(k,v),list:async({prefix})=>({keys:[...values.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})};
 const env={BOT_TOKEN:"synthetic-token",VISITORS_KV:kv,ANKETA_CALLBACK_TOKEN:"synthetic-callback",ORDER_REMINDERS:{idFromName:x=>x,get:name=>({fetch:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({name,type:body.type});
  if(body.type==="cabinet_event")return Response.json(await cabinetEvent(storage,env,body));
  if(body.type==="registry")return Response.json({ok:true});
  if(!objects.has(name))objects.set(name,new OrderReminder({storage:new Memory(),blockConcurrencyWhile:fn=>fn()},env));
  return objects.get(name).fetch(new Request(url,options));
 }})}};
 const jpeg=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(100),Buffer.from([255,217])]);
 const fileId="jpeg_"+createHash("sha256").update(jpeg).digest("hex").slice(0,40);
 await saveSecondaryOriginalJpeg(kv,i,{base64:jpeg.toString("base64"),expectedProofFileId:fileId,at});
 const key=scope=>manStorageKey({...i,scope})+":rating";
 await storage.put(key("publication"),{identity:createAccountOperation(i),status:"completed",attempted:true,proxyVersion:2,siteVersion:3});
 await storage.put(key("proof")+":"+i.nonce+":settlement",{identity:createAccountOperation(i),status:"completed",ledgerStatus:"completed",at,proofFileId:fileId,sitePublicationId:"site-existing-proof"});
 await storage.put(key("history")+":"+i.nonce,{...i,at,proofFileId:fileId,sitePublicationId:"site-existing-proof"});
 values.set("owner_anketa_library:"+uid,JSON.stringify([pid]));
 values.set("owner_anketa_saved:"+uid+":"+pid,JSON.stringify({confirmed:true,profile:{id:pid,name:"Саффи"},host:"c.intimcity.rip"}));
 return {storage,env,values,objects,calls,jpeg};
}
test("existing completed result sends exact JPEG once, records daily once and never spends again",async()=>{
 const f=await fixture();const requests=[],before=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  requests.push(url);assert.match(url,/\/sendPhoto$/);
  assert.equal(options.body.get("chat_id"),"-1003900552612");
  assert.match(options.body.get("caption"),/Михаил Корсаков/);
  assert.deepEqual(Buffer.from(await options.body.get("photo").arrayBuffer()),f.jpeg);
  return Response.json({ok:true,result:{message_id:1234}});
 };
 try{
  assert.equal((await deliverSecondaryCompletedResult(f.storage,f.env,i)).status,"sent");
  assert.equal((await deliverSecondaryCompletedResult(f.storage,f.env,i)).status,"sent");
  assert.equal(requests.length,1);
  const daily=await dailyLimit(f.env,uid,pid,"status");assert.equal(daily.remaining,1);
  assert.ok(f.calls.every(c=>!c.type.startsWith("credits_")));
 }finally{globalThis.fetch=before;}
});
test("failed proof or ambiguous group delivery cannot repeat a post or send",async()=>{
 const f=await fixture(),before=globalThis.fetch;let sends=0;
 globalThis.fetch=async()=>{sends++;throw Error("connection lost after send");};
 try{
  assert.equal((await deliverSecondaryCompletedResult(f.storage,f.env,i)).status,"uncertain");
  assert.equal((await deliverSecondaryCompletedResult(f.storage,f.env,i)).status,"uncertain");assert.equal(sends,1);
  await assert.rejects(()=>deliverSecondaryCompletedResult(f.storage,f.env,{...i,accountId:"yan_03"}),/proof/);
  await assert.rejects(()=>deliverSecondaryCompletedResult(f.storage,f.env,{...i,userId:"123456789"}),/proof/);
  assert.equal(sends,1);
 }finally{globalThis.fetch=before;}
});
test("real HTTP snapshot forwards completed man's status even with no draft index",async()=>{
 const f=await fixture();
 const response=await worker.fetch(new Request("https://example.test/api/anketa/mini-preview",{method:"POST",body:JSON.stringify({initData:initData(f.env.BOT_TOKEN)})}),f.env,{});
 assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.secondaryStatuses[pid].yan_second.rating,"published");
 assert.equal(result.history.find(x=>x.account==="yan_second").hasProof,true);
 assert.notEqual(result.profiles[0].capabilities.rating.state,"published");
});
test("real HTTP proof uses original bytes and never calls Telegram getFile for JPEG IDs",async()=>{
 const f=await fixture(),before=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error("Telegram must not be used to open private JPEG");};
 try{
  const response=await worker.fetch(new Request("https://example.test/api/anketa/mini-proof",{method:"POST",body:JSON.stringify({initData:initData(f.env.BOT_TOKEN),profileId:pid,kind:"rating",account:"yan_second"})}),f.env,{});
  assert.equal(response.status,200);assert.equal(response.headers.get("Content-Type"),"image/jpeg");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.jpeg);
 }finally{globalThis.fetch=before;}
});
test("daily secondary records are account-scoped and legacy records retain original key",async()=>{
 const f=await fixture(),date=moscowDay();
 await dailyLimit(f.env,uid,pid,"reserve","rating","111111111111",date);
 await dailyLimit(f.env,uid,pid,"complete","rating","111111111111",date);
 assert.equal((await dailyLimit(f.env,uid,pid,"record_verified","rating",i.nonce,date,"yan_second")).remaining,0);
 assert.equal((await dailyLimit(f.env,uid,pid,"record_verified","rating",i.nonce,date,"yan_second")).remaining,0);
 const db=f.objects.get("daily-profile:"+pid+":"+date).ctx.storage;
 const records=await db.get("daily_claims");assert.equal(Object.keys(records).length,2);
 assert.equal(records["rating:"+pid+":"+uid].nonce,"111111111111");
});
test("finance display prefers the account stored in the actual spend over same-profile legacy history",()=>{
 const html=readFileSync("anketa/mini-preview.html","utf8");
 const line=html.split("\n").find(x=>x.includes("const man=e.accountId"));
 const code=line.trim()+" result=man;";
 const context=createContext({e:{profileId:pid,kind:"rating",accountId:"yan_second"},history:[{id:pid,kind:"rating",account:"yan_first"}],result:null});
 new Script(code).runInContext(context);assert.equal(context.result,"yan_second");
});
