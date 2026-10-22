// Secondary rating launch: exact server-owned selection snapshot and one attempt.
import {createAccountOperation,manStorageKey} from "./man_account_isolation.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";
import {reserveSecondaryFeedbackCredit} from "./secondary_man_credit_bridge.js";
import {prepareSecondaryPublication} from "./secondary_man_publication_gate.js";
import {dispatchApprovedSecondaryPublication} from "./secondary_man_runner_bridge.js";

const encoder=new TextEncoder();
function dkey(i){return manStorageKey({...i,scope:"rating-draft"})+":rating";}
function pkey(i){return manStorageKey({...i,scope:"publication"})+":rating";}
async function digest(value){
 const bytes=await crypto.subtle.digest("SHA-256",encoder.encode(value));
 return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
/** The SAME exact validation is used by read-only prepare and live launch.
 * Returns only server-private records; never send proxy/site records to the UI.
 * No credit reservations, dispatch, or site requests occur here.
 */
export async function preflightSecondaryRating(storage,env,{identity}={}){
 const i=createAccountOperation(identity);
 if(i.accountId==="yan_first"||i.kind!=="rating")
  throw Error("Legacy rating route immutable");
 if(!env?.DC_ACTIONS_TOKEN||!env?.ANKETA_CALLBACK_TOKEN||
  !env?.SECONDARY_CALLBACK_HMAC_KEY||!env?.MAN_PROXY_ENCRYPTION_KEY||
  !env?.MAN_SITE_ENCRYPTION_KEY||!env?.VISITORS_KV||!env?.ORDER_REMINDERS)
  throw Error("Secondary rating publishing unavailable");
 const [draft,old,proxy,site,approval,verified,profile]=await Promise.all([
  storage.get(dkey(i)),storage.get(pkey(i)),
  storage.get("man-proxy-sealed-v1:"+i.accountId),
  storage.get("man-intimcity-sealed-v1:"+i.accountId),
  storage.get("man-owner-approval-v1:"+i.accountId),
  storage.get("secondary-site-identity-v1:"+i.accountId),
  env.VISITORS_KV.get("owner_anketa_saved:"+i.userId+":"+i.profileId,"json")
 ]);
 // Explain the first safe reason for rejection. Nothing secret is exposed.
 if(old)throw Error("rating_attempt_already_claimed");
 if(!draft||draft.accountId!==i.accountId||draft.userId!==i.userId||
    draft.profileId!==i.profileId||draft.kind!=="rating"||
    !Number.isSafeInteger(draft.version)||draft.version<1||
    typeof draft.catalogSignature!=="string")
   throw Error("rating_saved_draft_mismatch");
 if(profile?.confirmed!==true||String(profile.profile?.id)!==i.profileId)
   throw Error("rating_saved_profile_mismatch");
 if(!proxy||proxy.accountId!==i.accountId||
    proxy.proxyVerified!==true||proxy.ipVerified!==true||
    !Number.isSafeInteger(proxy.version)||proxy.version<1)
   throw Error("rating_proxy_not_verified");
 if(!site||site.accountId!==i.accountId||
    site.boundProxyVersion!==proxy.version||
    !Number.isSafeInteger(site.version)||site.version<1)
   throw Error("rating_site_binding_mismatch");
 if(!approvalMatchesConfiguration(approval,i.accountId,proxy.version,site.version))
   throw Error("rating_owner_approval_stale");
 if(verified?.accountId!==i.accountId||
    verified.proxyVersion!==proxy.version||
    verified.siteVersion!==site.version||
    typeof verified.siteAccountId!=="string"||!verified.siteAccountId.trim())
   throw Error("rating_site_identity_stale");
 const catalog=JSON.parse(draft.catalogSignature);
 if(!Array.isArray(catalog)||catalog.length<1||catalog.length>120||
  !draft.selected||typeof draft.selected!=="object"||
  typeof draft.metElsewhere!=="boolean")
  throw Error("Invalid stored rating draft");
 const selections=Object.entries(draft.selected).map(([key,value])=>{
  const index=Number(key),field=catalog[index];
  if(!/^(0|[1-9][0-9]*)$/.test(key)||!Number.isSafeInteger(index)||
   index>=catalog.length||typeof value!=="string"||
   !field||!Array.isArray(field.options)||!field.options.includes(value))
    throw Error("Rating selections changed");
  return {index,label:field.label,value};
 }).sort((a,b)=>a.index-b.index);
 if(selections.length<1||selections.length>120)
  throw Error("Empty rating selection");
 // Match Yan First's original coverage rule, not merely nonempty selections.
 const mandatory=new Set(["соответствие фото","соотв. параметров",
  "соответствие параметров","реальная инди","отношение к клиенту","общая оценка"]);
 let missing=0,optionalTotal=0,optionalFilled=0;
 for(let ix=0;ix<catalog.length;ix++){
  const label=String(catalog[ix].label||"").trim().toLowerCase();
  if(label==="isfair"||label==="фото соответствует")continue;
  if(mandatory.has(label)){if(!draft.selected[ix])missing++;continue;}
  if(!catalog[ix].options?.length)continue;
  optionalTotal++;if(draft.selected[ix])optionalFilled++;
 }
 if(missing||optionalFilled<Math.ceil(optionalTotal*0.2))
  throw Error("Incomplete rating selections");
 const payload={metElsewhere:draft.metElsewhere,selections};
 const fingerprint=await digest(JSON.stringify(payload));
 return {draft,proxy,site,approval,verified,selections,fingerprint};
}
export async function launchApprovedSecondaryRating(storage,env,{identity,at,dispatch=null}={}){
 const i=createAccountOperation(identity);
 if(i.accountId==="yan_first"||i.kind!=="rating"||
  !Number.isSafeInteger(at)||at<0||typeof storage?.transaction!=="function"||
  !env?.DC_ACTIONS_TOKEN||!env?.ANKETA_CALLBACK_TOKEN||
  !env?.SECONDARY_CALLBACK_HMAC_KEY||!env?.MAN_PROXY_ENCRYPTION_KEY||
  !env?.MAN_SITE_ENCRYPTION_KEY||!env?.VISITORS_KV||!env?.ORDER_REMINDERS)
  throw Error("Secondary rating publishing unavailable");
 const {draft,proxy,site,approval,selections,fingerprint}=
  await preflightSecondaryRating(storage,env,{identity:i});
 const reserved=await reserveSecondaryFeedbackCredit(storage,env,i,{
  independentAuthorConfirmed:true,moderatorApproved:true
 });
 if(reserved?.ok!==true)throw Error(reserved?.reason==="empty"?"rating_credit_empty":"Rating credit unavailable");
 await prepareSecondaryPublication(storage,{
  identity:i,approval,proxyVersion:proxy.version,siteVersion:site.version,
  verifiedSiteIdentity:true,ownerConfirmed:true,creditReserved:true,
  independentAuthorConfirmed:true,moderationApproved:false,
  executorConnected:true,callbackConnected:true,proofAndLedgerConnected:true
 });
 await storage.transaction(async tx=>{
  const p=await tx.get(pkey(i));
  if(p?.status!=="prepared"||p.attempted!==false)
   throw Error("Rating preparation changed");
  await tx.put(pkey(i),{...p,ratingDraftVersion:draft.version,
   ratingSelections:selections,ratingSelectionsSha256:fingerprint});
 });
 const trustedDispatch=dispatch||(async args=>{
  const resp=await fetch("https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/secondary-man-rating-publish.yml/dispatches",{
   method:"POST",headers:{
    Authorization:"Bearer "+env.DC_ACTIONS_TOKEN,
    Accept:"application/vnd.github+json",
    "X-GitHub-Api-Version":"2022-11-28",
    "Content-Type":"application/json","User-Agent":"dame-camelias-worker"
   },body:JSON.stringify({ref:"main",inputs:{
    account_id:args.accountId,user_id:args.userId,profile_id:args.profileId,
    nonce:args.nonce,callback_ticket:args.callbackTicket,site_host:args.siteHost
   }}),signal:AbortSignal.timeout(15000)
  });
  return {accepted:resp.status===204};
 });
 return dispatchApprovedSecondaryPublication(storage,{
  identity:i,ownerOperationConfirmed:true,independentAuthorConfirmed:true,
  trustedDispatch,at
 });
}

