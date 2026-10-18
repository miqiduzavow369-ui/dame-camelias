import test from "node:test";
import assert from "node:assert/strict";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {planManRoute} from "../src/man_operation_route.js";
import {newManSetup} from "../src/man_setup_state.js";
const id={userId:"5866034656",accountId:"yan_second",profileId:"652282",kind:"review",nonce:"abcdef123456"};
const activated=(accountId)=>({accountId,enabled:true,siteIdentityVerified:true,proxyVerified:true,version:4});
const args={moscowDate:"2026-10-18"};
test("all new accounts fail closed without verified server activation",()=>{
 for(const account of MAN_ACCOUNTS.slice(1)){
  const req={...id,accountId:account.id};
  assert.throws(()=>planManRoute(req,{...args,stagingDraft:newManSetup(account.id)}),/not activated/);
  assert.throws(()=>planManRoute(req,{...args,serverActivation:{accountId:account.id,enabled:true,version:1}}),/not activated/);
 }
});
test("legacy man cannot be routed through new preflight",()=>{
 assert.throws(()=>planManRoute({...id,accountId:"yan_first"},{...args,serverActivation:activated("yan_first")}),/Legacy/);
});
test("dry route has isolation keys but common site-wide locks",()=>{
 const plans=["yan_second","yan_03","yan_30"].map(accountId=>
  planManRoute({...id,accountId},{...args,serverActivation:activated(accountId),stagingDraft:newManSetup(accountId)}));
 assert.equal(new Set(plans.map(p=>p.keys.operation)).size,3);
 assert.equal(new Set(plans.map(p=>p.keys.callback)).size,3);
 assert.equal(new Set(plans.map(p=>p.keys.proof)).size,3);
 assert.equal(new Set(plans.map(p=>p.keys.globalPublication)).size,1);
 assert.equal(new Set(plans.map(p=>p.keys.globalReview)).size,1);
 assert.equal(new Set(plans.map(p=>p.keys.globalDaily)).size,1);
 for(const p of plans){assert.equal(p.previewOnly,true);assert.equal(p.canDispatch,false);assert.equal(p.canDebit,false);assert.ok(Object.isFrozen(p))}
});
test("a forged activation for another account is rejected",()=>{
 assert.throws(()=>planManRoute(id,{...args,serverActivation:activated("yan_03")}),/not activated/);
});
test("invalid date, kind, profile and nonce are rejected before routing",()=>{
 for(const bad of [
  [{...id,kind:"publish"},args],
  [{...id,profileId:"652282:yan_second"},args],
  [{...id,nonce:"nothex"},args],
  [id,{moscowDate:"2026-02-30"}]
 ]) assert.throws(()=>planManRoute(bad[0],{...bad[1],serverActivation:activated("yan_second")}));
});
test("staged draft cannot grant permission even with forged enabled flag",()=>{
 const draft={...newManSetup("yan_second"),enabled:true};
 assert.throws(()=>planManRoute(id,{...args,serverActivation:activated("yan_second"),stagingDraft:draft}),/Invalid staged/);
});
