// Credential-free staging records for owner-managed accounts 02..30.
// Durable Object storage is private to the owner's cabinet coordinator.
// Staging never authorizes login, proxy requests or publication.
import {newManSetup,validateManSetup,advanceManSetup,publicManSetup} from "./man_setup_state.js";
import {requireManId} from "./man_account_isolation.js";

const PREFIX="man-setup-draft-v1:";
const HISTORY_PREFIX="man-setup-history-v1:";
const MAX_HISTORY=50;
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
// Owner-only audit trail of preparation status, without sensitive configuration.
export async function readManSetupHistory(storage,actorId,cabinetId,ownerId,accountId){
 requireOwner(actorId,cabinetId,ownerId);
 draftKey(accountId);
 const raw=await storage.get(HISTORY_PREFIX+accountId);
 if(!Array.isArray(raw))return [];
 return raw.filter(x=>x&&x.accountId===accountId &&
   Number.isSafeInteger(x.version)&&x.version>0 &&
   ["plan","reset"].includes(x.action) &&
   ["not_configured","awaiting_credentials"].includes(x.stage) &&
   Number.isSafeInteger(x.at)&&x.at>=0)
   .slice(-MAX_HISTORY).map(x=>Object.freeze({
     accountId,version:x.version,action:x.action,stage:x.stage,at:x.at
   }));
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
   const historyKey=HISTORY_PREFIX+accountId;
   const existing=await txn.get(historyKey);
   if(existing!==undefined&&!Array.isArray(existing))throw Error("Invalid setup history");
   // Sanitize prior records on every write: never carry unknown fields into
   // a persistent audit log, even if a previously stored record was malformed.
   const history=(existing||[]).filter(x=>
     x && typeof x==="object" && !Array.isArray(x) &&
     x.accountId===accountId &&
     Number.isSafeInteger(x.version) && x.version>0 &&
     ["plan","reset"].includes(x.action) &&
     ["not_configured","awaiting_credentials"].includes(x.stage) &&
     Number.isSafeInteger(x.at) && x.at>=0
   ).slice(-(MAX_HISTORY-1)).map(x=>({
     accountId,version:x.version,action:x.action,stage:x.stage,at:x.at
   }));
   history.push({accountId,version:next.version,action,stage:next.stage,at});
   await txn.put(key,next);
   await txn.put(historyKey,history);
   return {ok:true,setup:publicManSetup(next,accountId)};
 });
}
