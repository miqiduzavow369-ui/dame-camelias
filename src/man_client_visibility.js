// Presentation visibility ONLY. Does not grant or revoke any publication capability.
// OWNER controls all 30 accounts independently via the private cabinet coordinator.
import {requireManId} from "./man_account_isolation.js";
const PREFIX="man-client-visibility-v1:";
export async function manVisibility(storage,accountId){
 requireManId(accountId);
 const x=await storage.get(PREFIX+accountId);
 if(x==null)return Object.freeze({accountId,visible:true,version:0});
 if(x.accountId!==accountId||typeof x.visible!=="boolean"||
   !Number.isSafeInteger(x.version)||x.version<1)
  throw Error("Invalid man visibility record");
 return Object.freeze({accountId,visible:x.visible,version:x.version});
}
export async function changeManVisibility(storage,{actorId,cabinetId,ownerId,accountId,visible,expectedVersion}){
 requireManId(accountId);
 if(typeof actorId!=="string"||actorId!==cabinetId||actorId!==ownerId)throw Error("Forbidden");
 if(typeof visible!=="boolean"||!Number.isSafeInteger(expectedVersion)||expectedVersion<0)
  throw Error("Invalid visibility request");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async tx=>{
  const old=await manVisibility(tx,accountId);
  if(old.version!==expectedVersion)throw Error("Visibility version conflict");
  const next={accountId,visible,version:old.version+1};
  await tx.put(PREFIX+accountId,next);
  return Object.freeze({...next});
 });
}
export async function clientManVisibilityMap(storage,accounts){
 const results=await Promise.all(accounts.map(async man=>{
  try{return [man.id,(await manVisibility(storage,man.id)).visible];}
  catch{return [man.id,false];} // bad storage cannot leak an invisible account
 }));
 return new Map(results);
}
