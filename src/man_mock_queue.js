// OFFLINE-ONLY transactional queue for future male executor handoffs.
// Not reachable from production API, never talks to a site, proxy or ledger.
// Every durable record is a strict allowlist of simulation-only fields.
import {createMockHandoff,simulateManExecution} from "./man_executor_contract.js";

const PREFIX="man-mock-queue-v1:";
const MAX_ITEMS=300;
const MAX_HISTORY=50;
const ALLOWED=Object.freeze([
 "schema","mode","accountId","activationVersion","userId","profileId",
 "kind","nonce","correlationKey","operationKey","callbackKey","proofKey",
 "globalDailyLock","globalPublicationLock","globalReviewLock"
]);
const OWNER_RE=/^[1-9]\d{4,15}$/;
function owner(actorId,ownerId){
 if(typeof actorId!=="string"||typeof ownerId!=="string"||
    !OWNER_RE.test(ownerId)||actorId!==ownerId)throw Error("Unauthorized simulation");
}
function boundedTime(at){
 if(!Number.isSafeInteger(at)||at<0)throw Error("Invalid simulation timestamp");
 return at;
}
function atomic(storage){
 if(typeof storage?.transaction!=="function")throw Error("Atomic simulation storage required");
 return storage;
}
function safeTask(input,moscowDate){
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Invalid mock task");
 if(Object.keys(input).length!==ALLOWED.length||
   !ALLOWED.every(k=>Object.prototype.hasOwnProperty.call(input,k)))throw Error("Unexpected task fields");
 const task=Object.freeze(Object.fromEntries(ALLOWED.map(k=>[k,input[k]])));
 // Full canonical identity/nonce/site-global-key verification, with an independent day.
 simulateManExecution(task,{moscowDate});
 return task;
}
const key=task=>PREFIX+task.correlationKey;
const brief=x=>Object.freeze({
 accountId:x.task.accountId,profileId:x.task.profileId,
 kind:x.task.kind,nonce:x.task.nonce,correlationKey:x.task.correlationKey,
 status:x.status,createdAt:x.createdAt,finishedAt:x.finishedAt,
 outcome:x.receipt?.outcome??null,sitePublished:false,creditsDebited:false
});
export async function enqueueMockManTask(storage,{actorId,ownerId,identity,moscowDate,serverActivation,stagingDraft,at}){
 owner(actorId,ownerId);boundedTime(at);atomic(storage);
 const task=safeTask(createMockHandoff(identity,{moscowDate,serverActivation,stagingDraft}),moscowDate);
 return storage.transaction(async tx=>{
  const k=key(task);
  const existing=await tx.get(k);
  if(existing!==undefined){
   if(!existing||JSON.stringify(existing.task)!==JSON.stringify(task))
    throw Error("Conflicting mock task");
   return Object.freeze({created:false,...brief(existing)});
  }
  const item={task,moscowDate,status:"queued",createdAt:at,finishedAt:null,receipt:null};
  await tx.put(k,item);
  return Object.freeze({created:true,...brief(item)});
 });
}
export async function finishMockManTask(storage,{actorId,ownerId,task,moscowDate,result="mock_success",at}){
 owner(actorId,ownerId);boundedTime(at);atomic(storage);
 const expected=safeTask(task,moscowDate);
 // Only the independently supplied outcome is accepted, never caller-supplied
 // publication proof, site state, credit settlement, or callback object.
 const receipt=simulateManExecution(expected,{moscowDate,result});
 return storage.transaction(async tx=>{
  const k=key(expected),item=await tx.get(k);
  if(!item||item.moscowDate!==moscowDate||JSON.stringify(item.task)!==JSON.stringify(expected))
   throw Error("Unknown or mismatched mock task");
  if(item.status!=="queued"){
   if(item.receipt?.outcome!==receipt.outcome)throw Error("Mock outcome already final");
   return Object.freeze({changed:false,...brief(item)});
  }
  if(at<item.createdAt)throw Error("Out-of-order mock completion");
  const final={task:item.task,moscowDate:item.moscowDate,status:receipt.status,createdAt:item.createdAt,finishedAt:at,receipt};
  await tx.put(k,final);
  return Object.freeze({changed:true,...brief(final)});
 });
}
export async function readMockManTask(storage,{actorId,ownerId,task,moscowDate}){
 owner(actorId,ownerId);
 const expected=safeTask(task,moscowDate);
 const item=await storage.get(key(expected));
 if(!item||item.moscowDate!==moscowDate||JSON.stringify(item.task)!==JSON.stringify(expected))return null;
 return brief(item);
}
