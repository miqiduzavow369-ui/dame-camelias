import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHmac} from "node:crypto";
import worker,{ManStagingAccounts} from "../src/man_staging_worker.js";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const env={MAN_STAGING_ONLY:"true",CABINET_PUBLICATIONS_ENABLED:"false",CABINET_CLIENTS_ENABLED:"false"};
const makeRequest=body=>new Request("https://isolated.test/api/man-staging",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const TOKEN="fixture-staging-token-never-used-in-production", OWNER="5866034656";
function sign(uid){
 const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(uid),first_name:"Fixture"})});
 const check=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const secret=createHmac("sha256","WebAppData").update(TOKEN).digest();
 params.set("hash",createHmac("sha256",secret).update(check).digest("hex"));
 return params.toString();
}
function storage(){
 const m=new Map();let queue=Promise.resolve();
 return {
  get:async k=>m.get(k),
  transaction(fn){
   const job=queue.then(async()=>{
    const copy=new Map(m);
    const result=await fn({get:async k=>copy.get(k),put:async(k,v)=>{copy.set(k,v)}});
    m.clear();for(const [k,v] of copy)m.set(k,v);
    return result;
   });
   queue=job.catch(()=>{});
   return job;
  }
 };
}
function harness(){
 const account=new ManStagingAccounts({storage:storage()});
 const bindings={...env,MAN_STAGING_BOT_TOKEN:TOKEN,MAN_STAGING_ACCOUNTS:{
  idFromName:name=>name,
  get:()=>({fetch:(url,request)=>account.fetch(new Request(url,request))})
 }};
 return {call:async(action,extra={},uid=OWNER)=>{
  const response=await worker.fetch(makeRequest({action,initData:sign(uid),...extra}),bindings);
  return {status:response.status,data:await response.json()};
 }};
}
test("staging config cannot bind production customer state or publish",()=>{
 const cfg=read("wrangler.man-staging.toml");
 assert.match(cfg,/name = "dame-camelias-man-staging"/);
 assert.match(cfg,/class_name = "ManStagingAccounts"/);
 assert.doesNotMatch(cfg,/a323fba4c8c84a7fb37e1e6a3a8264aa/);
 assert.doesNotMatch(cfg,/VISITORS_KV|ORDER_REMINDERS|secrets\.|routes\s*=/);
 assert.match(cfg,/CABINET_PUBLICATIONS_ENABLED = "false"/);
 const code=read("src/man_staging_worker.js");
 assert.doesNotMatch(code,/intimcity_profile_lookup|github\.com\/repos|api\.telegram\.org/);
 assert.match(code,/"PROXY_PASSWORD" in env/);
});
test("staging fails closed without separate staging bot secret",async()=>{
 const res=await worker.fetch(makeRequest({action:"list",initData:sign(OWNER)}),env);
 assert.equal(res.status,503);
});
test("staging rejects nonowner and accepts owner read",async()=>{
 const h=harness();
 assert.equal((await h.call("list",{},"5866034657")).status,403);
 const list=await h.call("list");
 assert.equal(list.status,200);
 assert.equal(list.data.accounts.length,30);
 assert.equal(list.data.accounts[0].setup,null);
});
test("staging owner planning changes remain isolated and reversible",async()=>{
 const h=harness();
 const first=await h.call("draft",{accountId:"yan_second",setupAction:"plan",expectedVersion:0});
 assert.equal(first.status,200);
 assert.equal(first.data.setup.stage,"awaiting_credentials");
 assert.equal(first.data.setup.canPublish,false);
 const hist=await h.call("history",{accountId:"yan_second"});
 assert.equal(hist.data.items.length,1);
 const elsewhere=await h.call("history",{accountId:"yan_30"});
 assert.equal(elsewhere.data.items.length,0);
 const conflict=await h.call("draft",{accountId:"yan_second",setupAction:"plan",expectedVersion:0});
 assert.equal(conflict.status,409);
 const reset=await h.call("draft",{accountId:"yan_second",setupAction:"reset",expectedVersion:1});
 assert.equal(reset.status,200);
 assert.equal(reset.data.setup.stage,"not_configured");
});
test("staging has no legacy man setup or activation action",async()=>{
 const h=harness();
 assert.equal((await h.call("draft",{accountId:"yan_first",setupAction:"plan",expectedVersion:0})).status,409);
 assert.equal((await h.call("draft",{accountId:"yan_03",setupAction:"activate",expectedVersion:0})).status,409);
 assert.equal((await h.call("publish")).status,400);
});

test("staging rejects oversized bodies even without Content-Length",async()=>{
 const extra="X".repeat(17000);
 const req=new Request("https://isolated.test/api/man-staging",{
  method:"POST",body:JSON.stringify({action:"list",initData:sign(OWNER),extra})
 });
 // Request has no Content-Length in Node fetch, so the byte cap is essential.
 assert.equal(req.headers.get("content-length"),null);
 const bindings={...env,MAN_STAGING_BOT_TOKEN:TOKEN,MAN_STAGING_ACCOUNTS:{
  idFromName:name=>name,get:()=>({fetch:()=>{throw Error("oversized body reached DO")}})
 }};
 const res=await worker.fetch(req,bindings);
 assert.equal(res.status,413);
});
test("staging rejects oversized UTF-8 bodies by bytes, not character count",async()=>{
 const payload="я".repeat(8500);
 const req=new Request("https://isolated.test/api/man-staging",{
  method:"POST",body:JSON.stringify({action:"list",initData:sign(OWNER),extra:payload})
 });
 const bindings={...env,MAN_STAGING_BOT_TOKEN:TOKEN,MAN_STAGING_ACCOUNTS:{
  idFromName:name=>name,get:()=>({fetch:()=>{throw Error("oversized body reached DO")}})
 }};
 const res=await worker.fetch(req,bindings);
 assert.equal(res.status,413);
});
test("staging rejects malformed JSON and non-object input",async()=>{
 const bindings={...env,MAN_STAGING_BOT_TOKEN:TOKEN,MAN_STAGING_ACCOUNTS:{
  idFromName:name=>name,get:()=>({fetch:()=>{throw Error("invalid body reached DO")}})
 }};
 for(const body of ["{not-json","[]","null"]){
  const req=new Request("https://isolated.test/api/man-staging",{method:"POST",body});
  const res=await worker.fetch(req,bindings);
  assert.equal(res.status,400);
 }
});

test("staging refuses production Worker bindings and secrets even with owner signature",async()=>{
 const legitimate={...env,MAN_STAGING_BOT_TOKEN:TOKEN,MAN_STAGING_ACCOUNTS:{
  idFromName: name=>name,
  get:()=>({fetch:()=>{throw Error("misconfigured staging reached storage")}})
 }};
 for(const key of [
  "ORDER_REMINDERS","VISITORS_KV","BOT_TOKEN","ANKETA_CALLBACK_TOKEN",
  "INTIMCITY_LOGIN","INTIMCITY_PASSWORD","PROXY_PASSWORD"
 ]){
  const bindings={...legitimate,[key]:key==="BOT_TOKEN"?TOKEN:{}};
  const response=await worker.fetch(makeRequest({action:"list",initData:sign(OWNER)}),bindings);
  assert.equal(response.status,503,"unsafe production binding must be rejected: "+key);
  assert.equal((await response.json()).reason,"staging_unconfigured");
 }
});
test("staging refuses nonstring token without reaching Durable Object",async()=>{
 const bindings={...env,MAN_STAGING_BOT_TOKEN:{value:"wrong"},MAN_STAGING_ACCOUNTS:{
  idFromName:name=>name,
  get:()=>({fetch:()=>{throw Error("invalid token reached storage")}})
 }};
 const response=await worker.fetch(makeRequest({action:"list",initData:sign(OWNER)}),bindings);
 assert.equal(response.status,503);
});

test("health and staging page fail closed until separate staging credentials exist",async()=>{
 for(const pathname of ["/health","/test-admin"]){
  const response=await worker.fetch(new Request("https://isolated.test"+pathname),env);
  assert.equal(response.status,503);
  assert.equal((await response.json()).reason,"staging_unconfigured");
  assert.equal(response.headers.get("cache-control"),"no-store");
 }
});
test("health is truthful when staging configuration is isolated and safe",async()=>{
 const safe={...env,MAN_STAGING_BOT_TOKEN:TOKEN,
  MAN_STAGING_ACCOUNTS:{idFromName:name=>name,get:()=>({fetch:()=>{throw Error("unexpected DO access")}})}};
 const response=await worker.fetch(new Request("https://isolated.test/health"),safe);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true,environment:"man-staging",publicationEnabled:false});
 assert.equal(response.headers.get("cache-control"),"no-store");
});
test("health, HTML and API refuse production resources without revealing secret values",async()=>{
 const base={...env,MAN_STAGING_BOT_TOKEN:TOKEN,
  MAN_STAGING_ACCOUNTS:{idFromName:name=>name,get:()=>({fetch:()=>{throw Error("DO must not run")}})}};
 for(const forbidden of ["ORDER_REMINDERS","VISITORS_KV","BOT_TOKEN","INTIMCITY_PASSWORD","PROXY_PASSWORD"]){
  const bindings={...base,[forbidden]:"CANARY-NEVER-DISCLOSE"};
  for(const pathname of ["/health","/test-admin"]){
   const response=await worker.fetch(new Request("https://isolated.test"+pathname),bindings);
   assert.equal(response.status,503,pathname+" unsafe: "+forbidden);
   assert.ok(!(await response.text()).includes("CANARY-NEVER-DISCLOSE"));
  }
  const response=await worker.fetch(makeRequest({action:"list",initData:sign(OWNER)}),bindings);
  assert.equal(response.status,503);
 }
});
test("staging cannot claim readiness with malformed Durable Object binding",async()=>{
 const unsafe={...env,MAN_STAGING_BOT_TOKEN:TOKEN,MAN_STAGING_ACCOUNTS:{}};
 for(const pathname of ["/health","/test-admin"]){
  const response=await worker.fetch(new Request("https://isolated.test"+pathname),unsafe);
  assert.equal(response.status,503);
 }
});

test("staging refuses unknown environment variables and aliased production bindings",async()=>{
 const base={...env,MAN_STAGING_BOT_TOKEN:TOKEN,
  MAN_STAGING_ACCOUNTS:{idFromName:name=>name,get:()=>({fetch:()=>{throw Error("should not reach storage")}})}};
 for(const key of ["SOME_EXTRA_CONFIG","RENAMED_CUSTOMER_KV","PRODUCTION_DO_ALIAS","UNREVIEWED_TOKEN"]){
  const unsafe={...base,[key]:"CANARY-DO-NOT-DISCLOSE"};
  for(const pathname of ["/health","/test-admin"]){
   const result=await worker.fetch(new Request("https://isolated.test"+pathname),unsafe);
   assert.equal(result.status,503,key);
   assert.equal((await result.json()).reason,"staging_unconfigured");
  }
  const result=await worker.fetch(makeRequest({action:"list",initData:sign(OWNER)}),unsafe);
  assert.equal(result.status,503);
  assert.ok(!(await result.text()).includes("CANARY-DO-NOT-DISCLOSE"));
 }
});
