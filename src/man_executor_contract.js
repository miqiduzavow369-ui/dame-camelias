// Credential-free executor handoff model, exclusively for offline simulations.
// Not an executable queue, site adapter, proxy client, or permission token.
import {planManRoute} from "./man_operation_route.js";

const OUTCOMES=new Set(["mock_success","mock_rejected"]);
const SCHEMA=1;
const correlation=identity=>["man-mock-v1",identity.userId,identity.accountId,identity.profileId,identity.kind,identity.nonce].join(":");
function ensureSafeRoute(route){
 if(!route||route.previewOnly!==true||route.canDispatch!==false||
    route.canDebit!==false||!route.identity||!route.keys)
  throw Error("Only disabled preflight routes are supported");
}
export function createMockHandoff(identity,{moscowDate,serverActivation,stagingDraft}={}){
 const route=planManRoute(identity,{moscowDate,serverActivation,stagingDraft});
 ensureSafeRoute(route);
 // Construct an allowlisted copy. Never forward credentials, site sessions,
 // raw activation config, payment details, or proxy identifiers.
 const task=Object.freeze({
  schema:SCHEMA,mode:"simulation",accountId:route.accountId,
  activationVersion:route.activationVersion,
  userId:route.identity.userId,profileId:route.identity.profileId,
  kind:route.identity.kind,nonce:route.identity.nonce,
  correlationKey:correlation(route.identity),
  operationKey:route.keys.operation,
  callbackKey:route.keys.callback,
  proofKey:route.keys.proof,
  globalDailyLock:route.keys.globalDaily,
  globalPublicationLock:route.keys.globalPublication,
  globalReviewLock:route.keys.globalReview
 });
 return task;
}
function validateTask(task){
 if(!task||typeof task!=="object"||Array.isArray(task)||
    task.schema!==SCHEMA||task.mode!=="simulation")throw Error("Invalid simulated handoff");
 // The plan is rebuilt from the supplied primitive fields, never accepted as
 // authority for dispatch or for selecting a new account.
 const date=typeof task.globalDailyLock==="string"?
   task.globalDailyLock.split(":")[2]:undefined;
 const reconstructed=Object.freeze({
  userId:task.userId,accountId:task.accountId,
  profileId:task.profileId,kind:task.kind,nonce:task.nonce
 });
 // No server activation is required to VALIDATE an inert task, but the derived
 // keys must still match the canonical profile/account and global key formats.
 const {manStorageKey,requirePublicationIdentity}=validationHelpers;
 const {globalDailyLock,globalPublicationLock,globalReviewLock}=lockHelpers;
 const identity=requirePublicationIdentity(reconstructed);
 if(identity.accountId==="yan_first")throw Error("Legacy executor is excluded");
 if(!Number.isSafeInteger(task.activationVersion)||task.activationVersion<1 ||
    date===undefined ||
    task.correlationKey!==correlation(identity)||
    task.operationKey!==manStorageKey({...identity,scope:"operation"})||
    task.callbackKey!==manStorageKey({...identity,scope:"callback"})||
    task.proofKey!==manStorageKey({...identity,scope:"proof"})||
    task.globalDailyLock!==globalDailyLock(identity.accountId,identity.profileId,date)||
    task.globalPublicationLock!==globalPublicationLock(identity.accountId,identity.profileId,identity.kind)||
    task.globalReviewLock!==(identity.kind==="review"?globalReviewLock(identity.accountId,identity.profileId):null))
   throw Error("Inconsistent simulated handoff");
 return identity;
}
import * as validationHelpers from "./man_account_isolation.js";
import * as lockHelpers from "./man_global_locks.js";

export function simulateManExecution(task,{result="mock_success"}={}){
 const identity=validateTask(task);
 if(!OUTCOMES.has(result))throw Error("Unsupported mock outcome");
 // Never log or persist the passed object; response is a deliberately minimal
 // allowlisted immutable receipt. No network call, credits, or proofs.
 return Object.freeze({
  schema:SCHEMA,mode:"simulation",
  accountId:identity.accountId,profileId:identity.profileId,
  kind:identity.kind,nonce:identity.nonce,
  status:result==="mock_success"?"completed":"rejected",
  outcome:result,sitePublished:false,creditsDebited:false,
  proofSubmitted:false
 });
}
