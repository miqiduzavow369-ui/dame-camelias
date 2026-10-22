// One server-owned connection contract for ADMIN and the 29 client accounts.
// Never serialise snapshot to a browser; it contains encrypted vault records.
import {requireManId} from "./man_account_isolation.js";
import {proxyStatus} from "./man_proxy_vault.js";
import {readSiteStatus} from "./man_site_vault.js";
import {siteLoginStatus,restoreVerifiedSiteIdentity} from "./man_site_login_preflight.js";
import {browserCheckStatus} from "./man_browser_preflight.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";

export async function readSecondaryConnection(storage,env,accountId,ownerId){
 requireManId(accountId);
 if(accountId==="yan_first")throw Error("Legacy connection immutable");
 // Reuse existing completed evidence; no browser, site request or new login.
 await restoreVerifiedSiteIdentity(storage,env,accountId,ownerId).catch(()=>null);
 const params={actorId:ownerId,cabinetId:ownerId,ownerId,accountId};
 const [proxyStatusRow,siteStatusRow,login,browser,proxy,site,approval,verified]=await Promise.all([
  proxyStatus(storage,params),readSiteStatus(storage,params),
  siteLoginStatus(storage,params),browserCheckStatus(storage,params),
  storage.get("man-proxy-sealed-v1:"+accountId),
  storage.get("man-intimcity-sealed-v1:"+accountId),
  storage.get("man-owner-approval-v1:"+accountId),
  storage.get("secondary-site-identity-v1:"+accountId)
 ]);
 const proxyReady=proxy?.accountId===accountId&&proxyStatusRow.proxyVerified===true&&
  proxyStatusRow.ipVerified===true&&Number.isSafeInteger(proxy.version)&&proxy.version>0;
 const siteReady=site?.accountId===accountId&&siteStatusRow.configured===true&&
  site.boundProxyVersion===proxy?.version&&Number.isSafeInteger(site.version)&&site.version>0;
 const browserReady=proxyReady&&browser.status==="verified"&&
  browser.version===proxy.version&&browser.ipVerified===true&&browser.siteReachable===true;
 const loginReady=siteReady&&browserReady&&login.technicalReady===true;
 const identityReady=loginReady&&login.siteIdentityVerified===true&&
  verified?.accountId===accountId&&verified.proxyVersion===proxy.version&&
  verified.siteVersion===site.version&&typeof verified.siteAccountId==="string"&&
  verified.siteAccountId.trim().length>0;
 const ownerApproved=approvalMatchesConfiguration(approval,accountId,proxy?.version,site?.version);
 const blockers=[];
 if(!proxyReady)blockers.push("proxy_unverified");
 if(!siteReady)blockers.push("site_credentials_unverified");
 if(!browserReady)blockers.push("browser_unverified");
 if(!loginReady)blockers.push("site_login_unverified");
 if(!identityReady)blockers.push("site_identity_unverified");
 if(!ownerApproved)blockers.push("owner_approval_required");
 const connection=Object.freeze({accountId,ready:blockers.length===0,
  technicalReady:loginReady,proxyVerified:proxyReady,ipVerified:proxyReady,
  siteConfigured:siteReady,browserVerified:browserReady,
  siteIdentityVerified:identityReady,ownerApproved,
  proxyVersion:proxy?.version??null,siteVersion:site?.version??null,
  boundProxyVersion:site?.boundProxyVersion??null,
  loginCode:login.code,loginStatus:login.status,loginVerifiedAt:login.finishedAt||null,
  blockers:Object.freeze(blockers),canPublish:false});
 return {connection,snapshot:{proxy,site,approval,verified}};
}

// Copy only the selected man's still-current ciphertext into this client's DO.
// Operations never fall back to another account or the legacy environment.
export async function installSecondaryConnection(storage,accountId,result,{publicationKey=null}={}){
 requireManId(accountId);
 if(accountId==="yan_first")throw Error("Legacy connection immutable");
 const {proxy,site,approval,verified}=result||{};
 if(proxy?.accountId!==accountId||site?.accountId!==accountId||
  !Number.isSafeInteger(proxy.version)||proxy.version<1||
  !Number.isSafeInteger(site.version)||site.version<1||
  verified?.accountId!==accountId||proxy.proxyVerified!==true||proxy.ipVerified!==true||
  site.boundProxyVersion!==proxy.version||verified.proxyVersion!==proxy.version||
  verified.siteVersion!==site.version||typeof verified.siteAccountId!=="string"||
  !verified.siteAccountId.trim()||!approvalMatchesConfiguration(approval,accountId,proxy.version,site.version))
  throw Error("Selected man's ADMIN connection is not confirmed");
 return storage.transaction(async tx=>{
  if(publicationKey&&await tx.get(publicationKey))throw Error("Publication already attempted");
  await tx.put("man-proxy-sealed-v1:"+accountId,proxy);
  await tx.put("man-intimcity-sealed-v1:"+accountId,site);
  await tx.put("man-owner-approval-v1:"+accountId,approval);
  await tx.put("secondary-site-identity-v1:"+accountId,verified);
 });
}
