import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {saveProxy,proxyStatus} from "../src/man_proxy_vault.js";
import {startBrowserCheck,claimBrowserCheck,completeBrowserCheck,browserCheckStatus} from "../src/man_browser_preflight.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const env={MAN_PROXY_ENCRYPTION_KEY:"ab".repeat(32)};
const actor={actorId:"12345",cabinetId:"12345",ownerId:"12345",accountId:"yan_second"};
const settings={protocol:"http",host:"45.39.104.69",port:6408,
 username:"proxy",password:"super-secret",expectedIp:"45.39.104.69"};
function fixture(){
 const data=new Map();
 const store={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),
  transaction:async fn=>fn(store)};
 return {store,data};
}
async function setup(){
 const f=fixture();
 await saveProxy(f.store,env,{...actor,expectedVersion:0,at:1,settings});
 return f;
}
test("one-time owner start claims credentials only via runner and checks IP, no activation",async()=>{
 const {store,data}=await setup();
 let args=null;
 const started=await startBrowserCheck(store,env,{...actor,expectedVersion:1,
  siteUrl:"https://b.intimcity.rip/",at:1000},async x=>{args=x;return true});
 assert.equal(started.status,"running");
 assert.equal(args.accountId,"yan_second");
 assert.equal(args.host,"b.intimcity.rip");
 assert.ok(!JSON.stringify(args).includes(settings.password));
 const claimed=await claimBrowserCheck(store,env,{accountId:args.accountId,nonce:args.nonce,at:1001});
 assert.equal(claimed.proxyPassword,settings.password);
 await assert.rejects(claimBrowserCheck(store,env,{accountId:args.accountId,nonce:args.nonce,at:1002}),/Unavailable/);
 const finished=await completeBrowserCheck(store,{accountId:args.accountId,nonce:args.nonce,
  at:1003,code:"verified",observedIp:settings.expectedIp,siteReachable:true});
 assert.equal(finished.ipVerified,true);
 assert.equal(finished.canPublish,false);
 const status=await proxyStatus(store,actor);
 assert.equal(status.proxyVerified,true);
 assert.equal(status.ipVerified,true);
 assert.equal(data.get("man-proxy-sealed-v1:yan_second").enabled,false);
 assert.equal(data.get("man-proxy-sealed-v1:yan_second").siteIdentityVerified,false);
 assert.equal((await browserCheckStatus(store,actor)).status,"verified");
 assert.ok(!JSON.stringify(finished).includes(settings.password));
});
test("wrong IP, site refusal and unclaimed callbacks never verify",async()=>{
 for(const [result,ip,site] of [["ip_mismatch","45.39.104.70",false],
   ["verified","45.39.104.70",true],["verified","45.39.104.69",false]]){
  const {store}=await setup();
  let args;
  await startBrowserCheck(store,env,{...actor,expectedVersion:1,
   siteUrl:"https://b.intimcity.rip/",at:1000},async x=>(args=x,true));
  await assert.rejects(completeBrowserCheck(store,{accountId:args.accountId,nonce:args.nonce,
   at:1001,code:result,observedIp:ip,siteReachable:site}),/Stale result/);
  await claimBrowserCheck(store,env,{accountId:args.accountId,nonce:args.nonce,at:1002});
  const finished=await completeBrowserCheck(store,{accountId:args.accountId,nonce:args.nonce,
   at:1003,code:result,observedIp:ip,siteReachable:site});
  assert.equal(finished.ipVerified,false);
  assert.equal((await proxyStatus(store,actor)).ipVerified,false);
 }
});
test("legacy, wrong owner, arbitrary URL and new proxy version cannot run",async()=>{
 const {store}=await setup(),dispatch=async()=>{throw Error("must not run")};
 await assert.rejects(startBrowserCheck(store,env,{...actor,accountId:"yan_first",
  expectedVersion:1,siteUrl:"https://b.intimcity.rip/",at:2},dispatch),/Forbidden/);
 await assert.rejects(startBrowserCheck(store,env,{...actor,actorId:"attacker",
  expectedVersion:1,siteUrl:"https://b.intimcity.rip/",at:2},dispatch),/Forbidden/);
 await assert.rejects(startBrowserCheck(store,env,{...actor,
  expectedVersion:1,siteUrl:"https://evil.example/",at:2},dispatch),/Invalid request/);
 await assert.rejects(startBrowserCheck(store,env,{...actor,
  expectedVersion:2,siteUrl:"https://b.intimcity.rip/",at:2},dispatch),/Proxy changed/);
});
test("dispatch failure is visible and never claims verification",async()=>{
 const {store}=await setup();
 const result=await startBrowserCheck(store,env,{...actor,expectedVersion:1,
  siteUrl:"https://b.intimcity.rip/",at:1000},async()=>false);
 assert.equal(result.ok,false);
 assert.equal((await browserCheckStatus(store,actor)).status,"dispatch_failed");
 assert.equal((await proxyStatus(store,actor)).ipVerified,false);
});

test("specific dispatch failure is persisted without enabling a man",async()=>{
 const {store}=await setup();
 const result=await startBrowserCheck(store,env,{...actor,expectedVersion:1,
  siteUrl:"https://b.intimcity.rip/",at:1000},async()=>({ok:false,reason:"github_forbidden"}));
 assert.equal(result.reason,"github_forbidden");
 const status=await browserCheckStatus(store,actor);
 assert.equal(status.status,"dispatch_failed");
 assert.equal(status.code,"github_forbidden");
 assert.equal(status.canPublish,false);
 assert.equal((await proxyStatus(store,actor)).ipVerified,false);
});
test("successful structured dispatch still runs without verification",async()=>{
 const {store}=await setup();
 const result=await startBrowserCheck(store,env,{...actor,expectedVersion:1,
  siteUrl:"https://b.intimcity.rip/",at:1000},async()=>({ok:true}));
 assert.equal(result.status,"running");
 assert.equal(result.canPublish,false);
 assert.equal((await proxyStatus(store,actor)).ipVerified,false);
});

test("unclaimed stalled IP verification safely retries without resaving proxy",async()=>{
 const {store}=await setup();
 let previous,current;
 await startBrowserCheck(store,env,{...actor,expectedVersion:1,
   siteUrl:"https://b.intimcity.rip/",at:10000},async input=>(previous=input,true));
 await assert.rejects(startBrowserCheck(store,env,{...actor,expectedVersion:1,
   siteUrl:"https://b.intimcity.rip/",at:10000+1000,retry:true},async()=>true),/Already running/);
 const again=await startBrowserCheck(store,env,{...actor,expectedVersion:1,
   siteUrl:"https://b.intimcity.rip/",at:10000+91000,retry:true},async input=>(current=input,true));
 assert.equal(again.status,"running");
 assert.notEqual(previous.nonce,current.nonce);
 await assert.rejects(claimBrowserCheck(store,env,
  {accountId:actor.accountId,nonce:previous.nonce,at:10000+91001}),/Unavailable/);
 const claimed=await claimBrowserCheck(store,env,
  {accountId:actor.accountId,nonce:current.nonce,at:10000+91002});
 assert.equal(claimed.proxyPassword,settings.password);
 assert.equal((await proxyStatus(store,actor)).version,1);
 await assert.rejects(startBrowserCheck(store,env,{...actor,expectedVersion:1,
   siteUrl:"https://b.intimcity.rip/",at:10000+181000,retry:true},async()=>true),/Already running/);
});
test("claimed IP verification can restart after expiry but never in parallel",async()=>{
 const {store}=await setup();
 let nonce;
 await startBrowserCheck(store,env,{...actor,expectedVersion:1,
  siteUrl:"https://b.intimcity.rip/",at:10000},async input=>(nonce=input.nonce,true));
 await claimBrowserCheck(store,env,{accountId:actor.accountId,nonce,at:10001});
 await assert.rejects(startBrowserCheck(store,env,{...actor,expectedVersion:1,
  siteUrl:"https://b.intimcity.rip/",at:10000+91000,retry:true},async()=>true),/Already running/);
 const newRun=await startBrowserCheck(store,env,{...actor,expectedVersion:1,
  siteUrl:"https://b.intimcity.rip/",at:10000+900001},async()=>true);
 assert.equal(newRun.status,"running");
});
