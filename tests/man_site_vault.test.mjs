import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {webcrypto} from "node:crypto";
import {validIntimcityUrl,validateSiteCredentials,readSiteStatus,saveSiteCredentials,requireSiteVerification} from "../src/man_site_vault.js";
globalThis.crypto ??= webcrypto;
const OWNER="1234567890",accountId="yan_second",key="ab".repeat(32);
const actor={actorId:OWNER,cabinetId:OWNER,ownerId:OWNER,accountId};
const settings={siteUrl:"https://a.intimcity.rip/",login:"test@example.com",password:"only-for-test"};
function store(){const data=new Map();const tx={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)};return {...tx,transaction:async f=>f(tx),data};}
test("URL validation rejects external credentials, lookalikes, insecure URLs",()=>{
 for(const value of ["http://a.intimcity.rip/","https://intimcity.rip.evil.org/","https://example.com/","https://a.intimcity.rip:8443/","https://user:pass@intimcity.rip/","https://intimcity.rip/#login"]){
  assert.equal(validIntimcityUrl(value),null,value);
 }
 assert.equal(validIntimcityUrl("https://a.intimcity.rip/login"),"https://a.intimcity.rip/");
 assert.equal(validateSiteCredentials(settings).login,settings.login);
 assert.throws(()=>validateSiteCredentials({...settings,password:""}));
});
test("site vault never changes Yan First or lets an unauthorized actor read or write",async()=>{
 const s=store();
 await assert.rejects(readSiteStatus(s,{...actor,accountId:"yan_first"}));
 await assert.rejects(readSiteStatus(s,{...actor,actorId:"4444444444"}));
 await assert.rejects(saveSiteCredentials(s,{MAN_SITE_ENCRYPTION_KEY:key},{...actor,accountId:"yan_first",expectedVersion:0,settings,at:1}));
 assert.equal(s.data.size,0);
});
test("site credentials require verified proxy AND site encryption key",async()=>{
 const s=store();
 const before=await readSiteStatus(s,actor);
 assert.equal(before.proxyReady,false);assert.equal(before.configured,false);
 await assert.rejects(saveSiteCredentials(s,{MAN_SITE_ENCRYPTION_KEY:key},{...actor,expectedVersion:0,settings,at:1}),/Verified proxy required/);
 await s.put("man-proxy-sealed-v1:"+accountId,{accountId,version:1,proxyVerified:true,ipVerified:false});
 await assert.rejects(saveSiteCredentials(s,{MAN_SITE_ENCRYPTION_KEY:key},{...actor,expectedVersion:0,settings,at:1}),/Verified proxy required/);
 await s.put("man-proxy-sealed-v1:"+accountId,{accountId,version:1,proxyVerified:true,ipVerified:true});
 await assert.rejects(saveSiteCredentials(s,{},{...actor,expectedVersion:0,settings,at:1}),/Site vault key not configured/);
 assert.equal(s.data.has("man-intimcity-sealed-v1:"+accountId),false);
 const saved=await saveSiteCredentials(s,{MAN_SITE_ENCRYPTION_KEY:key},{...actor,expectedVersion:0,settings,at:1});
 assert.equal(saved.canPublish,false);assert.equal(saved.siteIdentityVerified,false);
 const serialized=JSON.stringify([...s.data.values()]);
 assert.equal(serialized.includes(settings.password),false);
 assert.equal(serialized.includes(settings.login),false);
 assert.equal((await readSiteStatus(s,actor)).configured,true);
 await assert.rejects(saveSiteCredentials(s,{MAN_SITE_ENCRYPTION_KEY:key},{...actor,expectedVersion:0,settings,at:2}),/Version conflict/);
 assert.throws(()=>requireSiteVerification({accountId,siteRecord:s.data.get("man-intimcity-sealed-v1:"+accountId),proxyRecord:s.data.get("man-proxy-sealed-v1:"+accountId),verifiedIdentity:"example"}));
});
test("mobile form and JS parse, no synthetic confirmation button",()=>{
 const html=fs.readFileSync("admin/preview-v3.html","utf8");
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);new vm.Script(script[1]);
 for(const value of ["function renderManSiteForm()","function openManSite()","function saveManSite(event)","man_site_status","man_site_stage","manSiteUrl","manSiteLogin","manSitePassword","MAN_SITE_ENCRYPTION_KEY"]){assert.ok(html.includes(value),value);}
 assert.match(html, /startManSiteLoginCheck\(\)/);
 assert.match(html, /После входа проверяется соответствие кабинета выбранному мужчине/);
 assert.doesNotMatch(html, /siteIdentityVerified:true/);
});

