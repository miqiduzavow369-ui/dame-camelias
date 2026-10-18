import test from "node:test";
import assert from "node:assert/strict";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {createMockHandoff,simulateManExecution} from "../src/man_executor_contract.js";
const identity={userId:"5866034656",accountId:"yan_second",profileId:"652282",kind:"review",nonce:"abcdef123456"};
const options=(accountId)=>({moscowDate:"2026-10-18",serverActivation:{accountId,enabled:true,siteIdentityVerified:true,proxyVerified:true,version:3}});
test("all disabled men reject mock handoff without trusted activation",()=>{
 for(const {id} of MAN_ACCOUNTS.slice(1))
  assert.throws(()=>createMockHandoff({...identity,accountId:id},{moscowDate:"2026-10-18"}),/not activated/);
 assert.throws(()=>createMockHandoff({...identity,accountId:"yan_first"},options("yan_first")),/Legacy/);
});
test("allowlist strips site credentials and proxy information from mock task",()=>{
 const config={...options("yan_second").serverActivation,password:"VERY_PRIVATE",proxyHost:"203.0.113.9",proxyPassword:"ALSO_PRIVATE"};
 const task=createMockHandoff({...identity,token:"SECRET"},{moscowDate:"2026-10-18",serverActivation:config});
 const body=JSON.stringify(task);
 assert.ok(Object.isFrozen(task));
 for(const forbidden of ["PRIVATE","SECRET","203.0.113.9","password","proxyHost","token"])
  assert.ok(!body.includes(forbidden));
 assert.deepEqual(Object.keys(task).sort(),[
  "schema","mode","accountId","activationVersion","userId","profileId",
  "kind","nonce","operationKey","callbackKey","proofKey","globalDailyLock",
  "globalPublicationLock","globalReviewLock"
 ].sort());
});
test("all men have separate mock task identities but identical site-wide locks",()=>{
 const men=["yan_second","yan_03","yan_30"];
 const tasks=men.map(accountId=>createMockHandoff({...identity,accountId},options(accountId)));
 assert.equal(new Set(tasks.map(t=>t.operationKey)).size,3);
 assert.equal(new Set(tasks.map(t=>t.callbackKey)).size,3);
 assert.equal(new Set(tasks.map(t=>t.globalDailyLock)).size,1);
 assert.equal(new Set(tasks.map(t=>t.globalPublicationLock)).size,1);
 assert.equal(new Set(tasks.map(t=>t.globalReviewLock)).size,1);
 for(const t of tasks){
  const receipt=simulateManExecution(t);
  assert.equal(receipt.sitePublished,false);
  assert.equal(receipt.creditsDebited,false);
  assert.equal(receipt.proofSubmitted,false);
  assert.ok(Object.isFrozen(receipt));
 }
});
test("mock rejection is recorded without claiming successful publication",()=>{
 const task=createMockHandoff(identity,options("yan_second"));
 const receipt=simulateManExecution(task,{result:"mock_rejected"});
 assert.equal(receipt.status,"rejected");
 assert.equal(receipt.sitePublished,false);
 assert.throws(()=>simulateManExecution(task,{result:"publish"}),/Unsupported/);
});
test("forged or cross-account callbacks are rejected at validation boundary",()=>{
 const task=createMockHandoff(identity,options("yan_second"));
 for(const changed of [
  {accountId:"yan_03"}, {profileId:"652283"}, {userId:"5866034657"},
  {nonce:"abcabcabcabc"}, {kind:"rating"}, {activationVersion:0},
  {globalDailyLock:"daily-profile:652282:2026-10-19"},
  {globalPublicationLock:"publication-claim:yan_03:review:652282"},
  {callbackKey:"other"}, {mode:"production"}
 ]) assert.throws(()=>simulateManExecution({...task,...changed}));
});
