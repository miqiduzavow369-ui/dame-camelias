import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {saveSiteCredentialDraft,updateSiteDomain,readSiteStatus} from "../src/man_site_vault.js";
import {startSiteLoginCheck,claimSiteLoginCheck,siteLoginStatus,completeSiteLoginCheck} from "../src/man_site_login_preflight.js";
import {allowedSiteUrl} from "../src/man_proxy_site_check.js";
globalThis.crypto ??= webcrypto;
const env={MAN_SITE_ENCRYPTION_KEY:"ab".repeat(32),MAN_PROXY_ENCRYPTION_KEY:"cd".repeat(32)};
const accounts=["yan_second",...Array.from({length:28},(_,i)=>"yan_"+String(i+3).padStart(2,"0"))];
const actor=accountId=>({actorId:"owner",cabinetId:"owner",ownerId:"owner",accountId});
const te=new TextEncoder();
function fixture(){
 const map=new Map(),s={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v)};
 s.transaction=async f=>f(s);return {s,map};
}
async function seed(s,id){
 const p={protocol:"http",host:id+".proxy.example.test",port:8080,
  username:id,password:id+"-proxy",expectedIp:"127.0.0.1"};
 const k=await crypto.subtle.importKey("raw",new Uint8Array(32).fill(0xcd),"AES-GCM",false,["encrypt"]);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const sealed=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:te.encode(id)},k,te.encode(JSON.stringify(p)));
 await s.put("man-proxy-sealed-v1:"+id,{accountId:id,version:3,proxyVerified:true,ipVerified:true,
  expectedIp:p.expectedIp,iv:[...iv],sealed:[...new Uint8Array(sealed)]});
 await s.put("man-browser-check-v1:"+id,{accountId:id,proxyVersion:3,status:"verified",siteReachable:true});
 await saveSiteCredentialDraft(s,env,{...actor(id),expectedVersion:0,at:1,
  settings:{siteUrl:"https://b.intimcity.rip/",login:id+"@example.test",password:id+"-site"}});
}
test("all 29 owners change only their own domain and claim their own login/proxy on c",async()=>{
 const {s,map}=fixture();
 await s.put("man-intimcity-sealed-v1:yan_first",{immutable:true});
 for(const id of accounts)await seed(s,id);
 for(const id of accounts){
  const proxy=structuredClone(await s.get("man-proxy-sealed-v1:"+id));
  await s.put("man-site-login-check-v1:"+id,{accountId:id,siteVersion:1,proxyVersion:3,
   status:"completed",code:"login_authenticated_identity_verified"});
  const result=await updateSiteDomain(s,env,{...actor(id),expectedVersion:1,at:2});
  assert.equal(result.siteUrl,"https://c.intimcity.rip/");assert.equal(result.version,2);
  assert.equal(result.canPublish,false);assert.ok(!JSON.stringify(result).includes(id+"-site"));
  assert.deepEqual(await s.get("man-proxy-sealed-v1:"+id),proxy);
  assert.equal((await siteLoginStatus(s,actor(id))).siteIdentityVerified,false);
  let nonce;
  await startSiteLoginCheck(s,env,{...actor(id),expectedVersion:2,at:3},async input=>{
   assert.equal(input.siteHost,"c.intimcity.rip");nonce=input.nonce;return true;
  });
  const grant=await claimSiteLoginCheck(s,env,{accountId:id,nonce,at:4});
  assert.equal(grant.siteUrl,result.siteUrl);assert.equal(grant.siteLogin,id+"@example.test");
  assert.equal(grant.sitePassword,id+"-site");assert.equal(grant.proxyUsername,id);
  assert.equal(grant.proxyHost,id+".proxy.example.test");
 }
 assert.deepEqual(map.get("man-intimcity-sealed-v1:yan_first"),{immutable:true});
 assert.equal(allowedSiteUrl("https://c.intimcity.rip/"),"https://c.intimcity.rip/");
 assert.equal(allowedSiteUrl("https://c.intimcity.rip.evil.test/"),null);
});
test("domain change rejects old callback, stale edits, foreign and legacy access; repeat preserves version",async()=>{
 const {s}=fixture(),id="yan_second",p=actor(id);await seed(s,id);
 let nonce;await startSiteLoginCheck(s,env,{...p,expectedVersion:1,at:2},async input=>(nonce=input.nonce,true));
 await claimSiteLoginCheck(s,env,{accountId:id,nonce,at:3});
 await assert.rejects(updateSiteDomain(s,env,{...p,actorId:"other",expectedVersion:1,at:4}),/Forbidden/);
 await assert.rejects(updateSiteDomain(s,env,{...p,accountId:"yan_first",expectedVersion:1,at:4}),/Legacy/);
 await updateSiteDomain(s,env,{...p,expectedVersion:1,at:4});
 await assert.rejects(completeSiteLoginCheck(s,{accountId:id,nonce,at:5,code:"login_authenticated_identity_verified"},env),/Stale/);
 await assert.rejects(updateSiteDomain(s,env,{...p,expectedVersion:1,at:5}),/Version conflict/);
 const again=await updateSiteDomain(s,env,{...p,expectedVersion:2,at:5});
 assert.equal(again.unchanged,true);assert.equal((await readSiteStatus(s,p)).version,2);
});
