// Credential-free staging records for owner-managed accounts 02..30.
// Durable Object storage is private to the owner's cabinet coordinator.
// Staging never authorizes login, proxy requests or publication.
import {newManSetup,validateManSetup,advanceManSetup,publicManSetup} from "./man_setup_state.js";
import {requireManId} from "./man_account_isolation.js";

const PREFIX="man-setup-draft-v1:";
const OWNER_ID_RE=/^[1-9]\d{4,15}$/;
function requireOwner(actorId, cabinetId, ownerId){
 if(typeof actorId!=="string" || !OWNER_ID_RE.test(actorId) ||
    actorId!==cabinetId || actorId!==ownerId)throw Error("Forbidden");
}
function draftKey(accountId){
 requireManId(accountId);
 if(accountId==="yan_first")throw Error("Legacy account is immutable");
 return PREFIX+accountId;
}
export async function readManSetupDraft(storage,accountId){
 const key=draftKey(accountId);
 const raw=await storage.get(key);
 return raw===undefined?newManSetup(accountId):validateManSetup(raw,accountId);
}
export async function readManSetupDrafts(storage,actorId,cabinetId,ownerId,accounts){
 requireOwner(actorId,cabinetId,ownerId);
 const items=[];
 for(const account of accounts){
  if(account.id==="yan_first"){items.push({id:account.id,setup:null});continue}
  const draft=await readManSetupDraft(storage,account.id);
  items.push({id:account.id,setup:publicManSetup(draft,account.id)});
 }
 return items;
}
// Only opt-in to the *planning* stage; no "proxy verified" or "ready" state can
// be asserted through this endpoint. All sensitive setup remains postponed.
export async function changeManSetupDraft(storage,{actorId,cabinetId,ownerId,accountId,expectedVersion,action,at}){
 requireOwner(actorId,cabinetId,ownerId);
 const key=draftKey(accountId);
 if(action!=="plan"&&action!=="reset")throw Error("Unsupported draft action");
 // Durable Object storage.transaction serializes the read/CAS/write atomically.
 // Never silently fall back to separate storage.get/put: that would allow lost updates.
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async txn=>{
   const current=await readManSetupDraft(txn,accountId);
   if(!Number.isSafeInteger(expectedVersion)||current.version!==expectedVersion)
     throw Error("Version conflict");
   const nextStage=action==="plan"?"awaiting_credentials":"not_configured";
   // Restrict transitions: no ability to imply proxy or identity checks.
   if(!((current.stage==="not_configured"&&action==="plan")||
         (current.stage==="awaiting_credentials"&&action==="reset")))
     throw Error("Invalid draft transition");
   const next=advanceManSetup(current,{accountId,expectedVersion,nextStage,at});
   await txn.put(key,next);
   return {ok:true,setup:publicManSetup(next,accountId)};
 });
}
