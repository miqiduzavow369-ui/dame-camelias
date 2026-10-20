// Shared fail-closed dispatch contract for secondary Chromium publishers.
// This module never performs external submission or exposes credentials.
// It must be called using trusted server-owned records, not Mini App parameters.
import {createAccountOperation,verifyAccountCallback} from "./man_account_isolation.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";

const HOSTS=new Set(["intimcity.rip","a.intimcity.rip","b.intimcity.rip"]);
const positive=n=>Number.isSafeInteger(n)&&n>0;

export function validateSecondaryDispatchContract({
 identity,publication,credit,proxy,site,approval,verifiedIdentity,
 selectedHost,ownerOperationConfirmed,independentAuthorConfirmed
}={}){
 const i=createAccountOperation(identity);
 if(i.accountId==="yan_first")throw Error("Legacy Yan First must never use secondary dispatch");
 if(!HOSTS.has(selectedHost)||typeof selectedHost!=="string"||
    selectedHost!==selectedHost.toLowerCase())throw Error("Unapproved site host");
 if(publication?.status!=="prepared"||publication?.attempted!==false||
    !verifyAccountCallback(publication.identity,i))
  throw Error("Missing account-bound unattempted publication");
 if(credit?.status!=="reserved"||credit?.accountId!==i.accountId||
    credit?.userId!==i.userId||credit?.profileId!==i.profileId||
    credit?.kind!==i.kind||credit?.nonce!==i.nonce)
  throw Error("Missing isolated credit reservation");
 if(proxy?.accountId!==i.accountId||proxy?.proxyVerified!==true||
    proxy?.ipVerified!==true||!positive(proxy.version)||
    site?.accountId!==i.accountId||site?.configured!==true||
    !positive(site.version)||site.boundProxyVersion!==proxy.version||
    publication.proxyVersion!==proxy.version||
    publication.siteVersion!==site.version||
    !approvalMatchesConfiguration(approval,i.accountId,proxy.version,site.version))
  throw Error("Account configuration changed or is not approved");
 if(verifiedIdentity?.accountId!==i.accountId||
    !positive(verifiedIdentity.proxyVersion)||
    verifiedIdentity.proxyVersion!==proxy.version||
    verifiedIdentity.siteVersion!==site.version||
    typeof verifiedIdentity.siteAccountId!=="string"||
    verifiedIdentity.siteAccountId.length<4)
  throw Error("Verified account identity is missing or stale");
 if(ownerOperationConfirmed!==true||independentAuthorConfirmed!==true||
    publication.independentAuthorConfirmed!==true||
    (i.kind==="review"&&publication.moderatorApproved!==true))
  throw Error("Operation not independently authorized");
 // Explicitly return an identity-only envelope; no proxy or site secret,
 // and no implicit fallback to the existing Yan First GitHub Actions job.
 return Object.freeze({identity:i,accountId:i.accountId,profileId:i.profileId,
   kind:i.kind,nonce:i.nonce,siteHost:selectedHost,
   proxyVersion:proxy.version,siteVersion:site.version,
   dispatchRoute:"isolated_secondary_only",maySubmit:false});
}

/**
 * Server-side adapter for the existing sealed-man records and publication gate.
 * Call only from an authenticated, account-pinned coordinator.
 * All configuration is read from trusted storage, not from the client request.
 *
 * Readiness is a snapshot, NOT a publication grant: no external POST is enabled.
 */
export async function readSecondaryDispatchPreflight(storage,{
 identity,ownerOperationConfirmed,independentAuthorConfirmed
}={}){
 const i=createAccountOperation(identity);
 if(i.accountId==="yan_first")throw Error("Legacy Yan First must never use secondary dispatch");
 if(!storage||typeof storage.get!=="function")throw Error("Trusted storage required");
 const prefix=["man-account-v1",i.userId,i.accountId];
 const [publication,credit,proxy,site,approval,verifiedIdentity]=await Promise.all([
  storage.get(prefix.join(":")+":publication:"+i.profileId+":"+i.kind),
  storage.get(prefix.join(":")+":operation:"+i.profileId+":"+i.kind+":"+i.nonce+":ledger"),
  storage.get("man-proxy-sealed-v1:"+i.accountId),
  storage.get("man-intimcity-sealed-v1:"+i.accountId),
  storage.get("man-owner-approval-v1:"+i.accountId),
  storage.get("secondary-site-identity-v1:"+i.accountId)
 ]);
 let selectedHost;
 try{selectedHost=new URL(site?.siteUrl).hostname;}
 catch{throw Error("Approved site URL unavailable");}
 return validateSecondaryDispatchContract({identity:i,publication,credit,proxy,site,
  approval,verifiedIdentity,selectedHost,ownerOperationConfirmed,independentAuthorConfirmed});
}
