import {clientKey,validClientId,validProfileId} from "./client_isolation.js";
import {matchingVerifiedProfile} from "./client_profile_view.js";

// Drafts are private, never publications. Only verified profiles may have a draft.
export async function saveClientReviewDraft(env,userId,profileId,savedUrl,text){
 const uid=String(userId),pid=String(profileId);
 if(!validClientId(uid)||!validProfileId(pid)||!env.VISITORS_KV)return {ok:false,reason:"unavailable"};
 if(typeof text!=="string"||text.trim().length<10||text.length>3000)
   return {ok:false,reason:"length"};
 const verified=await env.VISITORS_KV.get(clientKey(uid,"saved",pid),"json");
 if(!matchingVerifiedProfile(savedUrl,verified))return {ok:false,reason:"unverified"};
 const draft={profileId:pid,verifiedUrl:savedUrl,text:text.trim(),updatedAt:Date.now()};
 await env.VISITORS_KV.put(clientKey(uid,"review_draft",pid),JSON.stringify({type:"review_draft",...draft}),{expirationTtl:86400});
 return {ok:true,draft};
}
export async function readClientReviewDraft(env,userId,profileId,savedUrl){
 const uid=String(userId),pid=String(profileId);
 if(!validClientId(uid)||!validProfileId(pid)||!env.VISITORS_KV)return null;
 const draft=await env.VISITORS_KV.get(clientKey(uid,"review_draft",pid),"json");
 if(draft?.type!=="review_draft"||draft.profileId!==pid||draft.verifiedUrl!==savedUrl)return null;
 const verified=await env.VISITORS_KV.get(clientKey(uid,"saved",pid),"json");
 return matchingVerifiedProfile(savedUrl,verified)?draft:null;
}
