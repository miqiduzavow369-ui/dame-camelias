// Private, atomic owner approvals for secondary accounts 02–30.
// This is an approval record only, NOT a publisher activation or credential vault.
// Legacy Yan First never enters this namespace.
import {requireManId} from "./man_account_isolation.js";
const PREFIX="man-owner-approval-v1:";
function authorization(actorId,cabinetId,ownerId,accountId){
 requireManId(accountId);
 if(accountId==="yan_first")throw Error("Legacy Yan First immutable");
 if(typeof actorId!=="string"||actorId!==cabinetId||actorId!==ownerId)throw Error("Forbidden");
}
export async function readSecondaryManApproval(storage,{actorId,cabinetId,ownerId,accountId}){
 authorization(actorId,cabinetId,ownerId,accountId);
 const r=await storage.get(PREFIX+accountId);
 return Object.freeze({accountId,version:Number.isSafeInteger(r?.version)?r.version:0,
  approved:r?.accountId===accountId&&r?.approved===true,
  proxyVersion:r?.accountId===accountId&&Number.isSafeInteger(r?.proxyVersion)?r.proxyVersion:null,
  siteVersion:r?.accountId===accountId&&Number.isSafeInteger(r?.siteVersion)?r.siteVersion:null});
}
export async function setSecondaryManApproval(storage,{actorId,cabinetId,ownerId,accountId,
 expectedVersion,approved,proxyVersion,siteVersion}){
 authorization(actorId,cabinetId,ownerId,accountId);
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||typeof approved!=="boolean"||
   !Number.isSafeInteger(proxyVersion)||proxyVersion<1||
   !Number.isSafeInteger(siteVersion)||siteVersion<1)throw Error("Invalid approval request");
 return storage.transaction(async tx=>{
  const key=PREFIX+accountId;
  const previous=await tx.get(key);
  if(previous!==undefined&&previous!==null&&previous.accountId!==accountId)
   throw Error("Approval identity mismatch");
  const version=previous?.version??0;
  if(version!==expectedVersion)throw Error("Approval version conflict");
  const record={accountId,version:version+1,approved,proxyVersion,siteVersion};
  await tx.put(key,record);
  return Object.freeze({...record});
 });
}
// A credentials/proxy version change invalidates the old approval automatically.
export function approvalMatchesConfiguration(approval,accountId,proxyVersion,siteVersion){
 return !!approval&&approval.accountId===accountId&&approval.approved===true&&
  approval.proxyVersion===proxyVersion&&approval.siteVersion===siteVersion&&
  Number.isSafeInteger(approval.version)&&approval.version>0;
}
