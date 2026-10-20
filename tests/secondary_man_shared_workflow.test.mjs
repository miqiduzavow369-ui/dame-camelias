import test from "node:test";
import assert from "node:assert/strict";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {LEGACY_CLIENT_ROUTE} from "../src/man_client_parity.js";
import {secondaryWorkflowSteps,startSecondaryWorkflow,advanceSecondaryWorkflow,secondaryWorkflowReadiness} from "../src/secondary_man_shared_workflow.js";
function storage(){
 const values=new Map();
 const tx={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),transaction:async fn=>fn(tx)};
 return {tx,values};
}
const identity=(accountId,kind,profileId="2468")=>({accountId,userId:"123456789",profileId,kind,nonce:"abcdef123456"});
const basic=new Set(["select_profile","select_man","check_duplicate_and_daily_limit","save_draft","review_ratings","review_text","save_draft"]);
test("29 separate men inherit the same immutable Yan stage sequence for ratings and reviews",async()=>{
 for(const kind of ["rating","review"]){
  assert.deepEqual(secondaryWorkflowSteps(kind),LEGACY_CLIENT_ROUTE[kind]);
  const {tx,values}=storage();
  for(const man of MAN_ACCOUNTS.slice(1)){
   const i=identity(man.id,kind);
   const created=await startSecondaryWorkflow(tx,i,{profileSaved:true,clientAuthorized:true,independentAuthorConfirmed:true});
   assert.equal(created.identity.accountId,man.id);
   assert.equal(created.steps.length,LEGACY_CLIENT_ROUTE[kind].length);
   assert.equal(created.siteSubmitted,false);
   assert.equal(created.creditReserved,false);
   await assert.rejects(()=>startSecondaryWorkflow(tx,i,{profileSaved:true,clientAuthorized:true,independentAuthorConfirmed:true}),/already started/);
  }
  assert.equal(values.size,29);
 }
 await assert.rejects(()=>startSecondaryWorkflow(storage().tx,identity("yan_first","review"),{profileSaved:true,clientAuthorized:true,independentAuthorConfirmed:true}),/Secondary man identity mismatch/);
});
test("client+man+profile operation cannot skip stages, forge callback, or submit without runner",async()=>{
 const {tx}=storage(),i=identity("yan_second","rating");
 await startSecondaryWorkflow(tx,i,{profileSaved:true,clientAuthorized:true,independentAuthorConfirmed:true});
 await assert.rejects(()=>advanceSecondaryWorkflow(tx,i,{step:"submit_once",callback:i}),/out of order/);
 await assert.rejects(()=>advanceSecondaryWorkflow(tx,i,{step:"select_profile",callback:{...i,accountId:"yan_03"}}),/Untrusted/);
 for(const step of ["select_profile","select_man","check_duplicate_and_daily_limit"]){
  await advanceSecondaryWorkflow(tx,i,{step,callback:i});
 }
 await advanceSecondaryWorkflow(tx,i,{step:"choose_ratings",callback:i,draftText:"5,5,5,5"});
 for(const step of ["save_draft","review_ratings"]){
  await advanceSecondaryWorkflow(tx,i,{step,callback:i});
 }
 await assert.rejects(()=>advanceSecondaryWorkflow(tx,i,{step:"dryfill_on_site",callback:i}),/Verified site identity/);
 await advanceSecondaryWorkflow(tx,i,{step:"dryfill_on_site",callback:i,siteIdentityVerified:true});
 await advanceSecondaryWorkflow(tx,i,{step:"owner_confirm",callback:i,ownerConfirmed:true});
 await advanceSecondaryWorkflow(tx,i,{step:"reserve_credit_and_lock",callback:i,creditReserved:true});
 await assert.rejects(()=>advanceSecondaryWorkflow(tx,i,{step:"submit_once",callback:i,siteIdentityVerified:true,executorConnected:true,callbackConnected:true,proofAndLedgerConnected:true}),/executor not connected/);
});
test("reviews strictly require moderation and owner confirmation before executor",async()=>{
 const {tx}=storage(),i=identity("yan_second","review");
 await startSecondaryWorkflow(tx,i,{profileSaved:true,clientAuthorized:true,independentAuthorConfirmed:true});
 const steps=["select_profile","select_man","check_duplicate_and_daily_limit","write_review","save_draft","review_text"];
 for(const step of steps)await advanceSecondaryWorkflow(tx,i,{step,callback:i,...(step==="write_review"?{draftText:"Authentic account-holder experience"}:{})});
 await assert.rejects(()=>advanceSecondaryWorkflow(tx,i,{step:"moderation",callback:i}),/Moderation/);
 await advanceSecondaryWorkflow(tx,i,{step:"moderation",callback:i,moderatorApproved:true});
 await assert.rejects(()=>advanceSecondaryWorkflow(tx,i,{step:"owner_confirm",callback:i}),/Owner confirmation/);
 await advanceSecondaryWorkflow(tx,i,{step:"owner_confirm",callback:i,ownerConfirmed:true});
 await advanceSecondaryWorkflow(tx,i,{step:"reserve_credit_and_lock",callback:i,creditReserved:true});
 await assert.rejects(()=>advanceSecondaryWorkflow(tx,i,{step:"submit_once",callback:i}),/executor not connected/);
});
test("identity readiness is a status only; never enables publishing",async()=>{
 const {tx}=storage();
 const status=await secondaryWorkflowReadiness(tx,"yan_second");
 assert.equal(status.publicationAvailable,false);
 assert.equal(status.siteIdentityVerified,false);
 assert.deepEqual(status.reviewSteps,LEGACY_CLIENT_ROUTE.review);
});
