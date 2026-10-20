import test from "node:test";
import assert from "node:assert/strict";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {secondaryRatingReadiness} from "../src/secondary_man_rating_readiness.js";
function claims(id){return {
 proxy:{accountId:id,version:2,proxyVerified:true,ipVerified:true},
 site:{accountId:id,version:3,boundProxyVersion:2,configured:true},
 approval:{accountId:id,version:1,approved:true,proxyVersion:2,siteVersion:3},
 login:{accountId:id,technicalReady:true,siteIdentityVerified:true},
 identity:{accountId:id,verified:true},
 executorConnected:true,callbackConnected:true,proofAndLedgerConnected:true
};}
test("each of the 29 men has an independent complete readiness contract",()=>{
 for(const man of MAN_ACCOUNTS.slice(1)){
  const result=secondaryRatingReadiness(man.id,claims(man.id));
  assert.equal(result.ready,true,man.id);
  assert.equal(result.publicationAttempted,false);
  const bad=claims(man.id);
  bad.approval={...bad.approval,accountId:"yan_first"};
  assert.ok(secondaryRatingReadiness(man.id,bad).blockers.includes("owner_approval_required"));
  const changed=claims(man.id);
  changed.proxy={...changed.proxy,version:4};
  assert.ok(secondaryRatingReadiness(man.id,changed).blockers.includes("site_credentials_unverified"));
  assert.ok(secondaryRatingReadiness(man.id,changed).blockers.includes("owner_approval_required"));
 }
});
test("technical identity without a runner remains blocked",()=>{
 const id="yan_second",row=secondaryRatingReadiness(id,{...claims(id),executorConnected:false});
 assert.equal(row.ready,false);
 assert.deepEqual(row.blockers,["isolated_executor_not_connected"]);
});
test("missing records and Yan First fail closed",()=>{
 const r=secondaryRatingReadiness("yan_second");
 assert.equal(r.ready,false);
 assert.equal(r.blockers.length,8);
 assert.throws(()=>secondaryRatingReadiness("yan_first",claims("yan_first")),/Legacy Yan First/);
});
