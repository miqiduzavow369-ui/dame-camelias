// Server-owned identity attestation for secondary men.
// A successful login is NOT proof that the selected man owns the session.
// The verified site account ID must be obtained from the authenticated account
// page by a trusted verifier, not supplied by a client or inferred from login.
import {requireManId} from "./man_account_isolation.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";
const PREFIX="secondary-site-identity-v1:";
const ACCOUNT=/^[A-Za-z0-9][A-Za-z0-9_.+@-]{3,127}$/;
function secondary(id){
 requireManId(id);
 if(id==="yan_first")throw Error("Legacy identity immutable");
 return id;
}
export function validateIdentityEvidence({accountId,expectedSiteAccountId,observedSiteAccountId,
 proxyVersion,siteVersion,approval,technicalLogin,source}){
 secondary(accountId);
 if(source!=="trusted_authenticated_account_page"||
    typeof expectedSiteAccountId!=="string"||!ACCOUNT.test(expectedSiteAccountId)||
    typeof observedSiteAccountId!=="string"||!ACCOUNT.test(observedSiteAccountId)||
    expectedSiteAccountId!==observedSiteAccountId||
    technicalLogin!==true||
    !approvalMatchesConfiguration(approval,accountId,proxyVersion,siteVersion))
  throw Error("Authenticated Intimcity identity not verified");
 return Object.freeze({accountId,verifiedSiteAccountId:observedSiteAccountId,proxyVersion,siteVersion});
}
export async function recordVerifiedIdentity(storage,{accountId,evidence,at}){
 secondary(accountId);
 if(!evidence||evidence.accountId!==accountId||!Number.isSafeInteger(at)||at<0)
  throw Error("Invalid identity attestation");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage required");
 return storage.transaction(async tx=>{
  const proxy=await tx.get("man-proxy-sealed-v1:"+accountId);
  const site=await tx.get("man-intimcity-sealed-v1:"+accountId);
  const approval=await tx.get("man-owner-approval-v1:"+accountId);
  if(proxy?.accountId!==accountId||site?.accountId!==accountId||
     proxy.version!==evidence.proxyVersion||site.version!==evidence.siteVersion||
     site.boundProxyVersion!==proxy.version||
     proxy.proxyVerified!==true||proxy.ipVerified!==true||
     !approvalMatchesConfiguration(approval,accountId,proxy.version,site.version))
   throw Error("Stale or unapproved identity");
  const next={accountId,siteAccountId:evidence.verifiedSiteAccountId,
   proxyVersion:proxy.version,siteVersion:site.version,verifiedAt:at};
  await tx.put(PREFIX+accountId,next);
  return Object.freeze({...next});
 });
}
export async function currentVerifiedIdentity(storage,accountId){
 secondary(accountId);
 const [verified,proxy,site,approval]=await Promise.all([
  storage.get(PREFIX+accountId),storage.get("man-proxy-sealed-v1:"+accountId),
  storage.get("man-intimcity-sealed-v1:"+accountId),storage.get("man-owner-approval-v1:"+accountId)
 ]);
 return Object.freeze({accountId,verified:!!verified&&
  verified.accountId===accountId&&ACCOUNT.test(verified.siteAccountId||"")&&
  verified.proxyVersion===proxy?.version&&verified.siteVersion===site?.version&&
  site?.boundProxyVersion===proxy?.version&&proxy?.proxyVerified===true&&proxy?.ipVerified===true&&
  approvalMatchesConfiguration(approval,accountId,proxy?.version,site?.version),
  siteAccountId:null}); // Never expose identity details in client catalog
}
