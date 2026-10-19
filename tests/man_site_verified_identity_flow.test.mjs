import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {webcrypto} from "node:crypto";
import {saveProxy} from "../src/man_proxy_vault.js";
import {saveSiteCredentialDraft} from "../src/man_site_vault.js";
import {startBrowserCheck,claimBrowserCheck,completeBrowserCheck} from "../src/man_browser_preflight.js";
import {startSiteLoginCheck,claimSiteLoginCheck,completeSiteLoginCheck,siteLoginStatus} from "../src/man_site_login_preflight.js";
import {currentVerifiedIdentity} from "../src/secondary_man_verified_identity.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const keys={MAN_PROXY_ENCRYPTION_KEY:"ab".repeat(32),MAN_SITE_ENCRYPTION_KEY:"cd".repeat(32)};
const owner={actorId:"12345",cabinetId:"12345",ownerId:"12345",accountId:"yan_second"};
function storage(){const v=new Map(),tx={get:async key=>v.get(key),put:async(key,data)=>v.set(key,data),transaction:async fn=>fn(tx)};return tx;}
async function readyStore(){
 const tx=storage(),proxy={protocol:"http",host:"45.39.104.69",port:6408,username:"u",password:"p",expectedIp:"45.39.104.69"};
 await saveProxy(tx,keys,{...owner,settings:proxy,expectedVersion:0,at:1});
 await saveSiteCredentialDraft(tx,keys,{...owner,settings:{siteUrl:"https://b.intimcity.rip/",login:"real@example.com",password:"p"},expectedVersion:0,at:2});
 let nonce;
 await startBrowserCheck(tx,keys,{...owner,expectedVersion:1,siteUrl:"https://b.intimcity.rip/",at:3},async input=>(nonce=input.nonce,true));
 await claimBrowserCheck(tx,keys,{accountId:owner.accountId,nonce,at:4});
 await completeBrowserCheck(tx,{accountId:owner.accountId,nonce,at:5,code:"verified",observedIp:proxy.expectedIp,siteReachable:true});
 return tx;
}
test("authenticated account header can confirm identity without enabling publication",async()=>{
 const tx=await readyStore();let nonce;
 await startSiteLoginCheck(tx,keys,{...owner,expectedVersion:1,at:10},async input=>(nonce=input.nonce,{ok:true}));
 await claimSiteLoginCheck(tx,keys,{accountId:owner.accountId,nonce,at:11});
 await completeSiteLoginCheck(tx,{accountId:owner.accountId,nonce,at:12,code:"login_authenticated_identity_verified"},keys);
 const result=await siteLoginStatus(tx,owner);
 assert.equal(result.technicalReady,true);
 assert.equal(result.siteIdentityVerified,true);
 assert.equal(result.canPublish,false);
 assert.equal((await currentVerifiedIdentity(tx,owner.accountId)).verified,false); // no ADMIN owner approval yet
 const site=await tx.get("man-intimcity-sealed-v1:yan_second");
 assert.equal(site.identityVerified,false);
});
test("a mismatched authenticated account never confirms identity or unlocks publishing",async()=>{
 const tx=await readyStore();let nonce;
 await startSiteLoginCheck(tx,keys,{...owner,expectedVersion:1,at:10},async input=>(nonce=input.nonce,{ok:true}));
 await claimSiteLoginCheck(tx,keys,{accountId:owner.accountId,nonce,at:11});
 await completeSiteLoginCheck(tx,{accountId:owner.accountId,nonce,at:12,code:"login_identity_mismatch"});
 const result=await siteLoginStatus(tx,owner);
 assert.equal(result.technicalReady,false);
 assert.equal(result.siteIdentityVerified,false);
 assert.equal(result.canPublish,false);
});
test("Chromium identity probe is strictly downstream of site login and never logs actual account identifiers",()=>{
 const python=fs.readFileSync("tools/man_site_login_preflight.py","utf8");
 assert.match(python,/authenticated_identity_status\(page,login_value\)/);
 assert.match(python,/login_authenticated_identity_verified/);
 assert.match(python,/login_identity_mismatch/);
 assert.doesNotMatch(python,/print\([^\n]*details\[["']siteLogin/);
});
