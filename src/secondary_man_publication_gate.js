// Publication coordinator primitives for future secondary-men executor wiring.
// Fail-closed and not called by production until per-man site identity, client
// authorization, credit reserve, callback, archive and proof are integrated.
// Never share a legacy Yan First state key or retry an uncertain external POST.
import {createAccountOperation,verifyAccountCallback,manStorageKey} from "./man_account_isolation.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";

function requireSecondary(identity){
 const x=createAccountOperation(identity);
 if(x.accountId==="yan_first")throw Error("Legacy route immutable");
 return x;
}
function key(x){
 // Account + client + profile + publication type all isolated.
 return manStorageKey({userId:x.userId,accountId:x.accountId,scope:"publication",profileId:x.profileId})+":"+x.kind;
}
export async function prepareSecondaryPublication(storage,{identity,approval,proxyVersion,siteVersion,verifiedSiteIdentity,ownerConfirmed,creditReserved,independentAuthorConfirmed,moderationApproved,executorConnected,callbackConnected,proofAndLedgerConnected}){
 const x=requireSecondary(identity);
 if(!approvalMatchesConfiguration(approval,x.accountId,proxyVersion,siteVersion)||
   verifiedSiteIdentity!==true||ownerConfirmed!==true||creditReserved!==true||
   independentAuthorConfirmed!==true||
   (x.kind==="review"&&moderationApproved!==true)||
   executorConnected!==true||callbackConnected!==true||proofAndLedgerConnected!==true)
   throw Error("Secondary publication prerequisites not verified");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 const storageKey=key(x);
 return storage.transaction(async tx=>{
  // Do not overwrite ANY existing claim, including terminal or uncertain results.
  if(await tx.get(storageKey))throw Error("Publication already claimed");
  const operation={identity:x,status:"prepared",attempted:false,proxyVersion,siteVersion,
   independentAuthorConfirmed:true,moderatorApproved:x.kind==="review"?true:false};
  await tx.put(storageKey,operation);
  return Object.freeze({...operation});
 });
}
export async function claimSecondaryPublication(storage,{original,callback}){
 const x=requireSecondary(original);
 if(!verifyAccountCallback(x,callback))throw Error("Publication callback identity mismatch");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async tx=>{
  const storageKey=key(x),current=await tx.get(storageKey);
  if(!current||current.status!=="prepared"||current.attempted===true||
     !verifyAccountCallback(current.identity,callback))
    throw Error("Publication already attempted or unavailable");
  // Record durable attempt BEFORE the site submit; no automatic POST retry.
  const next={...current,status:"attempted",attempted:true};
  await tx.put(storageKey,next);
  return Object.freeze({...next});
 });
}
export async function markSecondaryPublicationUncertain(storage,{original,callback}){
 const x=requireSecondary(original);
 if(!verifyAccountCallback(x,callback))throw Error("Publication callback identity mismatch");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async tx=>{
  const storageKey=key(x),current=await tx.get(storageKey);
  if(!current||current.status!=="attempted"||current.attempted!==true||
     !verifyAccountCallback(current.identity,callback))
    throw Error("Attempt not found");
  const next={...current,status:"uncertain"};
  await tx.put(storageKey,next);
  return Object.freeze({...next});
 });
}
