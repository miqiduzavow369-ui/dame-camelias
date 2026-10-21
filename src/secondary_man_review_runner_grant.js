// One-use secondary review runner payload, restricted to an authenticated
// server-side runner callback. It cannot publish or fetch a Yan First account.
// Return plaintext only to the existing bearer-authenticated receiver, never UI.
import {createAccountOperation,manStorageKey,verifyAccountCallback} from "./man_account_isolation.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";

const encoder=new TextEncoder();
const PORT=n=>Number.isSafeInteger(n)&&n>0&&n<=65535;
function hexKey(secret){
 if(typeof secret!=="string"||!/^[a-f0-9]{64}$/i.test(secret))throw Error("Private vault unavailable");
 return Uint8Array.from(secret.match(/../g),h=>parseInt(h,16));
}
async function openVault(secret,row,aad){
 if(!Array.isArray(row?.iv)||row.iv.length!==12||
    !Array.isArray(row?.sealed)||row.sealed.length<17)throw Error("Sealed configuration invalid");
 const key=await crypto.subtle.importKey("raw",hexKey(secret),{name:"AES-GCM"},false,["decrypt"]);
 const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(row.iv),
  additionalData:encoder.encode(aad)},key,new Uint8Array(row.sealed));
 return JSON.parse(new TextDecoder().decode(plaintext));
}
function publicationKey(i){return manStorageKey({...i,scope:"publication"})+":"+i.kind;}
function draftKey(i){return manStorageKey({...i,scope:"review-draft"})+":review";}
function creditKey(i){return manStorageKey({...i,scope:"operation"})+":"+i.kind+":"+i.nonce+":ledger";}
function ticketKey(i){return manStorageKey({...i,scope:"callback"})+":"+i.kind+":"+i.nonce;}
function grantKey(i){return manStorageKey({...i,scope:"operation"})+":"+i.kind+":"+i.nonce+":runner-grant";}

/** Consume a publication-specific runner grant atomically before unsealing any secrets.
 * A failed decrypt remains consumed and needs manual reconciliation: no replays.
 */
export async function claimSecondaryReviewRunnerPayload(storage,env,{identity,token,at}={}){
 const i=createAccountOperation(identity);
 if(i.accountId==="yan_first"||i.kind!=="review"||
    typeof token!=="string"||!/^[a-f0-9]{32}$/.test(token)||
    !Number.isSafeInteger(at)||at<0||typeof storage?.transaction!=="function")
  throw Error("Secondary review grant invalid");
 const records=await storage.transaction(async tx=>{
  const [operation,credit,ticket,draft,proxy,site,approval,observed,previous]=await Promise.all([
   tx.get(publicationKey(i)),tx.get(creditKey(i)),tx.get(ticketKey(i)),
   tx.get(draftKey(i)),tx.get("man-proxy-sealed-v1:"+i.accountId),
   tx.get("man-intimcity-sealed-v1:"+i.accountId),
   tx.get("man-owner-approval-v1:"+i.accountId),
   tx.get("secondary-site-identity-v1:"+i.accountId),tx.get(grantKey(i))
  ]);
  if(previous||!operation||operation.status!=="attempted"||operation.attempted!==true||
     !verifyAccountCallback(operation.identity,i)||operation.moderatorApproved!==true||
     operation.independentAuthorConfirmed!==true||
     credit?.status!=="reserved"||credit.accountId!==i.accountId||
     credit.userId!==i.userId||credit.profileId!==i.profileId||
     credit.kind!==i.kind||credit.nonce!==i.nonce||
     ticket?.status!=="issued"||ticket.token!==token||
     !verifyAccountCallback(ticket.identity,i)||
     ticket.issuedAt>at||ticket.expiresAt<at||
     proxy?.accountId!==i.accountId||proxy.proxyVerified!==true||proxy.ipVerified!==true||
     site?.accountId!==i.accountId||site.boundProxyVersion!==proxy.version||
     operation.proxyVersion!==proxy.version||operation.siteVersion!==site.version||
     ticket.proxyVersion!==proxy.version||ticket.siteVersion!==site.version||
     observed?.accountId!==i.accountId||observed.proxyVersion!==proxy.version||
     observed.siteVersion!==site.version||typeof observed.siteAccountId!=="string"||
     !approvalMatchesConfiguration(approval,i.accountId,proxy.version,site.version)||
     draft?.accountId!==i.accountId||draft.userId!==i.userId||
     draft.profileId!==i.profileId||draft.kind!=="review"||
     draft.authorAttested!==true||typeof draft.text!=="string"||
     draft.text!==draft.text.trim()||draft.text.length<10||draft.text.length>3000)
   throw Error("Unverified secondary review runner preflight");
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(draft.text))),b=>b.toString(16).padStart(2,"0")).join("");
  await tx.put(grantKey(i),{identity:i,at,status:"claimed",approvedTextSha256:digest});
  return {draft,proxy,site,observed};
 });
 const {draft,proxy,site,observed}=records;
 const [p,s]=await Promise.all([
  openVault(env?.MAN_PROXY_ENCRYPTION_KEY,proxy,i.accountId),
  openVault(env?.MAN_SITE_ENCRYPTION_KEY,site,i.accountId+":intimcity:"+proxy.version)
 ]);
 if(p.protocol!=="http"||!PORT(p.port)||p.expectedIp!==proxy.expectedIp||
    s.siteUrl!==site.siteUrl||s.login!==observed.siteAccountId||
    typeof p.host!=="string"||typeof p.username!=="string"||
    typeof p.password!=="string"||typeof s.password!=="string"||
    !["intimcity.rip","a.intimcity.rip","b.intimcity.rip"].includes(new URL(s.siteUrl).hostname))
   throw Error("Unsealed secondary account configuration inconsistent");
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest(
  "SHA-256",encoder.encode(draft.text))),b=>b.toString(16).padStart(2,"0")).join("");
 return {ok:true,mode:"publish",kind:"review",status:"attempted",
  accountId:i.accountId,userId:i.userId,profileId:i.profileId,nonce:i.nonce,
  oneUseClaimConsumed:true,ownerOperationConfirmed:true,
  independentAuthorConfirmed:true,moderatorApproved:true,creditReserved:true,
  siteIdentityVerified:true,callbackTicket:token,approvedTextSha256:digest,
  approvedText:draft.text,proxyHost:p.host,proxyPort:p.port,
  proxyUsername:p.username,proxyPassword:p.password,expectedIp:p.expectedIp,
  proxyVersion:proxy.version,siteVersion:site.version,siteUrl:s.siteUrl,
  siteLogin:s.login,verifiedSiteLogin:observed.siteAccountId,sitePassword:s.password};
}

/** Record the submit boundary once, before any site click, for this exact text. */
export async function recordSecondaryReviewSubmitBoundary(storage,{
 identity,token,approvedTextSha256,at
}={}){
 const i=createAccountOperation(identity);
 if(i.accountId==="yan_first"||i.kind!=="review"||
    !/^[a-f0-9]{32}$/.test(token||"")||
    !/^[a-f0-9]{64}$/.test(approvedTextSha256||"")||
    !Number.isSafeInteger(at)||typeof storage?.transaction!=="function")
  throw Error("Invalid review boundary");
 return storage.transaction(async tx=>{
  const [claimed,publication,ticket]=await Promise.all([
   tx.get(grantKey(i)),tx.get(publicationKey(i)),tx.get(ticketKey(i))
  ]);
  if(claimed?.status!=="claimed"||
     !verifyAccountCallback(claimed.identity,i)||
     claimed.approvedTextSha256!==approvedTextSha256||
     ticket?.status!=="issued"||ticket.token!==token||
     !verifyAccountCallback(ticket.identity,i)||
     ticket.expiresAt<at||ticket.issuedAt>at||
     publication?.status!=="attempted"||publication.attempted!==true||
     !verifyAccountCallback(publication.identity,i))
    throw Error("Review boundary already used or mismatched");
  await tx.put(grantKey(i),{...claimed,status:"submit_boundary",boundaryAt:at});
  return {ok:true,accountId:i.accountId,stage:"review_submit_boundary"};
 });
}
