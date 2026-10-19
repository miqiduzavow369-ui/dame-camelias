import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {saveProxy} from "../src/man_proxy_vault.js";
import {saveSiteCredentialDraft} from "../src/man_site_vault.js";
import {startBrowserCheck,claimBrowserCheck,completeBrowserCheck} from "../src/man_browser_preflight.js";
import {startSiteLoginCheck,claimSiteLoginCheck,completeSiteLoginCheck,siteLoginStatus} from "../src/man_site_login_preflight.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const env={MAN_PROXY_ENCRYPTION_KEY:"ab".repeat(32),MAN_SITE_ENCRYPTION_KEY:"cd".repeat(32)};
const owner={actorId:"12345",cabinetId:"12345",ownerId:"12345",accountId:"yan_second"};
const proxy={protocol:"http",host:"45.39.104.69",port:6408,username:"proxy",password:"secret-proxy",expectedIp:"45.39.104.69"};
const credentials={siteUrl:"https://b.intimcity.rip/",login:"example@example.com",password:"site-secret"};
function storage(){
 const records=new Map();
 const s={get:async key=>records.get(key),put:async(key,value)=>records.set(key,value),
   transaction:async fn=>fn(s)};
 return s;
}
async function fixture(){
 const store=storage();
 await saveProxy(store,env,{...owner,settings:proxy,expectedVersion:0,at:1});
 await saveSiteCredentialDraft(store,env,{...owner,settings:credentials,expectedVersion:0,at:2});
 let data;
 const run=await startBrowserCheck(store,env,{...owner,expectedVersion:1,siteUrl:credentials.siteUrl,at:3},
   async input=>(data=input,true));
 await claimBrowserCheck(store,env,{accountId:owner.accountId,nonce:data.nonce,at:4});
 await completeBrowserCheck(store,{accountId:owner.accountId,nonce:data.nonce,at:5,
   code:"verified",observedIp:proxy.expectedIp,siteReachable:true});
 assert.equal(run.status,"running");
 return store;
}
test("site login preflight is owner-only and never activates secondary account",async()=>{
 const store=await fixture();let invocation;
 const started=await startSiteLoginCheck(store,env,{...owner,expectedVersion:1,at:10},
  async x=>(invocation=x,{ok:true}));
 assert.equal(started.status,"running");
 assert.ok(!JSON.stringify(invocation).includes("site-secret"));
 const claimed=await claimSiteLoginCheck(store,env,{accountId:owner.accountId,nonce:invocation.nonce,at:11});
 assert.equal(claimed.sitePassword,credentials.password);
 assert.equal(claimed.proxyPassword,proxy.password);
 await assert.rejects(claimSiteLoginCheck(store,env,{accountId:owner.accountId,nonce:invocation.nonce,at:12}));
 const completed=await completeSiteLoginCheck(store,{accountId:owner.accountId,nonce:invocation.nonce,at:13,code:"login_authenticated_identity_unconfirmed"});
 assert.equal(completed.code,"login_authenticated_identity_unconfirmed");
 assert.equal(completed.siteIdentityVerified,false);
 assert.equal(completed.canPublish,false);
 assert.equal((await store.get("man-intimcity-sealed-v1:yan_second")).identityVerified,false);
 assert.equal((await store.get("man-proxy-sealed-v1:yan_second")).enabled,false);
});
test("Yan First and wrong actor cannot run site login check",async()=>{
 const store=await fixture();
 await assert.rejects(startSiteLoginCheck(store,env,{...owner,accountId:"yan_first",expectedVersion:1,at:10},async()=>true),/Legacy/);
 await assert.rejects(startSiteLoginCheck(store,env,{...owner,actorId:"attacker",expectedVersion:1,at:10},async()=>true),/Forbidden/);
});
test("dispatch errors retain safe code and no stored secrets are returned",async()=>{
 const store=await fixture();
 const failed=await startSiteLoginCheck(store,env,{...owner,expectedVersion:1,at:10},
  async()=>({ok:false,reason:"github_forbidden"}));
 assert.equal(failed.reason,"github_forbidden");
 const status=await siteLoginStatus(store,owner);
 assert.equal(status.code,"github_forbidden");
 assert.equal(status.siteIdentityVerified,false);
 assert.ok(!JSON.stringify(status).includes(credentials.password));
});


test("account must use its own verified HTTP proxy, never another man's proxy",async()=>{
 const store=await fixture();
 let dispatched;
 const first=await startSiteLoginCheck(store,env,{...owner,expectedVersion:1,at:15},async x=>(dispatched=x,{ok:true}));
 assert.equal(first.status,"running");
 const original=await store.get("man-proxy-sealed-v1:yan_second");
 // Replacing the proxy with another account's record makes the one-time claim fail.
 await store.put("man-proxy-sealed-v1:yan_second",{...original,accountId:"yan_03"});
 await assert.rejects(claimSiteLoginCheck(store,env,{accountId:owner.accountId,nonce:dispatched.nonce,at:16}),/Unavailable/);
 assert.equal((await siteLoginStatus(store,owner)).canPublish,false);
});
test("an IP-check failure does not permit credentialed login",async()=>{
 const store=await fixture();
 const proxyRecord=await store.get("man-proxy-sealed-v1:yan_second");
 await store.put("man-proxy-sealed-v1:yan_second",{...proxyRecord,ipVerified:false});
 await assert.rejects(startSiteLoginCheck(store,env,{...owner,expectedVersion:1,at:20},
   async()=>{throw Error("dispatch must not run")}),/Prerequisites not verified/);
});
