// Dormant Telegram callback adapter, only to be invoked by a trusted webhook.
// Never call directly from a user HTTP request or from a group callback.
import {parseDiaryThanksCallback} from "./city_diary_delivery.js";
const USER=/^[1-9]\d{4,15}$/;
const VALID_CALLBACK=/^[A-Za-z0-9_-]{1,128}$/;
export async function handleCityDiaryThanks(update,{trustedWebhook=false,schedulerNamespace,internalToken,telegram}={}){
 const query=update?.callback_query;
 const parsed=parseDiaryThanksCallback(query?.data);
 if(!parsed)return {handled:false,reason:"not_diary_callback"};
 if(!trustedWebhook)return {handled:true,ok:false,reason:"untrusted_webhook"};
 const from=String(query?.from?.id||"");
 const chat=query?.message?.chat;
 const chatId=String(chat?.id||"");
 const messageId=query?.message?.message_id;
 const callbackId=query?.id;
 if(!USER.test(from)||from!==chatId||chat?.type!=="private"||
    !Number.isSafeInteger(messageId)||messageId<1||
    typeof callbackId!=="string"||!VALID_CALLBACK.test(callbackId))
   return {handled:true,ok:false,reason:"invalid_callback_context"};
 if(!schedulerNamespace?.idFromName||!schedulerNamespace?.get||
    typeof internalToken!=="string"||internalToken.length<16||
    typeof telegram?.answerCallbackQuery!=="function"||
    typeof telegram?.deleteMessage!=="function")
   return {handled:true,ok:false,reason:"callback_unavailable"};
 const stub=schedulerNamespace.get(schedulerNamespace.idFromName(from));
 let response;
 try{
   response=await stub.fetch("https://city-diary.internal/ack",{
     method:"POST",
     headers:{"Authorization":"Bearer "+internalToken,"Content-Type":"application/json"},
     body:JSON.stringify({type:"acknowledge",userId:from,eventId:parsed.eventId,
       messageId,callbackData:query.data,updateId:update?.update_id})
   });
 }catch{return {handled:true,ok:false,reason:"ack_unknown"};}
 const data=await response.json().catch(()=>null);
 if(!response.ok||!data?.ok||
    data.record?.eventId!==parsed.eventId||
    data.record?.telegramMessageId!==messageId||
    data.record?.state!=="acknowledged")
   return {handled:true,ok:false,reason:"ack_rejected"};
 if(data.record?.cleanupStatus==="deleted")
   return {handled:true,ok:true,acknowledged:true,replay:true,
     answered:false,deleted:true,cleanupRecorded:true,cleanupStatus:"deleted",
     cleanupLimit:false,cleanupRequired:false};
 if((data.record?.cleanupAttempts||0)>=3)
   return {handled:true,ok:true,acknowledged:true,replay:true,
     answered:false,deleted:false,cleanupRecorded:true,
     cleanupStatus:data.record?.cleanupStatus||"unknown",
     cleanupLimit:true,cleanupRequired:true};
 let answered=false,deleted=false;
 try{answered=(await telegram.answerCallbackQuery(callbackId,"Спасибо ✨"))===true;}
 catch{/* Telegram may time out after accepting the answer. */}
 try{deleted=(await telegram.deleteMessage(from,messageId))===true;}
 catch{/* Message remains acknowledged; manual or later cleanup may be required. */}
 let cleanupRecorded=false,cleanupStatus="unknown",cleanupLimit=false;
 try{
   const cleanupResponse=await stub.fetch("https://city-diary.internal/cleanup",{
     method:"POST",
     headers:{"Authorization":"Bearer "+internalToken,"Content-Type":"application/json"},
     body:JSON.stringify({type:"record_cleanup",userId:from,eventId:parsed.eventId,
       messageId,deleted})
   });
   const receipt=await cleanupResponse.json().catch(()=>null);
   if(cleanupResponse.ok&&receipt?.ok&&
      receipt.record?.eventId===parsed.eventId&&
      receipt.record?.telegramMessageId===messageId&&
      receipt.record?.cleanupStatus===(deleted?"deleted":"failed")){
     cleanupRecorded=true;cleanupStatus=receipt.record.cleanupStatus;
   }else if(receipt?.reason==="cleanup_rejected")cleanupLimit=true;
 }catch{/* Reporting may be ambiguous: leave status unconfirmed. */}
 return {handled:true,ok:true,acknowledged:true,replay:data.replay===true,
   answered,deleted,cleanupRecorded,cleanupStatus,cleanupLimit,
   cleanupRequired:!deleted||!cleanupRecorded};
}
