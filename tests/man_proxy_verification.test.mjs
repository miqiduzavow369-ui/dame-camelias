import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {saveProxy,proxyStatus} from "../src/man_proxy_vault.js";
import {verifyManProxy} from "../src/man_proxy_verification.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const env={MAN_PROXY_ENCRYPTION_KEY:"bd".repeat(32)};
function makeStorage(){
 const m=new Map();
 const store={get:async k=>m.get(k),put:async(k,v)=>{m.set(k,v)},transaction:async fn=>fn(store)};
 return {store,m};
}
const ctx={actorId:"12345",cabinetId:"12345",ownerId:"12345",accountId:"yan_second"};
const settings={protocol:"socks5",host:"45.39.104.69",port:16408,expectedIp:"45.39.104.69",username:"proxyuser",password:"s3cr3t"};
async function setup(){
 const {store,m}=makeStorage();
 await saveProxy(store,env,{...ctx,settings,expectedVersion:0,at:1});
 return {store,m};
}
test("successful SOCKS5 egress verification updates only that account, leaves disabled",async()=>{
 const {store,m}=await setup();
 let received;
 const result=await verifyManProxy(store,env,{...ctx,expectedVersion:1,at:2},async clean=>{
  received=clean;return settings.expectedIp;
 },()=>{});
 assert.equal(received.password,settings.password);
 assert.equal(result.verified,true);
 assert.equal(result.canPublish,false);
 const publicState=await proxyStatus(store,ctx);
 assert.equal(publicState.proxyVerified,true);
 assert.equal(publicState.ipVerified,true);
 assert.equal(m.get("man-proxy-sealed-v1:yan_second").enabled,false);
 assert.equal(m.get("man-proxy-sealed-v1:yan_second").siteIdentityVerified,false);
 assert.ok(!JSON.stringify(result).includes(settings.password));
});
test("mismatch and auth failures fail closed and keep publications blocked",async()=>{
 const {store,m}=await setup();
 const wrong=await verifyManProxy(store,env,{...ctx,expectedVersion:1,at:2},async()=>"45.39.104.95",()=>{});
 assert.equal(wrong.code,"ip_mismatch");
 assert.equal(wrong.verified,false);
 assert.equal((await proxyStatus(store,ctx)).proxyVerified,false);
 const failed=await verifyManProxy(store,env,{...ctx,expectedVersion:1,at:3},async()=>{throw Error("proxy_auth_failed")},()=>{});
 assert.equal(failed.code,"proxy_auth_failed");
 assert.equal(m.get("man-proxy-sealed-v1:yan_second").enabled,false);
});
test("forbidden, legacy and stale versions never perform network checks",async()=>{
 const {store}=await setup();let calls=0;
 const probe=async()=>{calls++;return settings.expectedIp};
 await assert.rejects(verifyManProxy(store,env,{...ctx,accountId:"yan_first",expectedVersion:1,at:2},probe,()=>{}),/Forbidden/);
 await assert.rejects(verifyManProxy(store,env,{...ctx,actorId:"456",expectedVersion:1,at:2},probe,()=>{}),/Forbidden/);
 await assert.rejects(verifyManProxy(store,env,{...ctx,expectedVersion:2,at:2},probe,()=>{}),/Version conflict/);
 assert.equal(calls,0);
});

test("stage-safe TCP and TLS errors never verify and never expose credentials",async()=>{
 const {store}=await setup();
 const cases=["tcp_connect_failed","socks_handshake_failed","proxy_auth_failed","proxy_target_rejected","tls_tunnel_failed","ip_echo_failed"];
 for(const code of cases){
  const result=await verifyManProxy(store,env,{...ctx,expectedVersion:1,at:4},async()=>{
   const error=new Error(code);error.stage=code;throw error;
  },()=>{});
  assert.equal(result.code,code);
  assert.equal(result.verified,false);
  assert.equal(result.canPublish,false);
  assert.equal((await proxyStatus(store,ctx)).ipVerified,false);
  assert.ok(!JSON.stringify(result).includes(settings.password));
 }
});

test("retry only fixed HTTPS echo endpoint following SOCKS5 target refusal",async()=>{
 const {store}=await setup(),called=[];
 const out=await verifyManProxy(store,env,{...ctx,expectedVersion:1,at:5},async(_settings,_connect,_signal,host)=>{
  called.push(host);
  if(called.length===1){const e=new Error("proxy_target_rejected");e.socksReply=2;e.stage="socks_connect";throw e;}
  return settings.expectedIp;
 },()=>{});
 assert.deepEqual(called,["api.ipify.org","ipv4.icanhazip.com"]);
 assert.equal(out.verified,true);
 assert.equal(out.canPublish,false);
 assert.equal(out.checkHost,"ipv4.icanhazip.com");
});
test("two SOCKS5 refusals expose numeric reply but never credentials",async()=>{
 const {store}=await setup(),called=[];
 const out=await verifyManProxy(store,env,{...ctx,expectedVersion:1,at:5},async(_settings,_connect,_signal,host)=>{
  called.push(host);const e=new Error("proxy_target_rejected");e.socksReply=2;e.stage="socks_connect";throw e;
 },()=>{});
 assert.equal(called.length,2);
 assert.equal(out.code,"proxy_target_rejected");
 assert.equal(out.socksReply,2);
 assert.equal(out.canPublish,false);
 assert.equal(out.verified,false);
 assert.ok(!JSON.stringify(out).includes(settings.password));
});
test("never retry auth rejection against alternate target",async()=>{
 const {store}=await setup(),called=[];
 const out=await verifyManProxy(store,env,{...ctx,expectedVersion:1,at:5},async(_settings,_connect,_signal,host)=>{
  called.push(host);throw Error("proxy_auth_failed");
 },()=>{});
 assert.equal(called.length,1);
 assert.equal(out.code,"proxy_auth_failed");
 assert.equal(out.canPublish,false);
});
