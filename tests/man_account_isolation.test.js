import test from "node:test";
import assert from "node:assert/strict";
import {requireManId,requirePublicationIdentity,manStorageKey,createAccountOperation,verifyAccountCallback,requireServerActivation,publicAccountStatus} from "../src/man_account_isolation.js";
const base={userId:"5866034656",accountId:"yan_second",profileId:"652282",kind:"rating",nonce:"abcdef123456"};
test("requires known identifier; rejects malformed and injected segments",()=>{
 assert.equal(requireManId("yan_30"),"yan_30");
 for(const id of ["yan_2","yan_31","yan_first:secret","../yan_first",null]) assert.throws(()=>requireManId(id));
 assert.throws(()=>requirePublicationIdentity({...base,userId:"1:2"}));
 assert.throws(()=>requirePublicationIdentity({...base,profileId:"652282:second"}));
});
test("never aliases storage between user, account, profile, or scope",()=>{
 const key=(changes={})=>manStorageKey({...base,scope:"review-ticket",...changes});
 assert.notEqual(key(),key({accountId:"yan_first"}));
 assert.notEqual(key(),key({userId:"5866034657"}));
 assert.notEqual(key(),key({profileId:"652283"}));
 assert.notEqual(key(),key({scope:"moderation"}));
 assert.equal(key(),"man-account-v1:5866034656:yan_second:review-ticket:652282");
 assert.throws(()=>key({scope:"password"}));
});
test("callback rejects cross-account and stale correlation",()=>{
 const op=createAccountOperation(base);
 assert.ok(Object.isFrozen(op));
 assert.equal(verifyAccountCallback(op,base),true);
 for(const change of [{accountId:"yan_first"},{profileId:"652283"},{userId:"5866034657"},{nonce:"abcdef123457"},{kind:"review"}]){
   assert.equal(verifyAccountCallback(op,{...base,...change}),false);
 }
 assert.equal(verifyAccountCallback(op,{...base,version:2}),true); // callback version is read from stored operation
 assert.equal(verifyAccountCallback({...op,version:2},base),false);
});
test("account activation is fail-closed",()=>{
 assert.throws(()=>requireServerActivation("yan_second",{accountId:"yan_second",enabled:true,version:1}));
 assert.throws(()=>requireServerActivation("yan_second",{accountId:"yan_first",enabled:true,siteIdentityVerified:true,proxyVerified:true,version:1}));
 const active=requireServerActivation("yan_second",{accountId:"yan_second",enabled:true,siteIdentityVerified:true,proxyVerified:true,version:3});
 assert.equal(active.version,3);
 assert.ok(Object.isFrozen(active));
});
test("admin status excludes secrets",()=>{
 const config={accountId:"yan_second",configured:true,enabled:false,proxyVerified:false,siteIdentityVerified:false,password:"secret",proxyPassword:"secret2"};
 const status=publicAccountStatus("yan_second",config);
 assert.deepEqual(Object.keys(status),["accountId","configured","enabled","proxyVerified","siteIdentityVerified"]);
 assert.ok(!JSON.stringify(status).includes("secret"));
});
