import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {handleAdminApi} from "../src/admin_app_api.js";
import {cabinetEvent} from "../src/cabinet_runtime.js";

// Integration harness: real ADMIN handler -> real cabinetEvent -> isolated memory DO.
// No Cloudflare secrets, network, Telegram messages, proxy calls or site publishing.
const OWNER="5866034656", TOKEN="fixture-bot-token-not-a-secret";
const store=()=>{
 const data=new Map();let tail=Promise.resolve();
 const state={
  get:async key=>data.get(key),put:async(key,value)=>{data.set(key,value)},
  transaction(fn){
   const job=tail.then(async()=>{
    const staged=new Map(data);
    const txn={get:async k=>staged.get(k),put:async(k,v)=>{staged.set(k,v)}};
    const result=await fn(txn);
    data.clear();for(const [k,v] of staged)data.set(k,v);
    return result;
   });
   tail=job.catch(()=>{});
   return job;
  },all:()=>new Map(data)
 };
 return state;
};
const sign=(uid,authDate=Math.floor(Date.now()/1000))=>{
 const query=new URLSearchParams({auth_date:String(authDate),user:JSON.stringify({id:Number(uid),first_name:"Test"})});
 const check=[...query.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const secret=createHmac("sha256","WebAppData").update(TOKEN).digest();
 query.set("hash",createHmac("sha256",secret).update(check).digest("hex"));
 return query.toString();
};
function harness(){
 const storage=store(),kv={get:async()=>null,put:async()=>{},delete:async()=>{}};
 const env={BOT_TOKEN:TOKEN,VISITORS_KV:kv,ORDER_REMINDERS:{
  idFromName:name=>name,get(){
   return {fetch:async(_url,request)=>{
    const input=JSON.parse(request.body);
    const result=await cabinetEvent(storage,env,input);
    return Response.json(result);
   }};
  }
 }};
 const call=async(action,uid=OWNER,extra={},initData=sign(uid))=>{
  const req=new Request("https://isolated.test/api/admin/app",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({initData,action,...extra})});
  const res=await handleAdminApi(req,env);
  return {status:res.status,data:await res.json()};
 };
 return {storage,call};
}
test("invalid and nonowner Telegram signatures cannot read inventory or mutate status",async()=>{
 const h=harness();
 const wrong=await h.call("man_accounts","5866034657");
 assert.equal(wrong.status,403);
 const tampered=await h.call("man_setup_draft",OWNER,{accountId:"yan_second",setupAction:"plan",expectedVersion:0},sign(OWNER).replace("hash=","hash=0"));
 assert.equal(tampered.status,403);
 assert.equal(h.storage.all().size,0);
});
test("ADMIN API reads all men; saves isolated draft and audit through coordinator",async()=>{
 const h=harness(),first=await h.call("man_accounts");
 assert.equal(first.status,200);
 assert.equal(first.data.accounts.length,30);
 assert.equal(first.data.accounts[0].id,"yan_first");
 assert.equal(first.data.accounts[0].setup,null);
 assert.equal(first.data.accounts[1].setup.stage,"not_configured");
 const change=await h.call("man_setup_draft",OWNER,{accountId:"yan_second",setupAction:"plan",expectedVersion:0});
 assert.equal(change.status,200);
 assert.equal(change.data.setup.canPublish,false);
 assert.equal(change.data.setup.stage,"awaiting_credentials");
 const list=await h.call("man_accounts");
 assert.equal(list.data.accounts[1].setup.version,1);
 assert.equal(list.data.accounts[29].setup.version,0);
 const history=await h.call("man_setup_history",OWNER,{accountId:"yan_second"});
 assert.equal(history.status,200);
 assert.equal(history.data.items.length,1);
 assert.equal(history.data.items[0].action,"plan");
 assert.deepEqual((await h.call("man_setup_history",OWNER,{accountId:"yan_30"})).data.items,[]);
});
test("legacy account and activation attempts are rejected without mutation",async()=>{
 const h=harness();
 for(const payload of [
  {accountId:"yan_first",setupAction:"plan",expectedVersion:0},
  {accountId:"yan_second",setupAction:"verify",expectedVersion:0},
  {accountId:"yan_second",setupAction:"activate",expectedVersion:0},
  {accountId:"yan_31",setupAction:"plan",expectedVersion:0}
 ]){
  const res=await h.call("man_setup_draft",OWNER,payload);
  assert.equal(res.status,409);
 }
 assert.equal(h.storage.all().size,0);
});
test("concurrent owner requests enforce CAS and write exactly one audit item",async()=>{
 const h=harness(),payload={accountId:"yan_second",setupAction:"plan",expectedVersion:0};
 const results=await Promise.all([h.call("man_setup_draft",OWNER,payload),h.call("man_setup_draft",OWNER,payload)]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 const log=await h.call("man_setup_history",OWNER,{accountId:"yan_second"});
 assert.equal(log.data.items.length,1);
});
