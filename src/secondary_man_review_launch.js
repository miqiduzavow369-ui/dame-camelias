// Trusted client coordinator: one independent review attempt per selected man
// and profile. This is never called directly from an unauthenticated callback.
import {createAccountOperation,manStorageKey} from "./man_account_isolation.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";
import {reserveSecondaryFeedbackCredit} from "./secondary_man_credit_bridge.js";
import {prepareSecondaryPublication} from "./secondary_man_publication_gate.js";
import {dispatchApprovedSecondaryPublication} from "./secondary_man_runner_bridge.js";

const encoder=new TextEncoder();
const keys=i=>({
 draft:manStorageKey({...i,scope:"review-draft"})+":review",
 moderation:manStorageKey({...i,scope:"moderation"})+":review",
 publication:manStorageKey({...i,scope:"publication"})+":review"
});
async function digest(text){
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  encoder.encode(text))),v=>v.toString(16).padStart(2,"0")).join("");
}
function secondary(identity){
 const i=createAccountOperation(identity);
 if(i.accountId==="yan_first"||i.kind!=="review")throw Error("Legacy review immutable");
 return i;
}
/** Called only through an independently authenticated admin review decision. */
export async function approveSecondaryReviewForSubmission(storage,{
 identity,draftVersion,expectedTextSha256,moderatorApproved,at
}={}){
 const i=secondary(identity),k=keys(i);
 if(!Number.isSafeInteger(draftVersion)||draftVersion<1||
    !/^[a-f0-9]{64}$/.test(expectedTextSha256||"")||
    moderatorApproved!==true||!Number.isSafeInteger(at)||
    typeof storage?.transaction!=="function")
  throw Error("Admin review approval invalid");
 return storage.transaction(async tx=>{
  const [draft,published]=await Promise.all([tx.get(k.draft),tx.get(k.publication)]);
  if(published||draft?.version!==draftVersion||
     draft?.userId!==i.userId||draft?.accountId!==i.accountId||
     draft?.profileId!==i.profileId||draft?.kind!=="review"||
     draft?.authorAttested!==true||typeof draft.text!=="string"||
     await digest(draft.text)!==expectedTextSha256)
    throw Error("Review draft changed or publication already attempted");
  await tx.put(k.moderation,{identity:i,approved:true,
   draftVersion,approvedTextSha256:expectedTextSha256,approvedAt:at});
  return {ok:true,accountId:i.accountId,profileId:i.profileId,
   draftVersion,moderated:true};
 });
}
function ready(env){
 return !!(env?.DC_ACTIONS_TOKEN&&env?.ANKETA_CALLBACK_TOKEN&&
  env?.SECONDARY_CALLBACK_HMAC_KEY&&env?.MAN_PROXY_ENCRYPTION_KEY&&
  env?.MAN_SITE_ENCRYPTION_KEY&&env?.VISITORS_KV&&env?.ORDER_REMINDERS);
}
/**
 * Authentication, saved-profile ownership and individual author consent are
 * rechecked by the calling private DO. Here moderation is read ONLY from
 * server-owned storage, never an approval Boolean supplied by the browser.
 */
export async function launchApprovedSecondaryReview(storage,env,{
 identity,ownerConfirmed,at,dispatch=null
}={}){
 const i=secondary(identity),k=keys(i);
 if(ownerConfirmed!==true||!Number.isSafeInteger(at)||at<0||
    typeof storage?.transaction!=="function"||!ready(env))
   throw Error("Secondary review runner not configured");
 const [draft,moderation,old,proxy,site,approval,verified]=await Promise.all([
  storage.get(k.draft),storage.get(k.moderation),storage.get(k.publication),
  storage.get("man-proxy-sealed-v1:"+i.accountId),
  storage.get("man-intimcity-sealed-v1:"+i.accountId),
  storage.get("man-owner-approval-v1:"+i.accountId),
  storage.get("secondary-site-identity-v1:"+i.accountId)
 ]);
 if(old||draft?.authorAttested!==true||draft?.accountId!==i.accountId||
    draft?.profileId!==i.profileId||draft?.userId!==i.userId||
    typeof draft.text!=="string"||draft.text.length<10||draft.text.length>3000||
    moderation?.approved!==true||moderation.draftVersion!==draft.version||
    moderation.identity?.accountId!==i.accountId||
    moderation.approvedTextSha256!==await digest(draft.text)||
    !approvalMatchesConfiguration(approval,i.accountId,proxy?.version,site?.version)||
    verified?.accountId!==i.accountId||
    verified?.proxyVersion!==proxy?.version||verified?.siteVersion!==site?.version||
    !verified?.siteAccountId||site?.boundProxyVersion!==proxy?.version||
    proxy?.proxyVerified!==true||proxy?.ipVerified!==true)
  throw Error("Review not independently approved or site identity stale");
 const reserved=await reserveSecondaryFeedbackCredit(storage,env,i,{
  independentAuthorConfirmed:true,moderatorApproved:true});
 if(reserved?.ok!==true)throw Error("Credit reserve requires reconciliation");
 await prepareSecondaryPublication(storage,{
  identity:i,approval,proxyVersion:proxy.version,siteVersion:site.version,
  verifiedSiteIdentity:true,ownerConfirmed:true,creditReserved:true,
  independentAuthorConfirmed:true,moderationApproved:true,
  executorConnected:true,callbackConnected:true,proofAndLedgerConnected:true
 });
 const trustedDispatch=dispatch||async args=>{
  const response=await fetch("https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/secondary-man-review-publish.yml/dispatches",{
   method:"POST",headers:{
    "Authorization":"Bearer "+env.DC_ACTIONS_TOKEN,
    "Accept":"application/vnd.github+json",
    "X-GitHub-Api-Version":"2022-11-28",
    "Content-Type":"application/json",
    "User-Agent":"dame-camelias-worker"
   },body:JSON.stringify({ref:"main",inputs:{
    account_id:args.accountId,user_id:args.userId,
    profile_id:args.profileId,nonce:args.nonce,
    callback_ticket:args.callbackTicket,site_host:args.siteHost
   }}),signal:AbortSignal.timeout(15000)
  });
  return {accepted:response.status===204};
 };
 return dispatchApprovedSecondaryPublication(storage,{
  identity:i,ownerOperationConfirmed:true,independentAuthorConfirmed:true,
  trustedDispatch,at
 });
}
