// Verified, read-only rating criteria shared by profile ID across men.
// No identity, proxy credentials, chosen ratings, session or publication state.
const PROFILE=/^\d{1,9}$/;
const ACCOUNT=/^(?:yan_second|yan_(?:0[3-9]|[12][0-9]|30))$/;
const HOSTS=new Set(["intimcity.rip","a.intimcity.rip","b.intimcity.rip"]);
const PREFIX="shared-rating-criteria-v1:",LIFETIME=24*60*60;
export function validateSharedCriteria({accountId,profileId,siteHost,catalog}){
 if(!ACCOUNT.test(String(accountId))||!PROFILE.test(String(profileId))||
    !HOSTS.has(siteHost)||!Array.isArray(catalog)||catalog.length<1||catalog.length>120)
  throw Error("Invalid authenticated rating catalog");
 const fields=catalog.map(item=>{
  if(!item||typeof item!=="object"||typeof item.label!=="string"||
    !item.label.trim()||item.label.length>110||!Array.isArray(item.options)||
    item.options.length<1||item.options.length>20||
    item.options.some(v=>typeof v!=="string"||!v.trim()||v.length>100))
   throw Error("Invalid rating criterion");
  return {label:item.label.trim(),group:String(item.group||"").slice(0,90),
   subgroup:String(item.subgroup||"").slice(0,90),
   options:item.options.map(v=>v.trim()),
   ...(item.control&&typeof item.control==="object"?
    {control:{
      type:["select","radio"].includes(item.control.type)?item.control.type:"",
      name:String(item.control.name||"").slice(0,100),
      id:String(item.control.id||"").slice(0,100),
      values:Array.isArray(item.control.values)?
       item.control.values.filter(v=>typeof v==="string").slice(0,20).map(v=>v.slice(0,100)):[]
    }}:{})};
 });
 if(JSON.stringify(fields).length>40000)throw Error("Rating criteria too large");
 return fields;
}
export async function saveSharedCriteria(kv,params){
 const catalog=validateSharedCriteria(params);
 if(typeof kv?.put!=="function")throw Error("Rating cache unavailable");
 const value={profileId:String(params.profileId),siteHost:params.siteHost,
  sourceAccountId:params.accountId,verifiedAt:Date.now(),catalog};
 await kv.put(PREFIX+value.profileId,JSON.stringify(value),{expirationTtl:LIFETIME});
 return {ok:true,profileId:value.profileId,count:catalog.length};
}
export async function readSharedCriteria(kv,profileId){
 if(!PROFILE.test(String(profileId)))return null;
 const entry=await kv?.get(PREFIX+profileId,"json");
 if(!entry||entry.profileId!==String(profileId)||!HOSTS.has(entry.siteHost)||
   !ACCOUNT.test(String(entry.sourceAccountId))||!Number.isSafeInteger(entry.verifiedAt)||
   entry.verifiedAt>Date.now()+60000||Date.now()-entry.verifiedAt>LIFETIME*1000)return null;
 try{return validateSharedCriteria({accountId:entry.sourceAccountId,profileId,
  siteHost:entry.siteHost,catalog:entry.catalog});}catch{return null;}
}
