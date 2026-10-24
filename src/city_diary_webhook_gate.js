// Dormant Telegram webhook authentication gate for a separate future diary route.
// This must NOT replace or weaken the legacy bot's existing webhook.
// Caller never supplies trustedWebhook: this function establishes that trust itself.
import {handleCityDiaryThanks} from "./city_diary_callback.js";
const TOKEN=/^[A-Za-z0-9_-]{32,256}$/;
const MAX_BODY=65536;
function tokenMatch(expected,actual){
 if(!TOKEN.test(expected)||typeof actual!=="string"||actual.length>256)return false;
 // Fixed 256-byte comparison avoids early exit on the first changed byte.
 let diff=expected.length^actual.length;
 for(let i=0;i<256;i++)
  diff|=(expected.charCodeAt(i)||0)^(actual.charCodeAt(i)||0);
 return diff===0;
}
export async function handleVerifiedCityDiaryWebhook(request,{webhookSecret,schedulerNamespace,internalToken,telegram}={}){
 if(request?.method!=="POST")return {handled:true,ok:false,reason:"method_not_allowed",status:405};
 if(!tokenMatch(webhookSecret,request.headers?.get("X-Telegram-Bot-Api-Secret-Token")))
  return {handled:true,ok:false,reason:"unauthorized",status:403};
 const contentType=request.headers.get("Content-Type")||"";
 if(!/^application\/json(?:\s*;|\s*$)/i.test(contentType))
  return {handled:true,ok:false,reason:"invalid_content_type",status:415};
 const length=Number(request.headers.get("Content-Length"));
 if(Number.isFinite(length)&&length>MAX_BODY)
  return {handled:true,ok:false,reason:"oversized_update",status:413};
 let raw;
 try{raw=await request.text();}catch{return {handled:true,ok:false,reason:"invalid_body",status:400};}
 if(new TextEncoder().encode(raw).length>MAX_BODY)
  return {handled:true,ok:false,reason:"oversized_update",status:413};
 let update;
 try{update=JSON.parse(raw);}catch{return {handled:true,ok:false,reason:"invalid_json",status:400};}
 if(!update||!Number.isSafeInteger(update.update_id)||update.update_id<0)
  return {handled:true,ok:false,reason:"invalid_update",status:400};
 return handleCityDiaryThanks(update,{
  trustedWebhook:true,schedulerNamespace,internalToken,telegram
 });
}
