import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {webcrypto} from "node:crypto";
import {startProfileProbe,profileProbeStatus,claimProfileProbe,completeProfileProbe} from "../src/secondary_man_profile_probe.js";
const ids=["yan_second",...Array.from({length:28},(_,i)=>"yan_"+String(i+3).padStart(2,"0"))];
function db(){
 const m=new Map(),tx={get:async k=>m.get(k),put:async(k,v)=>{m.set(k,v)},transaction:async fn=>fn(tx)};
 return {tx,m};
}
const startArgs=accountId=>({
 accountId,profileId:"2468",at:10000,
 approval:{accountId,approved:true,version:1,proxyVersion:2,siteVersion:3},
 proxy:{version:2,proxyVerified:true,ipVerified:true},
 site:{version:3,siteUrl:"https://b.intimcity.rip/",proxyReady:true},
 login:{technicalReady:true},dispatch:async p=>({ok:p.accountId===accountId&&p.profileId==="2468"})
});
test("all 29 men can launch their own read-only search but never Yan First",async()=>{
 for(const id of ids){
  const {tx}=db(),req=startArgs(id);
  const started=await startProfileProbe(tx,req);
  assert.equal(started.status,"running");
  assert.equal((await profileProbeStatus(tx,id)).profileId,"2468");
  await assert.rejects(()=>startProfileProbe(tx,{...req,at:12000}),/already running/);
  for(const override of [
   {login:{technicalReady:false}},
   {proxy:{...req.proxy,ipVerified:false}},
   {site:{...req.site,proxyReady:false}},
   {approval:{...req.approval,approved:false}}
  ])await assert.rejects(()=>startProfileProbe(db().tx,{...req,...override}),/prerequisites/);
 }
 await assert.rejects(()=>startProfileProbe(db().tx,startArgs("yan_first")),/immutable/);
});
test("read-only claim consumes the exact account and nonce and protects credentials",async()=>{
 const {tx,m}=db(),accountId="yan_second",args=startArgs(accountId),proxyKey="1".repeat(64),siteKey="2".repeat(64);
 const run=await startProfileProbe(tx,args);
 assert.equal(run.ok,true);
 const key="secondary-profile-probe-v1:"+accountId;
 const saved=await tx.get(key);
 const seal=async(hex,obj,aad)=>{
  const k=await webcrypto.subtle.importKey("raw",Uint8Array.from(hex.match(/../g).map(x=>parseInt(x,16))),{name:"AES-GCM"},false,["encrypt"]);
  const iv=webcrypto.getRandomValues(new Uint8Array(12));
  const bytes=await webcrypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(aad)},k,new TextEncoder().encode(JSON.stringify(obj)));
  return {iv:Array.from(iv),sealed:Array.from(new Uint8Array(bytes))};
 };
 const proxy={protocol:"http",host:"198.51.100.12",port:6408,username:"account-proxy",password:"secret",expectedIp:"198.51.100.12"};
 const site={siteUrl:"https://b.intimcity.rip/",login:"account-email",password:"secret"};
 m.set("man-proxy-sealed-v1:"+accountId,{accountId,version:2,proxyVerified:true,ipVerified:true,expectedIp:proxy.expectedIp,
  ...await seal(proxyKey,proxy,accountId)});
 m.set("man-intimcity-sealed-v1:"+accountId,{accountId,version:3,boundProxyVersion:2,siteUrl:site.siteUrl,
  ...await seal(siteKey,site,accountId+":intimcity:2")});
 m.set("man-owner-approval-v1:"+accountId,{accountId,version:1,approved:true,proxyVersion:2,siteVersion:3});
 const env={MAN_PROXY_ENCRYPTION_KEY:proxyKey,MAN_SITE_ENCRYPTION_KEY:siteKey};
 const claim={accountId,profileId:"2468",nonce:saved.nonce,at:11000};
 await assert.rejects(()=>claimProfileProbe(tx,env,{...claim,accountId:"yan_03"}),/not authorized/);
 m.set("man-owner-approval-v1:"+accountId,{accountId,version:2,approved:false,proxyVersion:2,siteVersion:3});
 await assert.rejects(()=>claimProfileProbe(tx,env,claim),/not authorized/);
 m.set("man-owner-approval-v1:"+accountId,{accountId,version:3,approved:true,proxyVersion:2,siteVersion:3});
 const grant=await claimProfileProbe(tx,env,claim);
 assert.equal(grant.accountId,accountId);
 assert.equal(grant.mode,"profile");
 assert.equal(grant.proxyPort,6408);
 assert.equal(grant.siteLogin,"account-email");
 assert.equal(grant.proxyVersion,2);
 await assert.rejects(()=>claimProfileProbe(tx,env,claim),/not authorized/);
 await assert.rejects(()=>completeProfileProbe(tx,{...claim,code:"publish_success"}),/Invalid result/);
 const result=await completeProfileProbe(tx,{...claim,at:12000,code:"profile_verified"});
 assert.equal(result.verified,true);
 await assert.rejects(()=>completeProfileProbe(tx,{...claim,at:12000,code:"profile_verified"}),/Stale/);
});
test("secondary lookup dispatch never includes credentials in workflow inputs",()=>{
 const workflow=fs.readFileSync(".github/workflows/secondary-man-profile-probe.yml","utf8");
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 assert.match(workflow,/account_id:/);
 assert.match(workflow,/profile_id:/);
 assert.doesNotMatch(workflow,/secrets\.PROXY_PASSWORD|secrets\.INTIMCITY_PASSWORD/);
 assert.match(runtime,/inputs:\{account_id:accountId,profile_id:profileId,nonce,site_host:siteHost\}/);
 const py=fs.readFileSync("tools/secondary_man_profile_probe.py","utf8");
 assert.match(py,/run_readonly_profile_check/);
 assert.doesNotMatch(py,/run_review\(|submit\.click\(/);
});
