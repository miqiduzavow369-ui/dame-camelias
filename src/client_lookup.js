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

export async function dispatchClientLookup(env,userId,profileId,host,nonce){
 if(!validClientId(userId)||!validProfileId(profileId)||!HOST.test(host)||!NONCE.test(nonce))
   return {ok:false,reason:"Invalid lookup identifiers"};
 if(!env.DC_ACTIONS_TOKEN||!env.ANKETA_CALLBACK_TOKEN)
   return {ok:false,reason:"Profile verification is not configured"};
 const response=await fetch("https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/intimcity-profile-lookup.yml/dispatches",{
  method:"POST",headers:{
   Authorization:"Bearer "+env.DC_ACTIONS_TOKEN,Accept:"application/vnd.github+json",
   "User-Agent":"dame-camelias-worker","X-GitHub-Api-Version":"2022-11-28",
   "Content-Type":"application/json"
  },body:JSON.stringify({ref:"main",inputs:{
    user_id:String(userId),profile_id:String(profileId),site_host:host,mode:"profile",nonce
  }}),signal:AbortSignal.timeout(15000)
 });
 return {ok:response.status===204,reason:response.status===204?"":"GitHub HTTP "+response.status};
}
export async function clientLookupCallback(request,env,send){
 if(!env.ANKETA_CALLBACK_TOKEN||request.headers.get("Authorization")!=="Bearer "+env.ANKETA_CALLBACK_TOKEN)
   return new Response("Forbidden",{status:403});
 let data;try{data=await request.json();}catch{return new Response("Invalid JSON",{status:400});}
 const uid=String(data?.user_id??"");
 // A client callback may NEVER be dispatched to owner state.
 if(!validClientId(uid)||uid==="5866034656")return new Response("Invalid client",{status:400});
 const flow=await env.VISITORS_KV?.get(clientKey(uid,"flow"),"json");
 if(!flow||flow.nonce!==data.nonce||flow.profileId!==String(data.profile_id)||flow.status!=="pending")
   return new Response("Stale callback",{status:409});
 if(data.mode!=="profile")return new Response("Invalid mode",{status:400});
 if(data.status!=="found"){
  await env.VISITORS_KV.put(clientKey(uid,"flow"),JSON.stringify({...flow,status:"not_found"}));
  await send(env,"sendMessage",{chat_id:uid,text:"🌷 Не удалось подтвердить анкету №"+flow.profileId+". Попробуйте повторить проверку."});
  return Response.json({ok:true,verified:false});
 }
 const saved=await acceptClientLookup(env,uid,data);
 if(!saved)return new Response("Invalid profile",{status:422});
 const profile=await env.VISITORS_KV.get(clientKey(uid,"saved",flow.profileId),"json");
 await send(env,"sendMessage",{
  chat_id:uid,text:"✅ АНКЕТА ПОДТВЕРЖДЕНА\\n🌹 "+profile.name+" · №"+profile.id+
   "\\nВозраст: "+profile.age+"\\nМетро: "+profile.metro+
   "\\n\\nВернитесь в «Мои анкеты» для дальнейших действий.",
  reply_markup:{inline_keyboard:[[{text:"🌹 Мои анкеты",callback_data:"trial_cabinet:open"}]]}
 });
 return Response.json({ok:true,verified:true});
}
