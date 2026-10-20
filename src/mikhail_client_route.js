// Backwards-compatible facade for Mikhail; all 29 new men share one contract.
// Do not touch legacy Yan First publication, vault or proof namespaces.
import {secondaryClientRouteStatus,createSecondaryClientOperation,
 verifySecondaryClientCallback,requireSecondaryPublicationExecutor} from "./secondary_man_client_route.js";
export const MIKHAIL_ACCOUNT_ID="yan_second";
export function mikhailClientRouteStatus(){return secondaryClientRouteStatus(MIKHAIL_ACCOUNT_ID);}
export function createMikhailClientOperation(input){
 if(input?.accountId!==MIKHAIL_ACCOUNT_ID)throw Error("Mikhail identity mismatch");
 return createSecondaryClientOperation(input);
}
export function verifyMikhailClientCallback(operation,callback){
 return operation?.identity?.accountId===MIKHAIL_ACCOUNT_ID &&
  verifySecondaryClientCallback(operation,callback);
}
export function requireMikhailPublicationExecutor(){
 // Deliberately fails closed until the individual executor is wired and audited.
 try{return requireSecondaryPublicationExecutor(MIKHAIL_ACCOUNT_ID);}
 catch{throw Error("Mikhail client publisher not connected");}
}
