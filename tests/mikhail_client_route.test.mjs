import test from "node:test";
import assert from "node:assert/strict";
import {MIKHAIL_ACCOUNT_ID,mikhailClientRouteStatus,createMikhailClientOperation,verifyMikhailClientCallback,requireMikhailPublicationExecutor} from "../src/mikhail_client_route.js";
import {requireClientPublicationRoute} from "../src/man_client_parity.js";

const seed={userId:"123456789",accountId:"yan_second",profileId:"2468",kind:"rating",nonce:"abcdef123456"};
test("Mikhail technical identity stays exact and cannot impersonate Yan First",()=>{
 assert.equal(MIKHAIL_ACCOUNT_ID,"yan_second");
 const status=mikhailClientRouteStatus();
 assert.equal(status.accountId,"yan_second");
 assert.equal(status.displayName,"Михаил Корсаков");
 assert.equal(status.executorReady,false);
 assert.equal(status.clientPublicationEnabled,false);
 assert.deepEqual(requireClientPublicationRoute("yan_first"),{accountId:"yan_first",route:"legacy_yan_first"});
 assert.throws(()=>requireClientPublicationRoute("yan_second"),/not connected/);
});
test("Mikhail keys are immutable, client- and profile-scoped, and never legacy keys",()=>{
 const op=createMikhailClientOperation(seed);
 assert.equal(op.identity.accountId,"yan_second");
 assert.equal(op.publicationAllowed,false);
 assert.deepEqual(Object.keys(op.keys),["operation","rating-draft","review-draft","moderation","publication","proof","history","callback"]);
 for(const key of Object.values(op.keys))assert.match(key,/^man-account-v1:123456789:yan_second:/);
 const other=createMikhailClientOperation({...seed,userId:"987654321"});
 const otherProfile=createMikhailClientOperation({...seed,profileId:"999"});
 for(const scope of Object.keys(op.keys)){
  assert.notEqual(op.keys[scope],other.keys[scope]);
  assert.notEqual(op.keys[scope],otherProfile.keys[scope]);
  assert.doesNotMatch(op.keys[scope],/yan_first/);
 }
 assert.throws(()=>createMikhailClientOperation({...seed,accountId:"yan_first"}),/identity mismatch/);
 assert.throws(()=>createMikhailClientOperation({...seed,accountId:"yan_02"}),/identity mismatch/);
});
test("callback must match man's operation and each original identity component",()=>{
 const op=createMikhailClientOperation(seed);
 assert.equal(verifyMikhailClientCallback(op,seed),true);
 for(const patch of [{accountId:"yan_first"},{accountId:"yan_03"},{userId:"987654321"},{profileId:"777"},{kind:"review"},{nonce:"abcdef654321"}]){
  assert.equal(verifyMikhailClientCallback(op,{...seed,...patch}),false);
 }
});
test("Mikhail executor fails closed even with a valid technical identity",()=>{
 assert.throws(()=>requireMikhailPublicationExecutor(),/not connected/);
});
