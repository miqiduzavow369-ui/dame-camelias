// Shared atomic credit ledger adapter for independent, verified secondary-man feedback.
// Existing legacy Yan publication credits remain unmodified. This is not a
// publication executor and MUST NOT be invoked from untrusted client fields.
import {requirePublicationIdentity,manStorageKey} from "./man_account_isolation.js";
import {credits,fenceUnstartedSecondaryReservation} from "./publication_credits.js";
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
 // Keep the existing operation-specific nonce stable for legacy reconciliation.
 // New ledger claims additionally carry the explicit secondary account scope.
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
 // The actual shared credit object keys secondary claims by account+kind+profile.
 // The client balance remains shared; only duplicate/publication identity differs.
 await storage.transaction(async tx=>{
  const old=await tx.get(claimKey);
  if(old)throw Error("Credit already reserved or attempted");
  await tx.put(claimKey,{accountId:i.accountId,userId:i.userId,profileId:i.profileId,
   kind:i.kind,nonce:i.nonce,ledgerNonce,ledgerAccountId:i.accountId,status:"reserving"});
 });
 try{
  const result=await credits(env,i.userId,"reserve",i.kind,i.profileId,ledgerNonce,i.accountId);
  if(result?.ok===false&&["empty","already_claimed","reserve_fenced"].includes(result.reason)){
   await storage.transaction(async tx=>{
    const old=await tx.get(claimKey);
    if(old?.status==="reserving")await tx.put(claimKey,{...old,status:"reserve_rejected",reason:result.reason});
   });
   return {ok:false,accountId:i.accountId,status:"reserve_rejected",reason:result.reason};
  }
  if(result?.ok!==true)throw Error("Credit reserve refused");
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
  if(!old||old.accountId!==i.accountId||old.status!=="reserved"||
     old.ledgerAccountId!=null&&old.ledgerAccountId!==i.accountId)
   throw Error("Credit claim not ready");
  await tx.put(claimKey,{...old,status:"settling"});
  return old;
 });
 try{
  const result=await credits(env,i.userId,"complete",i.kind,i.profileId,accepted.ledgerNonce,accepted.ledgerAccountId??null);
  if(!result?.ok)throw Error("Credit settlement not confirmed");
  await storage.transaction(async tx=>{
   const old=await tx.get(claimKey);
   if(old?.status==="settling")await tx.put(claimKey,{...old,status:"completed"});
  });
  return {ok:true,accountId:i.accountId,status:"completed"};
 }catch{
  // Preserve the ambiguous ledger outcome in the operation record. Never
  // auto-retry the external completion: it may already have succeeded.
  await storage.transaction(async tx=>{
   const row=await tx.get(claimKey);
   if(row?.status==="settling")await tx.put(claimKey,{
    ...row,status:"reconciliation_required"
   });
  });
  return {ok:false,accountId:i.accountId,status:"reconciliation_required"};
 }
}

export async function reconcileUnstartedSecondaryReservations(storage,env,source){
 const base=validate({...source,nonce:"000000000000"});
 const prefix=manStorageKey({...base,scope:"operation"})+":"+base.kind+":";
 const pubKey=manStorageKey({...base,scope:"publication"})+":"+base.kind;
 if(typeof storage.list!=="function"||await storage.get(pubKey))return;
 const rows=await storage.list({prefix});
 for(const [claimKey,row] of rows){
  if(!["reserving","reconciliation_required"].includes(row?.status)||
     row.userId!==base.userId||row.accountId!==base.accountId||
     row.profileId!==base.profileId||row.kind!==base.kind)continue;
  const i=validate(row);
  if(key(i)!==claimKey||row.ledgerNonce!==await uniqueNonce(i)||
     row.ledgerAccountId!=null&&row.ledgerAccountId!==i.accountId)continue;
  const callbackKey=manStorageKey({...i,scope:"callback"})+":"+i.kind+":"+i.nonce;
  if(await storage.get(callbackKey))continue;
  const status=await fenceUnstartedSecondaryReservation(env,i,row.ledgerNonce,!row.ledgerAccountId);
  if(status.canRetire!==true)continue;
  await storage.transaction(async tx=>{
   const current=await tx.get(claimKey);
   if(!await tx.get(pubKey)&&!await tx.get(callbackKey)&&current?.status===row.status&&
      current.ledgerNonce===row.ledgerNonce)
    await tx.put(claimKey,{...current,status:"reserve_rejected",reason:"no_reservation_fenced"});
  });
 }
}

