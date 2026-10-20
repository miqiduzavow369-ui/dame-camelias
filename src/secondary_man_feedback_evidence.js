// Per-client/per-man evidence register for authentic, independently submitted
// feedback. Audit metadata only; NEVER creates site posts or debits credits.
// Settlement remains the responsibility of the existing atomic credit ledger.
import {requirePublicationIdentity,manStorageKey} from "./man_account_isolation.js";
const PROOF=/^[A-Za-z0-9_-]{6,300}$/;
function identity(x){
 const i=requirePublicationIdentity(x);
 if(i.accountId==="yan_first")throw Error("Legacy archive immutable");
 return i;
}
function operationKey(i){
 return manStorageKey({userId:i.userId,accountId:i.accountId,profileId:i.profileId,scope:"history"})+":"+i.kind+":"+i.nonce;
}
export async function appendVerifiedFeedbackEvidence(storage,{identity:source,sitePublicationId,proofFileId,
 moderatorApproved,independentAuthorConfirmed,at}){
 const i=identity(source);
 if(typeof sitePublicationId!=="string"||!PROOF.test(sitePublicationId)||
    typeof proofFileId!=="string"||!PROOF.test(proofFileId)||
    moderatorApproved!==true||independentAuthorConfirmed!==true||
    !Number.isSafeInteger(at)||at<0)
  throw Error("Unverified or unconsented feedback cannot be archived");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage required");
 return storage.transaction(async tx=>{
  const key=operationKey(i);
  if(await tx.get(key))throw Error("Evidence already recorded");
  const record={accountId:i.accountId,userId:i.userId,profileId:i.profileId,
   kind:i.kind,nonce:i.nonce,sitePublicationId,proofFileId,at,
   creditSettlement:"not_requested"};
  await tx.put(key,record);
  return Object.freeze({...record});
 });
}
export async function readVerifiedFeedbackEvidence(storage,source){
 const i=identity(source);
 const record=await storage.get(operationKey(i));
 if(!record)return null;
 return record.accountId===i.accountId&&record.userId===i.userId&&
  record.profileId===i.profileId&&record.kind===i.kind&&record.nonce===i.nonce
  ?Object.freeze({...record}):null;
}
