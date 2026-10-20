// Secondary men: trusted, server-internal publication-result coordinator.
// Deliberately NOT exposed as an HTTP endpoint or client Mini App action.
// An authenticated, account-pinned executor callback is still required before
// this module can be connected to production.
//
// A failed external POST is never retried here. A partial proof/credit
// settlement is left for reconciliation instead of replaying the submission.
import {createAccountOperation,verifyAccountCallback,manStorageKey} from "./man_account_isolation.js";
import {appendVerifiedFeedbackEvidence,readVerifiedFeedbackEvidence} from "./secondary_man_feedback_evidence.js";
import {settleSecondaryFeedbackCredit} from "./secondary_man_credit_bridge.js";
import {verifySecondaryResultAttestation} from "./secondary_man_callback_attestation.js";
import {claimSecondaryCallbackTicket} from "./secondary_man_callback_ticket.js";

const IDENTIFIER=/^[A-Za-z0-9_-]{6,300}$/;
function validated(original,callback){
 const identity=createAccountOperation(original);
 if(identity.accountId==="yan_first")throw Error("Legacy publisher immutable");
 if(!verifyAccountCallback(identity,callback))throw Error("Account-bound result mismatch");
 return identity;
}
function publicationKey(i){
 return manStorageKey({userId:i.userId,accountId:i.accountId,profileId:i.profileId,scope:"publication"})+":"+i.kind;
}
function resultKey(i){
 return manStorageKey({userId:i.userId,accountId:i.accountId,profileId:i.profileId,scope:"proof"})+":"+i.kind+":"+i.nonce+":settlement";
}
export async function recordSecondaryVerifiedResult(storage,{
 original,callback,sitePublicationId,proofFileId,moderatorApproved,
 independentAuthorConfirmed,verifiedByTrustedExecutor,at
}){
 const i=validated(original,callback);
 if(verifiedByTrustedExecutor!==true||moderatorApproved!==true||
    independentAuthorConfirmed!==true||
    typeof sitePublicationId!=="string"||!IDENTIFIER.test(sitePublicationId)||
    typeof proofFileId!=="string"||!IDENTIFIER.test(proofFileId)||
    !Number.isSafeInteger(at)||at<0)
  throw Error("Trusted verified result and original screenshot required");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage required");
 // Bind a trusted callback to a one-use attempted external operation.
 // Only the first proof callback may claim it; even a duplicate proof file
 // cannot create another financial settlement.
 const state=await storage.transaction(async tx=>{
  const publication=await tx.get(publicationKey(i)),previous=await tx.get(resultKey(i));
  if(previous||publication?.status!=="attempted"||publication?.attempted!==true||
     !verifyAccountCallback(publication.identity,callback)||
     publication.proxyVersion<1||publication.siteVersion<1)
   throw Error("Publication not attempted or result already claimed");
  const next={identity:i,status:"proof_pending",at,
   sitePublicationId,proofFileId,ledgerStatus:"unsettled"};
  await tx.put(resultKey(i),next);
  return next;
 });
 try{
  await appendVerifiedFeedbackEvidence(storage,{identity:i,sitePublicationId,
   proofFileId,moderatorApproved,independentAuthorConfirmed,at});
  await storage.transaction(async tx=>{
   const current=await tx.get(resultKey(i));
   if(current?.status!=="proof_pending")throw Error("Result state conflicted");
   await tx.put(resultKey(i),{...current,status:"proof_saved"});
  });
  return {ok:true,accountId:i.accountId,status:"proof_saved",readyForSettlement:true};
 }catch{
  // Once an external result is observed, no automatic replay is safe.
  await storage.transaction(async tx=>{
   const current=await tx.get(resultKey(i));
   if(current?.status==="proof_pending")
    await tx.put(resultKey(i),{...current,status:"reconciliation_required"});
  });
  return {ok:false,accountId:i.accountId,status:"reconciliation_required"};
 }
}
export async function settleSecondaryVerifiedResult(storage,env,{original,callback}){
 const i=validated(original,callback);
 if(typeof storage.transaction!=="function")throw Error("Atomic storage required");
 const record=await storage.transaction(async tx=>{
  const publication=await tx.get(publicationKey(i));
  const current=await tx.get(resultKey(i));
  if(!current||current.status!=="proof_saved"||
     !publication||publication.status!=="attempted"||publication.attempted!==true||
     !verifyAccountCallback(publication.identity,callback))
   throw Error("Verified result not ready for settlement");
  await tx.put(resultKey(i),{...current,status:"settling"});
  return current;
 });
 const evidence=await readVerifiedFeedbackEvidence(storage,i);
 if(!evidence||evidence.sitePublicationId!==record.sitePublicationId||
    evidence.proofFileId!==record.proofFileId){
  await storage.transaction(async tx=>{
   const row=await tx.get(resultKey(i));
   if(row?.status==="settling")
    await tx.put(resultKey(i),{...row,status:"reconciliation_required",
     ledgerStatus:"requires_reconciliation"});
  });
  return {ok:false,accountId:i.accountId,status:"reconciliation_required"};
 }
 let outcome;
 try{outcome=await settleSecondaryFeedbackCredit(storage,env,i);}
 catch{outcome={ok:false,status:"reconciliation_required"};}
 const completed=outcome?.ok===true&&outcome.status==="completed";
 await storage.transaction(async tx=>{
  const row=await tx.get(resultKey(i));
  if(row?.status==="settling")await tx.put(resultKey(i),{
   ...row,status:completed?"completed":"reconciliation_required",
   ledgerStatus:completed?"completed":"requires_reconciliation"
  });
  if(completed){
   const operation=await tx.get(publicationKey(i));
   if(operation?.status==="attempted"&&verifyAccountCallback(operation.identity,callback))
    await tx.put(publicationKey(i),{...operation,status:"completed"});
  }
 });
 return {ok:completed,accountId:i.accountId,status:completed?"completed":"reconciliation_required"};
}
export async function secondaryVerifiedResultStatus(storage,identity){
 const i=createAccountOperation(identity);
 if(i.accountId==="yan_first")throw Error("Legacy publisher immutable");
 const [result,evidence]=await Promise.all([
  storage.get(resultKey(i)),readVerifiedFeedbackEvidence(storage,i)]);
 if(!result)return {ok:true,accountId:i.accountId,status:"not_started",proofPresent:false};
 if(!verifyAccountCallback(result.identity,i))throw Error("Result identity mismatch");
 return {ok:true,accountId:i.accountId,status:result.status,
  proofPresent:!!evidence&&evidence.sitePublicationId===result.sitePublicationId&&
   evidence.proofFileId===result.proofFileId,
  creditStatus:result.ledgerStatus};
}

// Entrypoint for a FUTURE authenticated Chromium receiver, not exposed to
// clients. Its proof fields are cryptographically bound to the stored attempt.
// Moderation/author confirmation MUST come from trusted server-owned records,
// not from the runner or a user-submitted callback.
export async function recordAttestedSecondaryResult(storage,{
 secret,input,signature,at,moderatorApproved,independentAuthorConfirmed
}){
 if(moderatorApproved!==true||independentAuthorConfirmed!==true)
  throw Error("Independent author and moderation records required");
 const verified=await verifySecondaryResultAttestation(storage,{
  secret,input,signature,at
 });
 return recordSecondaryVerifiedResult(storage,{
  original:verified.identity,callback:verified.identity,
  sitePublicationId:verified.sitePublicationId,
  proofFileId:verified.proofFileId,
  moderatorApproved,independentAuthorConfirmed,
  verifiedByTrustedExecutor:verified.verifiedByTrustedExecutor,
  at:verified.at
 });
}

// Trusted receiver adapter: atomically consume the one-use callback ticket
// before saving proof. The moderator and original-author confirmation must
// come from server records, NOT request fields. This is still not an HTTP route.
export async function recordTicketedSecondaryResult(storage,{
 identity,token,secret,input,signature,at,moderatorApproved,independentAuthorConfirmed
}){
 if(moderatorApproved!==true||independentAuthorConfirmed!==true)
  throw Error("Trusted author and moderation confirmation missing");
 const verified=await claimSecondaryCallbackTicket(storage,{
  identity,token,secret,input,signature,at
 });
 return recordSecondaryVerifiedResult(storage,{
  original:verified.identity,callback:verified.identity,
  sitePublicationId:verified.sitePublicationId,
  proofFileId:verified.proofFileId,moderatorApproved,independentAuthorConfirmed,
  verifiedByTrustedExecutor:true,at:verified.at
 });
}
