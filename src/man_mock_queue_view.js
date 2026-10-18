// Read-only safe projection for the isolated mock executor queue.
// No real publication or customer data, and no full task envelopes leave storage.
import {requireManId} from "./man_account_isolation.js";
import {simulateManExecution} from "./man_executor_contract.js";

const PREFIX="man-mock-queue-v1:";
const OWNER_RE=/^[1-9]\d{4,15}$/;
export async function listMockManQueue(storage,{actorId,ownerId,accountId,limit=50}={}){
 if(typeof actorId!=="string"||typeof ownerId!=="string"||
    !OWNER_RE.test(ownerId)||actorId!==ownerId)throw Error("Unauthorized mock queue read");
 if(typeof storage?.list!=="function")throw Error("Mock queue list unavailable");
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error("Invalid queue list limit");
 if(accountId!==undefined){
  requireManId(accountId);
  if(accountId==="yan_first")throw Error("Legacy queue is excluded");
 }
 // Bounded scan; reaching the limit is an error, not a partial/unreliable view.
 const entries=await storage.list({prefix:PREFIX,limit:301});
 if(entries.size>300)throw Error("Mock queue exceeds safe capacity");
 const items=[];
 for(const [key,item] of entries){
  const t=item?.task;
  if(!t||t.mode!=="simulation"||t.schema!==1||
     !key.startsWith(PREFIX)||key!==PREFIX+t.correlationKey||
     !["queued","completed","rejected"].includes(item.status)||
     !Number.isSafeInteger(item.createdAt)||item.createdAt<0||
     !(item.finishedAt===null||Number.isSafeInteger(item.finishedAt)&&item.finishedAt>=item.createdAt))
   continue;
  try{
   requireManId(t.accountId);
   // Reconstruct all account and site-wide IDs with the saved Moscow day.
   // This rejects nested data, tampered identifiers and stale malformed rows.
   simulateManExecution(t,{moscowDate:item.moscowDate});
  }catch{continue}
  if(t.accountId==="yan_first"||(accountId&&t.accountId!==accountId))continue;
  const expectedOutcome=item.status==="completed"?"mock_success":
                        item.status==="rejected"?"mock_rejected":null;
  if(expectedOutcome===null){
   if(item.receipt!==null||item.finishedAt!==null)continue;
  }else if(item.receipt?.outcome!==expectedOutcome||
           item.receipt.sitePublished!==false||
           item.receipt.creditsDebited!==false||
           item.receipt.proofSubmitted!==false||
           item.finishedAt===null)continue;
  // Never return task, activation, session, proxy or user identifiers.
  items.push(Object.freeze({
   accountId:t.accountId,profileId:t.profileId,
   kind:t.kind,nonce:t.nonce,correlationKey:t.correlationKey,
   status:item.status,createdAt:item.createdAt,finishedAt:item.finishedAt,
   outcome:expectedOutcome,sitePublished:false,creditsDebited:false
  }));
 }
 items.sort((a,b)=>b.createdAt-a.createdAt||b.correlationKey.localeCompare(a.correlationKey));
 return Object.freeze(items.slice(0,limit));
}
