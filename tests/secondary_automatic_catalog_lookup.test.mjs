import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {webcrypto} from "node:crypto";
import {startProfileProbe,claimProfileProbe,completeProfileProbe} from "../src/secondary_man_profile_probe.js";
const profileId="2468",accountId="yan_second";
function db(){
 const entries=new Map();
 const tx={get:async key=>entries.get(key),put:async(key,value)=>entries.set(key,value)};
 return {entries,storage:{get:tx.get,put:tx.put,transaction:async fn=>fn(tx)}};
}
function config(){
 return {accountId,profileId,at:10000,
  proxy:{version:2,proxyVerified:true,ipVerified:true},
  site:{version:3,proxyReady:true,siteUrl:"https://b.intimcity.rip/"},
  login:{technicalReady:true},catalogReadOnly:true,
  dispatch:async()=>({ok:true})};
}
async function sealed(hex,object,aad){
 const bytes=Uint8Array.from(hex.match(/../g).map(x=>parseInt(x,16)));
 const key=await webcrypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["encrypt"]);
 const iv=webcrypto.getRandomValues(new Uint8Array(12));
 const cipher=await webcrypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(aad)},key,new TextEncoder().encode(JSON.stringify(object)));
 return {iv:Array.from(iv),sealed:Array.from(new Uint8Array(cipher))};
}
test("4/4 read-only catalog probe starts without owner publication approval",async()=>{
 const {storage}=db();
 const started=await startProfileProbe(storage,config());
 assert.equal(started.ok,true);
 const r=await storage.get("secondary-profile-probe-v1:"+accountId);
 assert.equal(r.catalogReadOnly,true);
 const approvalRequired=({...config(),catalogReadOnly:false});
 await assert.rejects(()=>startProfileProbe(db().storage,approvalRequired),/prerequisites/);
 for(const invalid of [{login:{technicalReady:false}},{proxy:{version:2,proxyVerified:false,ipVerified:true}},{site:{version:3,proxyReady:false,siteUrl:"https://b.intimcity.rip/"}}]){
  await assert.rejects(()=>startProfileProbe(db().storage,{...config(),...invalid}),/prerequisites/);
 }
});
test("read-only grant still verifies exact pinned proxy, account and nonce",async()=>{
 const {entries,storage}=db();
 await startProfileProbe(storage,config());
 const nonce=(await storage.get("secondary-profile-probe-v1:"+accountId)).nonce;
 const proxyKey="1".repeat(64),siteKey="2".repeat(64);
 entries.set("man-proxy-sealed-v1:"+accountId,{accountId,version:2,proxyVerified:true,ipVerified:true,expectedIp:"198.51.100.15",
  ...await sealed(proxyKey,{protocol:"http",host:"198.51.100.15",port:6408,username:"user",password:"password",expectedIp:"198.51.100.15"},accountId)});
 entries.set("man-intimcity-sealed-v1:"+accountId,{accountId,version:3,boundProxyVersion:2,siteUrl:"https://b.intimcity.rip/",
  ...await sealed(siteKey,{siteUrl:"https://b.intimcity.rip/",login:"user",password:"password"},accountId+":intimcity:2")});
 const grant=await claimProfileProbe(storage,{MAN_PROXY_ENCRYPTION_KEY:proxyKey,MAN_SITE_ENCRYPTION_KEY:siteKey},
   {accountId,profileId,nonce,at:11000});
 assert.equal(grant.accountId,accountId);
 await assert.rejects(()=>claimProfileProbe(storage,{},{accountId,profileId,nonce,at:11000}),/not authorized/);
 const result=await completeProfileProbe(storage,{accountId,profileId,nonce,at:12000,code:"profile_verified"});
 assert.equal(result.verified,true);
 assert.equal(result.verifiedSiteHost,"b.intimcity.rip");
});
test("automated rating open triggers owner coordinator on missing catalog; normal cache loads without dispatch",()=>{
 const source=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const editor=fs.readFileSync("anketa/mini-preview.html","utf8");
 assert.ok(source.includes('kind:"secondary_catalog_lookup_start",userId:uid'));
 assert.ok(source.includes('autoStartSecondaryCatalogLookup(storage,rawEnv,query)'));
 assert.ok(source.includes('secondary-auto-rating-lookup-v1:'));
 assert.ok(source.includes('if(event.kind==="mini_rating_form")return {ok:false,status:409,reason:"not_ready"}'));
 assert.ok(editor.includes('if(data.ok&&data.stage==="loading")'));
 assert.ok(editor.includes('if(checkOnly&&!data.ok&&data.reason==="not_ready")'));
 assert.ok(!source.includes('kind:"mini_rating_open",accountId:"yan_first"'));
});
