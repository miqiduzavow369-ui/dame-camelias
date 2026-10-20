import test from "node:test";
import assert from "node:assert/strict";
import {SECONDARY_MAN_IDS,secondaryClientRouteStatus,createSecondaryClientOperation,
 verifySecondaryClientCallback,secondaryAdminApprovalStatus,requireSecondaryPublicationExecutor} from "../src/secondary_man_client_route.js";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {requireClientPublicationRoute} from "../src/man_client_parity.js";

const seed={userId:"123456789",profileId:"2468",kind:"review",nonce:"abcdef123456"};
test("all 29 secondary men have stable IDs, shared stages and no accidental activation",()=>{
 assert.equal(SECONDARY_MAN_IDS.length,29);
 assert.deepEqual(SECONDARY_MAN_IDS,MAN_ACCOUNTS.slice(1).map(m=>m.id));
 assert.equal(SECONDARY_MAN_IDS[0],"yan_second");
 assert.equal(SECONDARY_MAN_IDS.at(-1),"yan_30");
 for(const accountId of SECONDARY_MAN_IDS){
  const status=secondaryClientRouteStatus(accountId);
  assert.equal(status.accountId,accountId);
  assert.equal(status.clientPublicationEnabled,false);
  assert.equal(status.executorReady,false);
  assert.throws(()=>requireClientPublicationRoute(accountId),/not connected/);
  assert.throws(()=>requireSecondaryPublicationExecutor(accountId),/not connected/);
 }
 assert.throws(()=>secondaryClientRouteStatus("yan_first"),/identity mismatch/);
});
test("all new men have unique per-client, per-profile storage and account-bound callbacks",()=>{
 const records=SECONDARY_MAN_IDS.map(accountId=>createSecondaryClientOperation({...seed,accountId}));
 const keys=records.flatMap(x=>Object.values(x.keys));
 assert.equal(keys.length,new Set(keys).size);
 for(const op of records){
  const own={...seed,accountId:op.identity.accountId};
  assert.equal(verifySecondaryClientCallback(op,own),true);
  assert.equal(op.publicationAllowed,false);
  assert.equal(Object.isFrozen(op.keys),true);
  for(const otherId of SECONDARY_MAN_IDS){
   if(otherId!==own.accountId)assert.equal(verifySecondaryClientCallback(op,{...own,accountId:otherId}),false);
  }
  assert.equal(verifySecondaryClientCallback(op,{...own,accountId:"yan_first"}),false);
  assert.equal(verifySecondaryClientCallback(op,{...own,profileId:"44"}),false);
 }
});
test("even an approved man stays fail-closed until publisher is actually integrated",()=>{
 for(const accountId of SECONDARY_MAN_IDS){
  const cfg={accountId,enabled:true,siteIdentityVerified:true,proxyVerified:true,version:1};
  const ready=secondaryAdminApprovalStatus(accountId,cfg);
  assert.equal(ready.adminApproved,true);
  assert.equal(ready.publicationAvailable,false);
  assert.equal(secondaryAdminApprovalStatus(accountId,{...cfg,accountId:"yan_first"}).adminApproved,false);
  assert.equal(secondaryAdminApprovalStatus(accountId,{...cfg,proxyVerified:false}).publicationAvailable,false);
 }
});
