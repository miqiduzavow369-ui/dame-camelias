import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import worker,{ManStagingAccounts} from "../src/man_staging_worker.js";
import {STAGING_DASHBOARD_HTML} from "../src/man_staging_dashboard.js";
import {enqueueMockManTask} from "../src/man_mock_queue.js";

const OWNER="5866034656",TOKEN="fixture-staging-auth", OTHER="5866034657";
function signed(uid){
 const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(uid),first_name:"Fixture"})});
 const data=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const secret=createHmac("sha256","WebAppData").update(TOKEN).digest();
 p.set("hash",createHmac("sha256",secret).update(data).digest("hex"));
 return p.toString();
}
function storage(){
 const data=new Map();let tail=Promise.resolve();
 const tx=async fn=>{
  const next=tail.then(async()=>{
   const staged=new Map(data);
   const result=await fn({get:async k=>staged.get(k),put:async(k,v)=>{staged.set(k,v)}});
   data.clear();for(const [k,v]of staged)data.set(k,v);
   return result;
  });tail=next.catch(()=>{});return next;
 };
 const list=async({prefix="",limit=1000}={})=>{
  const found=new Map();
  for(const [k,v] of data)if(k.startsWith(prefix)){found.set(k,v);if(found.size>=limit)break}
  return found;
 };
 return {get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),transaction:tx,list,snapshot:()=>new Map(data)};
}
function fixture(){
 const stored=storage(),instance=new ManStagingAccounts({storage:stored});
 const env={
  MAN_STAGING_ONLY:"true",CABINET_PUBLICATIONS_ENABLED:"false",CABINET_CLIENTS_ENABLED:"false",
  MAN_STAGING_BOT_TOKEN:TOKEN,
  MAN_STAGING_ACCOUNTS:{
   idFromName:key=>key,
   get:()=>({fetch:(url,init)=>instance.fetch(new Request(url,init))})
  }
 };
 const request=(body,method="POST")=>new Request("https://isolated.example/api/man-staging",{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const call=async(action,fields={},uid=OWNER)=>{
  const res=await worker.fetch(request({action,initData:signed(uid),...fields}),env);
  return {status:res.status,data:await res.json()};
 };
 return {stored,call,env};
}
test("staging queue owner creates and views simulated job only",async()=>{
 const h=fixture();
 const created=await h.call("mock_seed",{accountId:"yan_second",profileId:"652282",kind:"rating"});
 assert.equal(created.status,200);
 assert.equal(created.data.ok,true);
 assert.equal(created.data.created,true);
 assert.equal(created.data.simulationOnly,true);
 assert.equal(created.data.sitePublished,false);
 const queue=await h.call("mock_queue",{accountId:"yan_second"});
 assert.equal(queue.status,200);
 assert.equal(queue.data.items.length,1);
 assert.equal(queue.data.items[0].status,"queued");
 assert.ok(!JSON.stringify(queue.data).includes("serverActivation"));
 const otherMan=await h.call("mock_queue",{accountId:"yan_03"});
 assert.deepEqual(otherMan.data.items,[]);
});
test("completion and replays cannot imply publication or change final outcome",async()=>{
 const h=fixture();
 const seed=await h.call("mock_seed",{accountId:"yan_03",profileId:"652282",kind:"review"});
 const correlationKey=seed.data.correlationKey;
 const done=await h.call("mock_finish",{correlationKey,outcome:"mock_success"});
 assert.equal(done.status,200);assert.equal(done.data.status,"completed");
 assert.equal(done.data.sitePublished,false);assert.equal(done.data.creditsDebited,false);
 const again=await h.call("mock_finish",{correlationKey,outcome:"mock_success"});
 assert.equal(again.status,200);assert.equal(again.data.changed,false);
 const altered=await h.call("mock_finish",{correlationKey,outcome:"mock_rejected"});
 assert.equal(altered.status,409);
 const listed=await h.call("mock_queue",{accountId:"yan_03"});
 assert.equal(listed.data.items[0].status,"completed");
});
test("legacy account, unknown men and site-publish commands are rejected",async()=>{
 const h=fixture();
 for(const accountId of ["yan_first","yan_31","yan_02"]){
  const res=await h.call("mock_seed",{accountId,profileId:"652282",kind:"rating"});
  assert.equal(res.status,409);
 }
 const publish=await h.call("publish",{accountId:"yan_second"});
 assert.equal(publish.status,400);
 assert.equal(h.stored.snapshot().size,0);
});
test("nonowner, malformed and absent Telegram signature cannot access queue",async()=>{
 const h=fixture();
 assert.equal((await h.call("mock_queue",{},OTHER)).status,403);
 assert.equal((await h.call("mock_seed",{accountId:"yan_second",profileId:"652282",kind:"rating"},OTHER)).status,403);
 const res=await worker.fetch(new Request("https://isolated.example/api/man-staging",{
  method:"POST",body:JSON.stringify({action:"mock_queue",initData:"broken"})
 }),h.env);
 assert.equal(res.status,403);
 assert.equal(h.stored.snapshot().size,0);
});
test("staging premium queue UI exists only at test route and carries no secrets",async()=>{
 const h=fixture();
 const res=await worker.fetch(new Request("https://isolated.example/test-admin"),h.env);
 assert.equal(res.status,200);
 assert.match(res.headers.get("Content-Type"),/text\/html/);
 const html=await res.text();
 assert.equal(html,STAGING_DASHBOARD_HTML);
 assert.match(html,/SIMULATION ONLY/);
 assert.ok(!html.includes(TOKEN));
 assert.ok(html.includes("/api/man-staging"));
 assert.ok(!html.includes("api.telegram.org"));
 const missing=await worker.fetch(new Request("https://isolated.example/admin"),h.env);
 assert.equal(missing.status,404);
});

test("owner may complete yesterday's simulated task without changing its quota day",async()=>{
 const h=fixture();
 const created=await enqueueMockManTask(h.stored,{
  actorId:OWNER,ownerId:OWNER,
  identity:{userId:OWNER,accountId:"yan_second",profileId:"652282",kind:"review",nonce:"abcdef123456"},
  moscowDate:"2026-10-17",at:100,
  serverActivation:{accountId:"yan_second",enabled:true,siteIdentityVerified:true,proxyVerified:true,version:1}
 });
 const done=await h.call("mock_finish",{correlationKey:created.correlationKey,outcome:"mock_success"});
 assert.equal(done.status,200);
 assert.equal(done.data.status,"completed");
 const [record]=[...h.stored.snapshot().values()];
 assert.equal(record.moscowDate,"2026-10-17");
 assert.equal(done.data.sitePublished,false);
});
