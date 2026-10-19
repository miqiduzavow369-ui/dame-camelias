// Shared atomic credit ledger adapter for independent, verified secondary-man feedback.
// Existing legacy Yan publication credits remain unmodified. This is not a
// publication executor and MUST NOT be invoked from untrusted client fields.
import {requirePublicationIdentity,manStorageKey} from "./man_account_isolation.js";
import {credits} from "./publication_credits.js";
import {readVerifiedFeedbackEvidence} from "./secondary_man_feedback_evidence.js";

function validate(x){
 const i=requirePublicationIdentity(x);
 if(i.accountId==="yan_first")throw Error("Legacy ledger immutable");
 return i;
}
function key(i){
 return manStorageKey({userId:i.userId,accountId:i.accountId,profileId:i.profileId,scope:"operation"})+":"+i.kind+":"+i.nonce+":ledger";
}
async function uniqueNonce(i){
 // Ledger keys omit accountId. Namespace the idempotency nonce with a stable
 // SHA-256 digest of full operation identity so two men never share one claim.
 const encoded=new TextEncoder().encode(
  ["secondary-ledger-v1",i.userId,i.accountId,i.profileId,i.kind,i.nonce].join(":"));
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",encoded));
 return Array.from(digest.slice(0,6),b=>b.toString(16).padStart(2,"0")).join("");
}
export async function reserveSecondaryFeedbackCredit(storage,env,source,{independentAuthorConfirmed,moderatorApproved}={}){
 const i=validate(source);
 if(independentAuthorConfirmed!==true||(i.kind==="review"&&moderatorApproved!==true))
  throw Error("Independent and moderated feedback required");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage required");
 const claimKey=key(i),ledgerNonce=await uniqueNonce(i);
 // DO ledger already partitions claims by client+kind+profile+nonce; different
 // men MUST NOT share that same tuple even if their callback nonce matches.
 await storage.transaction(async tx=>{
  const old=await tx.get(claimKey);
  if(old)throw Error("Credit already reserved or attempted");
  await tx.put(claimKey,{accountId:i.accountId,userId:i.userId,profileId:i.profileId,
   kind:i.kind,nonce:i.nonce,ledgerNonce,status:"reserving"});
 });
 try{
  const result=await credits(env,i.userId,"reserve",i.kind,i.profileId,ledgerNonce);
  if(!result?.ok)throw Error("Credit reserve refused");
  await storage.transaction(async tx=>{
   const old=await tx.get(claimKey);
   if(old?.status==="reserving")await tx.put(claimKey,{...old,status:"reserved"});
  });
  return {ok:true,accountId:i.accountId,userId:i.userId,profileId:i.profileId,
   kind:i.kind,status:"reserved"};
 }catch{
  // Ambiguous ledger outcome: do not automatically re-run reserve or declare
  // that no credit was reserved. Require reconciliation against ledger status.
  return {ok:false,accountId:i.accountId,status:"reconciliation_required"};
 }
}
export async function settleSecondaryFeedbackCredit(storage,env,source){
 const i=validate(source),claimKey=key(i);
 const evidence=await readVerifiedFeedbackEvidence(storage,i);
 if(!evidence||!evidence.sitePublicationId||!evidence.proofFileId)
  throw Error("Verified site proof required before credit settlement");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage required");
 const accepted=await storage.transaction(async tx=>{
  const old=await tx.get(claimKey);
  if(!old||old.accountId!==i.accountId||old.status!=="reserved")
   throw Error("Credit claim not ready");
  await tx.put(claimKey,{...old,status:"settling"});
  return old;
 });
 try{
  const result=await credits(env,i.userId,"complete",i.kind,i.profileId,accepted.ledgerNonce);
  if(!result?.ok)throw Error("Credit settlement not confirmed");
  await storage.transaction(async tx=>{
   const old=await tx.get(claimKey);
   if(old?.status==="settling")await tx.put(claimKey,{...old,status:"completed"});
  });
  return {ok:true,accountId:i.accountId,status:"completed"};
 }catch{
  // No double settlement retry while external ledger outcome is unknown.
  return {ok:false,accountId:i.accountId,status:"reconciliation_required"};
 }
}
