// Dedicated, fail-closed identity contract for Mikhail's future client route.
// Intentionally NOT connected to the legacy Yan First publication executor.
// No credentials, migration, network requests, credit mutation or publication here.
import {getManAccount} from "./man_accounts.js";
import {createAccountOperation,verifyAccountCallback,manStorageKey} from "./man_account_isolation.js";

export const MIKHAIL_ACCOUNT_ID="yan_second";
const SCOPES=Object.freeze(["operation","rating-draft","review-draft","moderation","publication","proof","history","callback"]);

export function mikhailClientRouteStatus(){
 const account=getManAccount(MIKHAIL_ACCOUNT_ID);
 if(!account || account.number!==2)throw Error("Mikhail registry identity mismatch");
 return Object.freeze({
  accountId:MIKHAIL_ACCOUNT_ID,
  displayName:account.name,
  identityReady:true,
  executorReady:false,
  clientPublicationEnabled:false,
  state:"awaiting_isolated_executor"
 });
}

export function createMikhailClientOperation(input){
 if(!input || input.accountId!==MIKHAIL_ACCOUNT_ID)throw Error("Mikhail identity mismatch");
 const identity=createAccountOperation(input);
 const keys=Object.fromEntries(SCOPES.map(scope=>[
  scope,manStorageKey({userId:identity.userId,accountId:identity.accountId,scope,profileId:identity.profileId})
 ]));
 return Object.freeze({identity,keys:Object.freeze(keys),publicationAllowed:false});
}

export function verifyMikhailClientCallback(operation,callback){
 return !!operation && operation.publicationAllowed===false &&
  operation.identity?.accountId===MIKHAIL_ACCOUNT_ID &&
  verifyAccountCallback(operation.identity,callback);
}

// No call site may treat technical login readiness or a well-formed callback
// as permission to publish or reserve client credits.
export function requireMikhailPublicationExecutor(){
 throw Error("Mikhail client publisher not connected");
}
