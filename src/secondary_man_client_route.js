// Shared, fail-closed per-man client route for accounts 02–30.
// Existing yan_first publications and legacy storage are deliberately untouched.
import {getManAccount,MAN_ACCOUNTS} from "./man_accounts.js";
import {createAccountOperation,verifyAccountCallback,manStorageKey,requireServerActivation} from "./man_account_isolation.js";

export const SECONDARY_MAN_IDS=Object.freeze(MAN_ACCOUNTS.slice(1).map(man=>man.id));
const SCOPES=Object.freeze(["operation","rating-draft","review-draft","moderation","publication","proof","history","callback"]);
function requireSecondary(accountId){
 const man=getManAccount(accountId);
 if(!man || man.number<2)throw Error("Secondary man identity mismatch");
 return man;
}
export function secondaryClientRouteStatus(accountId){
 const man=requireSecondary(accountId);
 return Object.freeze({
  accountId:man.id,displayName:man.name,identityReady:true,executorReady:false,
  clientPublicationEnabled:false,state:"awaiting_isolated_executor"
 });
}
export function createSecondaryClientOperation(input){
 const man=requireSecondary(input?.accountId);
 const identity=createAccountOperation(input);
 const keys=Object.fromEntries(SCOPES.map(scope=>[
  scope,manStorageKey({userId:identity.userId,accountId:man.id,scope,profileId:identity.profileId})
 ]));
 return Object.freeze({identity,keys:Object.freeze(keys),publicationAllowed:false});
}
export function verifySecondaryClientCallback(operation,callback){
 return !!operation && operation.publicationAllowed===false &&
  !!getManAccount(operation.identity?.accountId) &&
  operation.identity.accountId!=="yan_first" &&
  verifyAccountCallback(operation.identity,callback);
}
// A valid owner approval is necessary, not sufficient: the per-man publisher
// remains disabled until its actual secure executor, callback and settlement are wired.
export function secondaryAdminApprovalStatus(accountId,configuration){
 requireSecondary(accountId);
 try{
  const verified=requireServerActivation(accountId,configuration);
  return Object.freeze({accountId,adminApproved:true,verifiedVersion:verified.version,
    publicationAvailable:false,reason:"isolated_executor_not_connected"});
 }catch{
  return Object.freeze({accountId,adminApproved:false,publicationAvailable:false,
    reason:"admin_or_technical_readiness_missing"});
 }
}
export function requireSecondaryPublicationExecutor(accountId){
 requireSecondary(accountId);
 throw Error("Secondary man client publisher not connected");
}
