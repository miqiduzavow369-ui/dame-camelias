import {clientKey,validClientId,validProfileId} from "./client_isolation.js";
const HOST=/^[a-z0-9-]+\.intimcity\.rip$/;
const NONCE=/^[a-f0-9]{12}$/;
export function validateLookupResult(result,expected){
 const uid=String(expected?.userId??""),pid=String(expected?.profileId??"");
 const host=String(expected?.host??""),nonce=String(expected?.nonce??"");
 if(!validClientId(uid)||!validProfileId(pid)||!HOST.test(host)||!NONCE.test(nonce))return null;
 if(String(result?.user_id)!==uid||String(result?.profile_id)!==pid||
    String(result?.nonce)!==nonce||result?.mode!=="profile"||result?.status!=="found")return null;
 const p=result.profile;
 if(!p||String(p.id)!==pid||typeof p.name!=="string"||p.name.trim().length<1||
    p.name.length>100||!Number.isInteger(p.age)||p.age<18||p.age>99||
    typeof p.metro!=="string"||p.metro.length>100||
    p.url!=="https://"+host+"/indi/anketa"+pid+".htm")return null;
 return {id:pid,name:p.name.trim(),age:p.age,metro:p.metro.trim(),url:p.url,host,verifiedAt:Date.now()};
}
export async function acceptClientLookup(env,userId,result){
 if(!env.VISITORS_KV||!validClientId(userId))return false;
 const key=clientKey(userId,"flow");
 const flow=await env.VISITORS_KV.get(key,"json");
 if(flow?.mode!=="profile"||flow?.status!=="pending")return false;
 const profile=validateLookupResult(result,{userId,profileId:flow.profileId,host:flow.host,nonce:flow.nonce});
 if(!profile)return false;
 // Store only in private user namespace; never trust client-supplied verification flags.
 await env.VISITORS_KV.put(clientKey(userId,"saved",profile.id),JSON.stringify(profile));
 const libraryKey=clientKey(userId,"library");
 const ids=await env.VISITORS_KV.get(libraryKey,"json");
 const list=Array.isArray(ids)?ids.filter(validProfileId):[];
 if(!list.includes(profile.id))list.push(profile.id);
 await env.VISITORS_KV.put(libraryKey,JSON.stringify(list));
 await env.VISITORS_KV.put(key,JSON.stringify({...flow,status:"verified",verifiedAt:Date.now()}));
 return true;
}
