// Each secondary man must obtain criteria in his OWN authenticated browser.
// A shared list or an owner's saved profile catalog never grants form readiness.
import {requireManId} from "./man_account_isolation.js";
import {validateSharedCriteria} from "./shared_rating_criteria.js";
const PROFILE=/^\d{1,9}$/,TTL=24*60*60;
export function personalCriteriaKey(accountId,profileId){
 requireManId(accountId);
 if(accountId==="yan_first"||!PROFILE.test(String(profileId)))
  throw Error("Invalid secondary catalog identity");
 return "secondary-personal-criteria-v1:"+accountId+":"+profileId;
}
export async function savePersonalCriteria(kv,{accountId,profileId,siteHost,catalog}){
 const key=personalCriteriaKey(accountId,profileId);
 const fields=validateSharedCriteria({accountId,profileId,siteHost,catalog});
 if(typeof kv?.put!=="function")throw Error("Personal catalog storage missing");
 const value={accountId,profileId:String(profileId),siteHost,
  capturedAt:Date.now(),catalog:fields};
 await kv.put(key,JSON.stringify(value),{expirationTtl:TTL});
 return {ok:true,accountId,profileId:String(profileId),count:fields.length};
}
export async function readPersonalCriteria(kv,accountId,profileId){
 const key=personalCriteriaKey(accountId,profileId);
 const x=await kv?.get(key,"json");
 if(x?.accountId!==accountId||x?.profileId!==String(profileId)||
    !Number.isSafeInteger(x.capturedAt)||x.capturedAt>Date.now()+60000||
    Date.now()-x.capturedAt>TTL*1000)return null;
 try{return validateSharedCriteria({accountId,profileId,siteHost:x.siteHost,
  catalog:x.catalog});}catch{return null;}
}
