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

test("HTTP CONNECT via Dolphin proxy authenticates before TLS and never verifies IP",async()=>{
 const {store,map}=storage();
 await saveProxy(store,env,{...identity,expectedVersion:0,at:1,
  settings:{...secrets,protocol:"http",port:6408}});
 let request="",siteRequest="";
 const utf8=new TextEncoder();
 const fakeResponse=bytes=>({getReader(){return {async read(){return {done:false,value:utf8.encode(bytes)}},releaseLock(){}}}});
 const proxySocket={
  opened:Promise.resolve(),
  readable:fakeResponse("HTTP/1.1 200 Connection established\r\n\r\n"),
  writable:{getWriter(){return {async write(data){request=new TextDecoder().decode(data)},releaseLock(){}}}},
  startTls({expectedServerHostname}) {
   assert.equal(expectedServerHostname,"a.intimcity.rip");
   return {
    opened:Promise.resolve(),
    readable:fakeResponse("HTTP/1.1 200 OK\r\n"),
    writable:{getWriter(){return {async write(data){siteRequest=new TextDecoder().decode(data)},releaseLock(){}}}},
    close(){}
   };
  },close(){}
 };
 const result=await checkManSiteThroughProxy(store,env,
  {...identity,expectedVersion:1,siteUrl:"https://a.intimcity.rip/"},
  null,()=>proxySocket);
 assert.equal(result.protocol,"http");
 assert.equal(result.reachable,true);
 assert.equal(result.ipVerified,false);
 assert.equal(result.identityVerified,false);
 assert.equal(result.canPublish,false);
 assert.match(request,/^CONNECT a\.intimcity\.rip:443 HTTP\/1\.1/);
 assert.match(request,/Proxy-Authorization: Basic /);
 assert.doesNotMatch(siteRequest,/Proxy-Authorization/i);
 assert.equal(map.get("man-proxy-sealed-v1:yan_second").enabled,false);
});
test("HTTP CONNECT 407 fails closed without credential disclosure",async()=>{
 const {store}=storage();
 await saveProxy(store,env,{...identity,expectedVersion:0,at:1,
  settings:{...secrets,protocol:"http",port:6408}});
 const fake={
  opened:Promise.resolve(),close(){},
  readable:{getReader(){return {async read(){return {done:false,value:new TextEncoder().encode("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")}},releaseLock(){}}}},
  writable:{getWriter(){return {async write(){},releaseLock(){}}}}
 };
 const result=await checkManSiteThroughProxy(store,env,{...identity,expectedVersion:1,siteUrl:"https://a.intimcity.rip/"},
  null,()=>fake);
 assert.equal(result.code,"http_proxy_auth_failed");
 assert.equal(result.reachable,false);
 assert.equal(result.canPublish,false);
 assert.ok(!JSON.stringify(result).includes(secrets.password));
});

test("HTTP CONNECT accepts split response headers and LF-only headers",async()=>{
 const {store}=storage();
 await saveProxy(store,env,{...identity,expectedVersion:0,at:1,settings:{...secrets,protocol:"http",port:6408}});
 const enc=new TextEncoder();
 for(const chunks of [
  ["HTTP/1.1 200 Connection", " established\r\nProxy-Agent: safe\r\n", "\r\n"],
  ["HTTP/1.0 200 OK\n\n"]
 ]){
  let index=0;
  const response={opened:Promise.resolve(),close(){},
   readable:{getReader(){return {async read(){return {done:false,value:enc.encode(chunks[Math.min(index++,chunks.length-1)])}},releaseLock(){}}}},
   writable:{getWriter(){return {async write(){},releaseLock(){}}}},
   startTls(){return {opened:Promise.resolve(),close(){},
    readable:{getReader(){return {async read(){return {done:false,value:enc.encode("HTTP/1.1 200 OK\r\n")}},releaseLock(){}}}},
    writable:{getWriter(){return {async write(){},releaseLock(){}}}}
   }}
  };
  const out=await checkManSiteThroughProxy(store,env,{...identity,expectedVersion:1,siteUrl:"https://b.intimcity.rip/"},null,()=>response);
  assert.equal(out.reachable,true);
  assert.equal(out.ipVerified,false);
 }
});
test("HTTP CONNECT reports malformed reply and unexpected tunnel data separately",async()=>{
 const {store}=storage();
 await saveProxy(store,env,{...identity,expectedVersion:0,at:1,settings:{...secrets,protocol:"http",port:6408}});
 for(const [raw,expected] of [
  ["HELLO\r\n\r\n","http_connect_bad_status_line"],
  ["HTTP/1.1 200 OK\r\n\r\nEXTRA","http_connect_unexpected_payload"]
 ]){
  const fake={opened:Promise.resolve(),close(){},
   readable:{getReader(){return {async read(){return {done:false,value:new TextEncoder().encode(raw)}},releaseLock(){}}}},
   writable:{getWriter(){return {async write(){},releaseLock(){}}}}
  };
  const out=await checkManSiteThroughProxy(store,env,{...identity,expectedVersion:1,siteUrl:"https://b.intimcity.rip/"},null,()=>fake);
  assert.equal(out.code,expected);
  assert.equal(out.reachable,false);
  assert.equal(out.canPublish,false);
 }
});
