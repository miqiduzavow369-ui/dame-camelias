// Finish the presentation of an already verified and settled secondary result.
// This module never opens Intimcity, submits feedback or changes credit balances.
import {requirePublicationIdentity,manStorageKey} from "./man_account_isolation.js";
import {secondaryPublicationOperationalStatus} from "./secondary_man_publication_status.js";
import {readVerifiedFeedbackEvidence} from "./secondary_man_feedback_evidence.js";
import {readSecondaryOriginalJpeg} from "./secondary_man_original_screenshot.js";
import {MODERATION_CHAT} from "./review_moderation.js";
import {secondaryReviewNoticeKey,markSecondaryReviewPublished} from "./secondary_review_moderation_notice.js";
import {MAN_ACCOUNTS} from "./man_accounts.js";
import {dailyLimit,moscowDay} from "./daily_publication_limit.js";

export async function secondaryCompletedProof(storage,env,source){
 const i=requirePublicationIdentity(source);
 const status=await secondaryPublicationOperationalStatus(storage,i,{proofKv:env.VISITORS_KV});
 if(!status.published)throw Error("Completed original proof required");
 const evidence=await readVerifiedFeedbackEvidence(storage,i);
 const original=await readSecondaryOriginalJpeg(env.VISITORS_KV,i,evidence.proofFileId);
 if(!original)throw Error("Original proof unavailable");
 return {identity:i,evidence,original};
}
export async function deliverSecondaryCompletedResult(storage,env,source){
 const {identity:i,evidence,original}=await secondaryCompletedProof(storage,env,source);
 await markSecondaryReviewPublished(storage,env,i);
 const date=moscowDay(new Date(evidence.at));
 const daily=await dailyLimit(env,i.userId,i.profileId,"record_verified",i.kind,i.nonce,date,i.accountId);
 if(daily?.ok!==true)throw Error("Verified daily result not recorded");
 const key=manStorageKey({...i,scope:"proof"})+":"+i.kind+":"+i.nonce+":group-delivery";
 const claimed=await storage.transaction(async tx=>{
  const old=await tx.get(key);
  if(old)return false;
  await tx.put(key,{identity:i,status:"sending",at:Date.now()});return true;
 });
 if(!claimed){const old=await storage.get(key);return {ok:old?.status==="sent",status:old?.status||"unavailable",dailyRemaining:daily.remaining};}
 try{
  if(!env.BOT_TOKEN)throw Error("Telegram unavailable");
  const bytes=Uint8Array.from(atob(original.base64),c=>c.charCodeAt(0));
  const name=MAN_ACCOUNTS.find(x=>x.id===i.accountId)?.name||i.accountId;
  const shownDate=date.split("-").reverse().join(".");
  const caption=i.kind==="rating"?"🌹ПОЗДРАВЛЯЕМ !!!\n✅ Ваши оценки опубликованы!\n👨‍💻 Клиент - "+name+
   "\n🆔 Анкета №"+i.profileId+"\n📅 "+shownDate+"\n📸 Подтверждение публикации прилагается.":
   "🌹ПОЗДРАВЛЯЕМ !!!\n✅ Ваш отзыв отправлен на сайт!\n👨‍💻 Клиент - "+name+"\n🆔 Анкета №"+i.profileId+"\n📅 "+shownDate+"\n📸 Подтверждение публикации прилагается.";
  const body=new FormData();body.append("chat_id",MODERATION_CHAT);body.append("caption",caption);
  if(i.kind==="review"){
   const notice=await storage.get(secondaryReviewNoticeKey(i));
   if(Number.isSafeInteger(notice?.messageId))body.append("reply_parameters",JSON.stringify({message_id:notice.messageId}));
   body.set("caption",caption+"\n⏳ Модерация сайта обычно занимает 1–10 дней.");
  }
  if(i.userId!=="5866034656")body.append("protect_content","true");
  body.append("photo",new Blob([bytes],{type:"image/jpeg"}),"checked-"+i.profileId+".jpg");
  const response=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/sendPhoto",{method:"POST",body,signal:AbortSignal.timeout(15000)});
  const result=await response.json();
  if(!response.ok||!result?.ok||!Number.isSafeInteger(result.result?.message_id))throw Error("Telegram result not confirmed");
  await storage.put(key,{identity:i,status:"sent",at:Date.now(),messageId:result.result.message_id});
  return {ok:true,status:"sent",dailyRemaining:daily.remaining};
 }catch{
  // A timed-out send may already have arrived; never blindly send it twice.
  await storage.put(key,{identity:i,status:"uncertain",at:Date.now()});
  return {ok:false,status:"uncertain",dailyRemaining:daily.remaining};
 }
}
