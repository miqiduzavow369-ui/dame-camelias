import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {saveProxy,proxyStatus} from "../src/man_proxy_vault.js";
import {allowedSiteUrl,checkManSiteThroughProxy} from "../src/man_proxy_site_check.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const env={MAN_PROXY_ENCRYPTION_KEY:"ba".repeat(32)};
const identity={actorId:"owner",cabinetId:"owner",ownerId:"owner",accountId:"yan_second"};
const secrets={protocol:"socks5",host:"45.39.104.69",port:16408,username:"user",password:"hidden-password",expectedIp:"45.39.104.69"};
function storage(){const map=new Map();const store={
 get:async key=>map.get(key),put:async(key,value)=>map.set(key,value),
 transaction:async fn=>fn(store)
};return {store,map}}
async function setup(){const {store,map}=storage();await saveProxy(store,env,{...identity,settings:secrets,expectedVersion:0,at:1});return {store,map}}
test("only predefined Intimcity HTTPS domains can be checked",()=>{
 assert.equal(allowedSiteUrl("https://a.intimcity.rip/login"),"https://a.intimcity.rip/");
 for(const url of ["https://evil.example","http://a.intimcity.rip/","https://foo.intimcity.rip",
 "https://a.intimcity.rip.evil.example","https://admin:secret@a.intimcity.rip/","https://a.intimcity.rip:8443/",
 "https://a.intimcity.rip/?url=http://localhost","https://127.0.0.1"])assert.equal(allowedSiteUrl(url),null,url);
});
test("site reachable is not IP verification nor login nor activation",async()=>{
 const {store,map}=await setup();
 const result=await checkManSiteThroughProxy(store,env,{...identity,expectedVersion:1,siteUrl:"https://a.intimcity.rip/"},async(settings,host)=>{
  assert.equal(settings.password,secrets.password);
  assert.equal(host,"a.intimcity.rip");
  return {httpStatus:200};
 },()=>{});
 assert.equal(result.reachable,true);
 assert.equal(result.httpStatus,200);
 assert.equal(result.ipVerified,false);
 assert.equal(result.identityVerified,false);
 assert.equal(result.canPublish,false);
 assert.equal((await proxyStatus(store,identity)).ipVerified,false);
 assert.equal(map.get("man-proxy-sealed-v1:yan_second").enabled,false);
 assert.ok(!JSON.stringify(result).includes(secrets.password));
});
test("failed or forbidden site request cannot perform a trusted check",async()=>{
 const {store,map}=await setup();let count=0;
 const probe=async()=>{count++;throw Object.assign(Error("proxy_target_rejected"),{socksReply:2})};
 await assert.rejects(checkManSiteThroughProxy(store,env,{...identity,accountId:"yan_first",expectedVersion:1,siteUrl:"https://a.intimcity.rip/"},probe,()=>{}),/Forbidden/);
 await assert.rejects(checkManSiteThroughProxy(store,env,{...identity,actorId:"intruder",expectedVersion:1,siteUrl:"https://a.intimcity.rip/"},probe,()=>{}),/Forbidden/);
 await assert.rejects(checkManSiteThroughProxy(store,env,{...identity,expectedVersion:1,siteUrl:"https://evil.example/"},probe,()=>{}),/Invalid check/);
 await assert.rejects(checkManSiteThroughProxy(store,env,{...identity,expectedVersion:2,siteUrl:"https://a.intimcity.rip/"},probe,()=>{}),/Version conflict/);
 assert.equal(count,0);
 const failure=await checkManSiteThroughProxy(store,env,{...identity,expectedVersion:1,siteUrl:"https://a.intimcity.rip/"},probe,()=>{});
 assert.equal(failure.code,"proxy_target_rejected");
 assert.equal(failure.socksReply,2);
 assert.equal(failure.reachable,false);
 assert.equal((await proxyStatus(store,identity)).proxyVerified,false);
 assert.equal(map.get("man-proxy-sealed-v1:yan_second").enabled,false);
});
