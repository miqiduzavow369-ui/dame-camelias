// One shared step graph for the 29 secondary accounts: same ordered contract as
// Yan First, isolated client/man/profile identity, with a fail-closed executor.
// Never dispatch a site POST or claim that the secondary publisher is connected.
import {createSecondaryClientOperation} from "./secondary_man_client_route.js";
import {verifyAccountCallback} from "./man_account_isolation.js";
import {LEGACY_CLIENT_ROUTE} from "./man_client_parity.js";
import {currentVerifiedIdentity} from "./secondary_man_verified_identity.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";

const PREFIX="secondary-shared-operation-v1:";
const STEPS=Object.freeze({
 rating:Object.freeze([...LEGACY_CLIENT_ROUTE.rating]),
 review:Object.freeze([...LEGACY_CLIENT_ROUTE.review])
});
const PAGE_ID=/^\d{1,9}$/,MAX_DRAFT=4000;
function acceptedIdentity(input){
 const operation=createSecondaryClientOperation(input);
 return operation.identity;
}
function key(i){return PREFIX+i.userId+":"+i.accountId+":"+i.profileId+":"+i.kind;}
function check(record,identity){
 if(!record||record.identity.accountId!==identity.accountId||
  !verifyAccountCallback(record.identity,identity))throw Error("Operation identity mismatch");
}
export function secondaryWorkflowSteps(kind){
 if(!Object.hasOwn(STEPS,kind))throw Error("Invalid workflow kind");
 return [...STEPS[kind]];
}
export async function startSecondaryWorkflow(storage,input,{profileSaved,clientAuthorized,independentAuthorConfirmed}={}){
 const i=acceptedIdentity(input);
 if(profileSaved!==true||clientAuthorized!==true||independentAuthorConfirmed!==true||
  !PAGE_ID.test(i.profileId)||typeof storage.transaction!=="function")
  throw Error("Client and authentic author authorization required");
 return storage.transaction(async tx=>{
  const k=key(i),old=await tx.get(k);
  if(old)throw Error("Profile operation already started or previously attempted");
  const stages=STEPS[i.kind];
  const record={identity:i,steps:[...stages],index:0,status:"draft",
   authorConfirmed:true,ownerConfirmed:false,moderated:false,
   creditReserved:false,executorConnected:false,siteSubmitted:false,
   proofVerified:false,settled:false};
  await tx.put(k,record);
  return Object.freeze({...record});
 });
}
export async function advanceSecondaryWorkflow(storage,identity,{step,callback,draftText,moderatorApproved,
 ownerConfirmed,creditReserved,siteIdentityVerified,executorConnected,
 callbackConnected,proofAndLedgerConnected}={}){
 const i=acceptedIdentity(identity);
 if(!verifyAccountCallback(i,callback)||typeof storage.transaction!=="function")
  throw Error("Untrusted workflow callback");
 return storage.transaction(async tx=>{
  const k=key(i),record=await tx.get(k);
  check(record,i);
  if(record.status==="uncertain"||record.status==="completed")throw Error("Operation terminal");
  const expected=record.steps[record.index];
  if(step!==expected)throw Error("Workflow stage out of order");
  if(["select_profile","select_man","check_duplicate_and_daily_limit"].includes(step)){
   // Client and profile ownership were verified when the workflow was created.
  }else if(["choose_ratings","write_review"].includes(step)){
   if(typeof draftText!=="string"||draftText.length<1||draftText.length>MAX_DRAFT)
    throw Error("Rating or review draft missing");
  }else if(step==="moderation"&&moderatorApproved!==true){
   throw Error("Moderation has not approved this authentic review");
  }else if(step==="owner_confirm"&&ownerConfirmed!==true){
   throw Error("Owner confirmation missing");
  }else if(step==="reserve_credit_and_lock"&&creditReserved!==true){
   throw Error("Atomic ledger reserve missing");
  }else if(step==="dryfill_on_site"&&siteIdentityVerified!==true){
   throw Error("Verified site identity missing");
  }else if(step==="submit_once"){
   // Site submission is NEVER performed by this pure coordinator. Its stage
   // can be recorded only after a trusted runner is connected and checked.
   if(executorConnected!==true||callbackConnected!==true||
      proofAndLedgerConnected!==true||siteIdentityVerified!==true||
      record.creditReserved!==true||record.ownerConfirmed!==true||
      (i.kind==="review"&&record.moderated!==true))
    throw Error("Publication executor not connected");
  }else if(step==="verify_result"||step==="save_original_proof"||step==="archive_and_settle"){
   // External publication proof must first be verified and stored by the
   // protected callback/ledger adapters. This route never invents evidence.
   throw Error("Proof callback and ledger settlement integration not connected");
  }
  const next={...record,index:record.index+1,
   moderated:record.moderated||step==="moderation"&&moderatorApproved===true,
   ownerConfirmed:record.ownerConfirmed||step==="owner_confirm"&&ownerConfirmed===true,
   creditReserved:record.creditReserved||step==="reserve_credit_and_lock"&&creditReserved===true};
  await tx.put(k,next);
  return Object.freeze({...next,nextStep:next.steps[next.index]??null});
 });
}
export async function secondaryWorkflowReadiness(storage,accountId){
 const state=await currentVerifiedIdentity(storage,accountId);
 // A positive identity check is a prerequisite, never a publication permission.
 return Object.freeze({accountId,siteIdentityVerified:state.verified,
  ratingSteps:secondaryWorkflowSteps("rating"),reviewSteps:secondaryWorkflowSteps("review"),
  publicationAvailable:false,reason:"isolated_runner_callbacks_not_connected"});
}
