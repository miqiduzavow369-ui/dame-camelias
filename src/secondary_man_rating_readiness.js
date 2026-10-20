// Read-only rating readiness diagnosis for accounts 02..30.
// All inputs must be read from owner-controlled server state. No site POST,
// credit debit, ticket issue, or legacy Yan First dispatcher is invoked here.
import {requireManId} from "./man_account_isolation.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";

export function secondaryRatingReadiness(accountId,{
 proxy=null,site=null,approval=null,login=null,identity=null,
 executorConnected=false,callbackConnected=false,proofAndLedgerConnected=false
}={}){
 requireManId(accountId);
 if(accountId==="yan_first")throw Error("Legacy Yan First is outside secondary readiness");
 const blockers=[];
 const proxyReady=proxy?.accountId===accountId&&proxy.proxyVerified===true&&
  proxy.ipVerified===true&&Number.isSafeInteger(proxy.version)&&proxy.version>0;
 if(!proxyReady)blockers.push("proxy_unverified");
 const siteReady=site?.accountId===accountId&&site.configured===true&&
  site.boundProxyVersion===proxy?.version&&Number.isSafeInteger(site.version)&&site.version>0;
 if(!siteReady)blockers.push("site_credentials_unverified");
 const loginReady=login?.accountId===accountId&&login.technicalReady===true&&
  login.siteIdentityVerified===true;
 if(!loginReady)blockers.push("site_login_unverified");
 if(!approvalMatchesConfiguration(approval,accountId,proxy?.version,site?.version))
  blockers.push("owner_approval_required");
 if(identity?.accountId!==accountId||identity.verified!==true)
  blockers.push("site_identity_unverified");
 if(executorConnected!==true)blockers.push("isolated_executor_not_connected");
 if(callbackConnected!==true)blockers.push("callback_not_connected");
 if(proofAndLedgerConnected!==true)blockers.push("proof_and_credit_not_connected");
 return Object.freeze({accountId,kind:"rating",ready:blockers.length===0,
  blockers:Object.freeze(blockers),publicationAttempted:false});
}
