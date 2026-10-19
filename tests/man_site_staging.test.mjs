import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {saveProxy,proxyStatus} from "../src/man_proxy_vault.js";
import {saveSiteCredentialDraft,readSiteStatus,requireSiteVerification} from "../src/man_site_vault.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const env={MAN_PROXY_ENCRYPTION_KEY:"af".repeat(32),MAN_SITE_ENCRYPTION_KEY:"ae".repeat(32)};
const actor={actorId:"owner",cabinetId:"owner",ownerId:"owner",accountId:"yan_second"};
const credentials={siteUrl:"https://b.intimcity.rip/",login:"second@example.org",password:"very-secret-password"};
function fixture(){
 const m=new Map();
 const storage={get:async k=>m.get(k),put:async(k,v)=>{m.set(k,v)},transaction:async fn=>fn(storage)};
 return {storage,m};
}
async function setup(){
 const f=fixture();
 await saveProxy(f.storage,env,{...actor,at:1,expectedVersion:0,settings:{
  protocol:"http",host:"45.39.104.69",port:6408,username:"proxy",
  password:"proxy-secret",expectedIp:"45.39.104.69"
 }});
 return f;
}
test("encrypted site staging follows saved proxy but never verifies user or unlocks publications",async()=>{
 const {storage,m}=await setup();
 const result=await saveSiteCredentialDraft(storage,env,{...actor,at:2,expectedVersion:0,settings:credentials});
 assert.equal(result.configured,true);
 assert.equal(result.proxyReady,false);
 assert.equal(result.canPublish,false);
 const status=await readSiteStatus(storage,actor);
 assert.equal(status.stagedOnly,true);
 assert.equal(status.proxyReady,false);
 assert.equal(status.siteIdentityVerified,false);
 const raw=m.get("man-intimcity-sealed-v1:yan_second");
 assert.equal(raw.enabled,false);
 assert.equal(raw.identityVerified,false);
 assert.equal(raw.siteUrl,"https://b.intimcity.rip/");
 assert.ok(!JSON.stringify(raw).includes(credentials.password));
 assert.ok(!JSON.stringify(result).includes(credentials.password));
 assert.throws(()=>requireSiteVerification({accountId:"yan_second",siteRecord:raw,
  proxyRecord:m.get("man-proxy-sealed-v1:yan_second"),verifiedIdentity:credentials.login}),/not verified/);
 assert.equal((await proxyStatus(storage,actor)).ipVerified,false);
});
test("owner and legacy protection block staging; no site stage without proxy",async()=>{
 const {storage}=fixture();
 await assert.rejects(saveSiteCredentialDraft(storage,env,{...actor,expectedVersion:0,at:2,settings:credentials}),/Configured proxy required/);
 await assert.rejects(saveSiteCredentialDraft(storage,env,{...actor,actorId:"intruder",expectedVersion:0,at:2,settings:credentials}),/Forbidden/);
 await assert.rejects(saveSiteCredentialDraft(storage,env,{...actor,accountId:"yan_first",expectedVersion:0,at:2,settings:credentials}),/Legacy account immutable/);
});
test("stale site updates fail, credentials remain encrypted",async()=>{
 const {storage}=await setup();
 await saveSiteCredentialDraft(storage,env,{...actor,at:2,expectedVersion:0,settings:credentials});
 await assert.rejects(saveSiteCredentialDraft(storage,env,{...actor,at:3,expectedVersion:0,settings:credentials}),/Version conflict/);
});
