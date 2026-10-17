import {agreementStatus} from "./agreement.js";
import {moderationRPC} from "./review_moderation.js";
import {sendWithLoadingEmoji} from "./loading_emoji.js";
import {claimPublication,publicationState} from "./publication_claim.js";
// Shared user cabinet with backward-compatible owner keys. Identity comes from a verified
// proxy-backed lookup service; never guess a name, age, or district.
import {reviewGuard} from "./review_publication_guard.js";
import {credits} from "./publication_credits.js";
import {dailyLimit,moscowDay} from "./daily_publication_limit.js";
// Per-request lexical context: no shared mutable current-user variable.
export function createCabinet(userId="5866034656") {
if(!/^\d{5,16}$/.test(String(userId)))throw Error("Invalid cabinet identity");
const OWNER_ID = String(userId);
const isOwner = OWNER_ID === "5866034656";
const privatePrefix = value => isOwner ? value : "cabinet_v3:"+OWNER_ID+":"+value;
const PREFIX = "owner_anketa_state:";
const CABINET_SESSION_KEY = "owner_cabinet_session:"+OWNER_ID;
const CABINET_PENDING_KEY = "owner_cabinet_pending:"+OWNER_ID;
const CABINET_FAIL_KEY = "owner_cabinet_failed:"+OWNER_ID;
// Preserve the existing owner digest; OWNER_CABINET_PIN_SHA256 overrides it.
// New clients are administered through the private Durable Object registry.
const INITIAL_OWNER_PIN_HASH = "0ffe1abd1a08215353c233d6e009613e95eec4253832a761af28ff37ac5a150c";
async function pinDigest(pin){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(pin));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function cabinetAuthorized(env){
  if(!isOwner)return env.__cabinetAuthorized === OWNER_ID;
  if(!env.VISITORS_KV)return false;
  try{return (await env.VISITORS_KV.get(CABINET_SESSION_KEY,"json"))?.authorized===true;}catch{return false;}
}
async function cabinetChallenge(env,send){
  if(!env.VISITORS_KV){await navigationSay(env,send,"⚠️ Вход временно недоступен: хранилище не отвечает.");return;}
  await env.VISITORS_KV.put(CABINET_PENDING_KEY,"1",{expirationTtl:600});
  await navigationSay(env,send,"🔐 ЛИЧНЫЙ КАБИНЕТ\n\nВведите ваш индивидуальный код доступа сообщением в этот чат.\n\n⏳ На ввод отведено 10 минут.",buttons([[{text:"🏠 В начало",callback_data:"owner_anketa:home"}]]));
}

const ID_PATTERN = /^\d{1,9}$/;
const TTL_SECONDS = 1800;
// Owner verified this live publication on 2026-10-13. Historical backfill:
// immutable even if the bot's chat or Cloudflare KV data are cleared.
const VERIFIED_FIRST_PUBLICATION = "652282";
const PROOF_ARCHIVE_KEY=privatePrefix("owner_anketa_proof_archive_v1:");
function proofArchiveKey(account,id){return PROOF_ARCHIVE_KEY+account+":"+id;}
async function savedProof(env,account,id){
  if(account!==ACTIVE_ACCOUNT || !ID_PATTERN.test(String(id)))return null;
  try{
    const x=await env.VISITORS_KV?.get(proofArchiveKey(account,id),"json");
    return x?.account===account && x.profileId===String(id) &&
      typeof x.fileId==="string" && x.fileId.length<300 &&
      /^\d{2}\.\d{2}\.\d{4}$/.test(x.date||"")?x:null;
  }catch{return null;}
}
function proofText(account,id,date){
  const display=account==="yan_first"?"Ян Первый":"Аккаунт";
  return "🌹ПОЗДРАВЛЯЕМ !!!\n✅ Ваши оценки опубликованы!\n👨‍💻 Клиент - "+display+
    "\n🆔 Анкета №"+id+"\n📅 "+date+"\n📸 Подтверждение публикации прилагается.";
}
// Temporary Telegram report messages are separate from the permanent proof archive.
// Navigating away closes the visible report, but retains its reusable file_id.
const PROOF_MESSAGE_KEY="owner_anketa_proof_messages:"+OWNER_ID;
async function rememberProofMessage(env,messageId){
  if(!Number.isSafeInteger(messageId)||!env.VISITORS_KV)return;
  try{
    const previous=await env.VISITORS_KV.get(PROOF_MESSAGE_KEY,"json");
    const list=Array.isArray(previous)?previous.filter(x=>Number.isSafeInteger(x.id)&&Date.now()-x.at<47*3600000):[];
    list.push({id:messageId,at:Date.now()});
    await env.VISITORS_KV.put(PROOF_MESSAGE_KEY,JSON.stringify(list.slice(-30)),{expirationTtl:172800});
  }catch{}
}
async function closeProofMessages(){
  // Receipts remain in the chat; only the navigation messages are replaced.
}

function proofNav(id){return buttons([
  [{text:"🌹 Спасибо",callback_data:"owner_anketa:proofthanks:"+id}],
  [{text:"🌹 К анкете",callback_data:"owner_anketa:saved:"+id}],
  [{text:"📋 К моим анкетам",callback_data:"owner_anketa:open"}],
  [{text:"🏠 В начало",callback_data:"owner_anketa:home"}]
]);}
async function deliverSavedProof(env,send,account,id){
  const archive=await savedProof(env,account,id);
  if(!archive)return false;
  try{
    const delivered=await send(env,"sendPhoto",{chat_id:OWNER_ID,photo:archive.fileId,
      caption:proofText(account,id,archive.date),reply_markup:proofNav(id)});
    await rememberProofMessage(env,delivered?.message_id);
    return true;
  }catch{return false;} // invalidated Telegram file_id: re-check site read-only
}
const REVIEW_PENDING_KEY=privatePrefix("owner_anketa_review_pending_v1:yan_first:");
const REVIEW_ARCHIVE_KEY=privatePrefix("owner_anketa_review_proof_archive_v1:yan_first:");
async function deliverSavedReviewProof(env,send,id){
  const proof=await env.VISITORS_KV?.get(REVIEW_ARCHIVE_KEY+id,"json");
  if(proof?.account!=="yan_first" || proof.profileId!==id ||
     typeof proof.fileId!=="string" || proof.fileId.length>300)return false;
  const res=await send(env,"sendPhoto",{chat_id:OWNER_ID,photo:proof.fileId,
    caption:"✍️ ОТЗЫВ ОПУБЛИКОВАН!\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+id+
      "\n✅ Публикация подтверждена\n📸 Скриншот опубликованного отзыва",
    reply_markup:proofNav(id)});
  await rememberProofMessage(env,res?.message_id);
  return true;
}
const PUBLICATION_KEY = privatePrefix("owner_anketa_publication_v1:");
async function publicationStatus(env,id,kind) {
  if(!ID_PATTERN.test(String(id)) || !["rating","review"].includes(kind))return null;
  if(isOwner && String(id)===VERIFIED_FIRST_PUBLICATION)
    return {status:"published",at:kind==="rating"?"2026-10-13":"2026-10-14",source:"owner-public-verification"};
  const local=await env.VISITORS_KV?.get(PUBLICATION_KEY+kind+":"+id,"json");
  if(local)return local;
  if(!isOwner&&(String(id)===VERIFIED_FIRST_PUBLICATION||await env.VISITORS_KV.get("owner_anketa_publication_v1:"+kind+":"+id,"json")))return {status:"unavailable",shared:true};
  const global=kind==="review"?await reviewGuard(env,id,"review_status"):await publicationState(env,id,kind);
  return global.claimed?{status:"unavailable",shared:true}:null;
}
async function recordPublication(env,id,kind,status,source,receipt={}) {
  if(!env.VISITORS_KV || !ID_PATTERN.test(String(id)) ||
      !["rating","review"].includes(kind) ||
      !["publishing","published","needs_verification"].includes(status))
    return false;
  const key=PUBLICATION_KEY+kind+":"+id;
  const before=await env.VISITORS_KV.get(key,"json");
  if(before?.status==="published" || (before && status==="publishing"))return false;
  await env.VISITORS_KV.put(key,JSON.stringify({
    ...before,...receipt,status,source,at:new Date().toISOString()
  })); // no expiration: independent of chat, profile library, and 30-minute draft TTL
  return true;
}
async function ensureNoRepeat(env,id,kind,send) {
  let found=await publicationStatus(env,id,kind);
  if(!isOwner&&!found){
    found=await env.VISITORS_KV.get("owner_anketa_publication_v1:"+kind+":"+id,"json");
    if(String(id)===VERIFIED_FIRST_PUBLICATION)found={status:"published"};
  }
  if(!found)return false;
  await say(env,send,found.status==="published" ?
    "✅ "+(kind==="rating"?"Оценка опубликована":"Отзыв опубликован")+
    "\n\n🆔 Анкета №"+id+"\n🔒 Повторная публикация запрещена.":
    "🔒 Повторная публикация временно заблокирована\n\n🆔 Анкета №"+id+
    "\nРезультат предыдущей попытки ещё требует подтверждения.");
  return true;
}
const DOMAIN_RESUME_KEY="owner_anketa_domain_resume:"+OWNER_ID+":";
const RECOVERY_MODES={profile:["loading"],ratings:["ratings_loading"],mapping:["audit_loading"],dryfill:["dryfill_loading"],publish:["publishing"],proof:["proof_loading"],review_publish:["review_dispatch"],review_proof:["review_recheck"]};
const recoverable=(mode,step)=>Array.isArray(RECOVERY_MODES[mode])&&RECOVERY_MODES[mode].includes(step);
const HOST_PATTERN = /^[a-z0-9-]+\.intimcity\.rip$/;
function oldProfileLink(input){
 try{const url=new URL(String(input).trim()),match=/^\/indi\/anketa(\d{1,9})\.htm$/.exec(url.pathname);
 return url.protocol==="https:"&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&/^[a-z0-9-]+\.intimcity\.[a-z]{2,10}$/.test(url.hostname)&&match?{id:match[1],host:url.hostname}:null;
 }catch{return null;}
}
function parseProfileLink(input) {
  try {
    const url = new URL(String(input).trim());
    if (url.protocol!=="https:" || url.username || url.password || url.port || url.search || url.hash ||
        !HOST_PATTERN.test(url.hostname)) return null;
    const match = /^\/indi\/anketa(\d{1,9})\.htm$/.exec(url.pathname);
    return match ? {id:match[1],host:url.hostname} : null;
  } catch { return null; }
}

function ownerAllowed(update) {
  const from = update.callback_query?.from ?? update.message?.from;
  const chat = update.callback_query?.message?.chat ?? update.message?.chat;
  return String(from?.id ?? "") === OWNER_ID &&
    String(chat?.id ?? "") === OWNER_ID && chat?.type === "private";
}
async function stateGet(env) {
  return env.VISITORS_KV ? await env.VISITORS_KV.get(env.__operationKey||PREFIX + OWNER_ID, "json") : null;
}
async function statePut(env, state) {
  if (!env.VISITORS_KV) return false;
  if(state.step==="ratings"&&state.profile?.id&&ID_PATTERN.test(String(state.profile.id)))
    await env.VISITORS_KV.put("cabinet_rating_draft:"+OWNER_ID+":"+state.profile.id,JSON.stringify({host:state.host,url:state.profile.url,selected:state.selected||{},catalog:state.catalog,metElsewhere:state.metElsewhere===true}),{expirationTtl:604800});
  if(/^[a-f0-9]{12}$/.test(state.nonce||"")&&(["publishing","review_dispatch","review_recheck","proof_loading"].includes(state.step)||await env.VISITORS_KV.get("cabinet_operation:"+OWNER_ID+":"+state.nonce)))
    await env.VISITORS_KV.put("cabinet_operation:"+OWNER_ID+":"+state.nonce,JSON.stringify(state));
  await env.VISITORS_KV.put(env.__operationKey||PREFIX + OWNER_ID, JSON.stringify(state),
    ["publishing","review_dispatch","review_recheck","proof_loading","publication_result","review_result","domain_recovery","domain_refresh_verify"].includes(state.step)?{}:{ expirationTtl: TTL_SECONDS });
  return true;
}
async function ratingDraftGet(env,id,host,catalog){
 const draft=await env.VISITORS_KV.get("cabinet_rating_draft:"+OWNER_ID+":"+id,"json");
 if(!draft||draft.host!==host||JSON.stringify(draft.catalog)!==JSON.stringify(catalog))return {};
 const selected={};for(const [i,v] of Object.entries(draft.selected||{}))if(catalog[Number(i)]?.options?.includes(v))selected[i]=v;
 return {selected,metElsewhere:draft.metElsewhere===true,draftReady:Object.keys(selected).length>0};
}
const REVIEW_DRAFT_KEY=privatePrefix("owner_anketa_review_draft_v1:yan_first:");
const REVIEW_DRAFT_TTL=7*24*3600;
async function reviewDraftSave(env,state){
  if(!env.VISITORS_KV || !ID_PATTERN.test(String(state?.id)) ||
     state.account!==ACTIVE_ACCOUNT || typeof state.text!=="string" ||
     state.text.length<10 || state.text.length>3000)return;
  try{await env.VISITORS_KV.put(REVIEW_DRAFT_KEY+state.id,
    JSON.stringify({id:String(state.id),account:ACTIVE_ACCOUNT,text:state.text,savedAt:Date.now()}),
    {expirationTtl:REVIEW_DRAFT_TTL});}catch{}
}
async function reviewDraftGet(env,id){
  if(!env.VISITORS_KV || !ID_PATTERN.test(String(id)))return null;
  try{
    const x=await env.VISITORS_KV.get(REVIEW_DRAFT_KEY+id,"json");
    return x?.id===String(id)&&x.account===ACTIVE_ACCOUNT&&
      typeof x.text==="string"&&x.text.length>=10&&x.text.length<=3000?x:null;
  }catch{return null;}
}
const ACCOUNT_SELECTION_KEY = "owner_anketa_selected_account:"+OWNER_ID;
const ACTIVE_ACCOUNT = "yan_first";
async function selectedAccount(env,id){
  const selected=await env.VISITORS_KV?.get(ACCOUNT_SELECTION_KEY,"json");
  return selected?.profileId===String(id) && selected?.account===ACTIVE_ACCOUNT &&
    Number(selected.expiresAt)>Date.now() ? ACTIVE_ACCOUNT : null;
}
async function chooseAccount(env,id){
  if(!env.VISITORS_KV || !ID_PATTERN.test(String(id)))return false;
  await env.VISITORS_KV.put(ACCOUNT_SELECTION_KEY,JSON.stringify({
    profileId:String(id),account:ACTIVE_ACCOUNT,expiresAt:Date.now()+30*60*1000
  }),{expirationTtl:1800});
  return true;
}
function statusBadge(record){
  if(record?.status==="published")return "✅ ЗАВЕРШЕНО";
  if(record)return "🔒 ТРЕБУЕТ ПРОВЕРКИ";
  return "🟡 ДОСТУПНО";
}
function remainingBadge(record){
  // Unknown or in-flight publications must never be represented as available.
  if(record?.status==="published")return "0️⃣";
  if(record)return "⚠️";
  return "1️⃣";
}
async function accountPicker(env,id){
  let rating="⚠️",review="⚠️";
  if(env.VISITORS_KV){
    try{
      const [rated,reviewed]=await Promise.all([
        publicationStatus(env,id,"rating"),publicationStatus(env,id,"review")
      ]);
      rating=remainingBadge(rated);
      review=remainingBadge(reviewed);
    }catch{}
  }
  return buttons([
    [{text:"👨‍💻 Ян Первый · "+rating+"⭐ · "+review+"✍️",callback_data:"owner_anketa:account1:"+id}],
    [{text:"🔒 Ян Второй · ⛔⭐ · ⛔✍️",callback_data:"owner_anketa:account2:"+id}],
    [{text:"⬅️ К анкете",callback_data:"owner_anketa:saved:"+id}],
    [{text:"📋 К моим анкетам",callback_data:"owner_anketa:open"}],
    [{text:"🏠 В начало",callback_data:"owner_anketa:home"}]
  ]);
}
async function showAccountPicker(env,send,id){
  const record=await savedGet(env,id);
  if(!record){await showLibrary(env,send);return;}
  let today;
  try{today=await dailyLimit(env,OWNER_ID,id,"status");}
  catch{today=null;}
  const dailyLine=today?
    "\n\n📅 СЕГОДНЯ ДОСТУПНО "+today.remaining+" "+(today.remaining===1?"ПУБЛИКАЦИЯ":"ПУБЛИКАЦИИ"):
    "\n\n📅 ДНЕВНОЙ ЛИМИТ ВРЕМЕННО НЕДОСТУПЕН";
  const message="🌹 АНКЕТА №"+id+"\n\n👩‍🦰 "+record.profile.name+
    "\n\n👥 Выберите аккаунт для работы с анкетой:";
  const limitText="📅 ДЛЯ ЭТОЙ АНКЕТЫ СЕГОДНЯ ДОСТУПНО "+
    (today?today.remaining:"—")+" "+(today?.remaining===1?"ПУБЛИКАЦИЯ":"ПУБЛИКАЦИИ")+
    "\n\n🕛 Обновление в 00:00 по московскому времени.";
  const keys=await accountPicker(env,id);
  if(today){
    let firstId=null;
    try{
      const card=await env.VISITORS_KV?.get(THUMBNAIL_PREFIX+record.host+"/"+id+".card.jpg","arrayBuffer");
      if(card){
        // Put the daily quota card FIRST, then the profile card.
        // The Moscow reset notice belongs below both images, in the final caption.
        const dailyPhoto=dailyCardUrl(today.remaining);
        if(!dailyPhoto)throw Error("Missing prepared daily PNG");
        const first=await sendPreparedCard(env,dailyPhoto,"",undefined);
        firstId=first?.message_id;
        if(!Number.isSafeInteger(firstId))throw Error("Daily card not delivered");
        const result=await send(env,"sendPhoto",{chat_id:OWNER_ID,
          photo:profileCardUrl(id,record.host),
          caption:message+"\n\n🕛 Обновление в 00:00 по московскому времени.",
          reply_markup:keys});
        if(!Number.isSafeInteger(result?.message_id))
          throw Error("Profile card not delivered");
        const lastId=result.message_id;
        await trackAnketaMessage(env,firstId);
        await trackAnketaMessage(env,lastId);
        let oldNav=null;
        try{oldNav=await env.VISITORS_KV?.get(NAV_MESSAGE_KEY,"json");}catch{}
        await env.VISITORS_KV.put(NAV_MESSAGE_KEY,JSON.stringify({id:lastId,at:Date.now()}),{expirationTtl:172800});
        await clearExtraNavigation(env,send);
        await env.VISITORS_KV.put(EXTRA_NAV_KEY,JSON.stringify({id:firstId,at:Date.now()}),{expirationTtl:172800});
        if(Number.isSafeInteger(oldNav?.id)&&oldNav.id!==lastId)
          try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:oldNav.id});}catch{}
        return;
      }
    }catch(e){
      console.error("Profile daily premium banner fallback",String(e));
      if(Number.isSafeInteger(firstId))
        try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:firstId});}catch{}
    }
  }
  await profileBannerNavigation(env,send,record,id,message+dailyLine+
    "\n🕛 Обновление счётчика в 00:00 по московскому времени.",keys);
}

const LIBRARY_KEY = "owner_anketa_library:"+OWNER_ID;
const PROFILE_KEY = "owner_anketa_saved:"+OWNER_ID+":";
async function libraryGet(env) {
  const ids=await env.VISITORS_KV?.get(LIBRARY_KEY,"json");
  return Array.isArray(ids)?ids.filter(x=>ID_PATTERN.test(String(x))).slice(0,60):[];
}
async function savedGet(env,id) {
  if(!ID_PATTERN.test(String(id)))return null;
  return await env.VISITORS_KV?.get(PROFILE_KEY+id,"json")||null;
}
async function savedPut(env,record) {
  if(!env.VISITORS_KV||!record?.profile||!ID_PATTERN.test(String(record.profile.id)))return false;
  const id=String(record.profile.id);
  const previous=await savedGet(env,id);
  const profile={...record.profile,
    photoUrl:record.profile.photoUrl || previous?.profile?.photoUrl || ""};
  await env.VISITORS_KV.put(PROFILE_KEY+id,JSON.stringify({
    profile,host:record.host,catalog:Array.isArray(record.catalog)?record.catalog:[],
    confirmed:true,updatedAt:Date.now()
  }));
  const ids=await libraryGet(env);
  if(!ids.includes(id))await env.VISITORS_KV.put(LIBRARY_KEY,JSON.stringify([...ids,id]));
  return true;
}
async function savedDelete(env,id) {
  const ids=await libraryGet(env);
  await env.VISITORS_KV.delete(PROFILE_KEY+id);
  await env.VISITORS_KV.put(LIBRARY_KEY,JSON.stringify(ids.filter(x=>x!==id)));
}
// Change only hostnames after the owner supplies a new link and the site
// successfully verifies that exact profile ID. Never rewrite publication state.
function rehostUrl(value,host){
  if(typeof value!=="string")return value;
  try{
    const u=new URL(value);
    if(u.protocol!=="https:"||!HOST_PATTERN.test(u.hostname))return value;
    u.hostname=host;
    return u.toString();
  }catch{return value;}
}
async function switchVerifiedDomain(env,newHost){
  if(!HOST_PATTERN.test(newHost)||!env.VISITORS_KV)throw Error("Invalid verified host");
  const ids=await libraryGet(env);
  for(const id of ids){
    const record=await savedGet(env,id);
    if(!record)continue;
    const profile={...record.profile};
    if(typeof profile.url==="string")profile.url=rehostUrl(profile.url,newHost);
    // Images are CDN assets, not site navigation links: leave them unchanged.
    await env.VISITORS_KV.put(PROFILE_KEY+id,JSON.stringify({
      ...record,profile,host:newHost,updatedAt:Date.now()
    }));
    const pending=await env.VISITORS_KV.get(REVIEW_PENDING_KEY+id,"json");
    if(pending)await env.VISITORS_KV.put(REVIEW_PENDING_KEY+id,JSON.stringify({...pending,host:newHost}));
  }
  const state=await stateGet(env);
  if(state && typeof state==="object"){
    const profile=state.profile?{...state.profile,url:rehostUrl(state.profile.url,newHost)}:state.profile;
    await statePut(env,{...state,host:newHost,profile});
  }
  return ids.length;
}
const libraryKeyboard=(ids,signed=false)=>buttons([
  ...ids.map(id=>[{text:"🌹 АНКЕТА №"+id,callback_data:"owner_anketa:saved:"+id}]),
  [{text:"➕ Ввести новую анкету",callback_data:"owner_anketa:new"}],
  ...(signed?[[{text:"📜 Подписанное соглашение",callback_data:"agreement:signed"}]]:[]),
  [{text:"🏠 В начало",callback_data:"owner_anketa:home"}]
]);
// v1 publication records belong exclusively to yan_first. Never copy their
// statuses to yan_second; its history will use account-scoped keys at rollout.
async function availabilitySummary(env,id,account){
  if(account!=="yan_first")return "🔒 Аккаунт не подключён.";
  if(!env.VISITORS_KV)return "⚠️ Не удалось проверить историю публикаций.";
  try{
    const [rating,review]=await Promise.all([
      publicationStatus(env,id,"rating"),publicationStatus(env,id,"review")
    ]);
    const available=[];
    const completed=[];
    const uncertain=[];
    for(const [status,noun,description] of [
      [rating,"⭐ 1 оценка","⭐ Оценку вы уже опубликовали ранее."],
      [review,"✍️ 1 отзыв","✍️ Отзыв вы уже опубликовали ранее."]
    ]){
      if(!status)available.push("<b>"+noun+"</b>");
      else if(status.status==="published")completed.push(description);
      else uncertain.push((noun.startsWith("⭐")?"⭐ Оценка":"✍️ Отзыв")+" — ⚠️ Требуется проверка.");
    }
    if(available.length===0 && uncertain.length===0)
      return "<b>✅ Все доступные публикации завершены!</b>\n\n"+completed.join("\n");
    const parts=[];
    if(available.length)parts.push("Для данной анкеты доступны:\n\n"+available.join("\n"));
    if(completed.length)parts.push(completed.join("\n"));
    if(uncertain.length)parts.push(uncertain.join("\n")+"\n🔒 Повторная публикация до проверки недоступна.");
    return parts.join("\n\n");
  }catch{
    return "⚠️ Не удалось проверить историю публикаций. Повторную публикацию не начинайте.";
  }
}

async function profileKeyboard(env,id){
  const rating=await publicationStatus(env,id,"rating");
  const review=await publicationStatus(env,id,"review");
  return buttons([
  ...(!rating?[[{text:"⭐ Опубликовать оценку",callback_data:"owner_anketa:savedrating:"+id}]]:[]),
  ...(!review?[[{text:"✍️ Опубликовать отзыв",callback_data:"owner_anketa:savedreview:"+id}]]:[]),
  ...(rating&&!rating.shared?[[{text:"📸 Подтверждение оценки",callback_data:"owner_anketa:proof:"+id}]]:[]),
  ...(review?.status==="published"?[[{text:"📸 Подтверждение отзыва",callback_data:"owner_anketa:reviewproof:"+id}]]:[]),
  ...(review && !review.shared && review.status!=="published"?[[{text:"🔎 Проверить отзыв",callback_data:"owner_anketa:reviewcheck:"+id}]]:[]),
  [{text:"⬅️ К клиентам",callback_data:"owner_anketa:accounts:"+id}],
  [{text:"🗑 Удалить анкету",callback_data:"owner_anketa:deleteask:"+id}],
  [{text:"🏠 В начало",callback_data:"owner_anketa:home"}]
]);}
const ACCOUNT_CARD_FILES={yan_first:"yan_first.jpg"};
async function accountCardNavigation(env,send,account,id,text,reply_markup){
  const file=ACCOUNT_CARD_FILES[account];
  if(!file)return navigationSay(env,send,text,reply_markup,"HTML");
  const url="https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/assets/account_cards/"+file;
  // Check before asking Telegram to fetch the photo, so missing assets
  // do not interrupt the account menu during a staged deployment.
  try{
    const image=await fetch(url,{method:"HEAD",signal:AbortSignal.timeout(5000)});
    if(!image.ok || !String(image.headers.get("content-type")||"").startsWith("image/"))
      return navigationSay(env,send,text,reply_markup,"HTML");
    const rows=reply_markup?.inline_keyboard||[];
    const markup=buttons([...rows,...(rows.some(r=>r.some(x=>x.callback_data==="owner_anketa:home"))?[]:[[{text:"🏠 В начало",callback_data:"owner_anketa:home"}]])]);
    const result=await send(env,"sendPhoto",{chat_id:OWNER_ID,photo:url,caption:text,parse_mode:"HTML",reply_markup:markup});
    await trackAnketaMessage(env,result?.message_id);
    let old=null;
    try{old=await env.VISITORS_KV?.get(NAV_MESSAGE_KEY,"json");}catch{}
    if(Number.isSafeInteger(result?.message_id))
      try{await env.VISITORS_KV?.put(NAV_MESSAGE_KEY,JSON.stringify({id:result.message_id,at:Date.now()}),{expirationTtl:172800});}catch{}
    if(Number.isSafeInteger(old?.id) && old.id!==result?.message_id)
      try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:old.id});}catch{}
    return result;
  }catch{
    return navigationSay(env,send,text,reply_markup,"HTML");
  }
}
const PREMIUM_CARDS="https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/assets/balance_cards/";
async function sendPreparedCard(env,url,caption,reply_markup){
  // Download the public static PNG from GitHub in the Worker and upload it
  // directly to Telegram. Telegram's servers never need to fetch GitHub URLs.
  const image=await fetch(url,{signal:AbortSignal.timeout(10000)});
  if(!image.ok)throw Error("Premium PNG HTTP "+image.status);
  const bytes=await image.arrayBuffer();
  if(bytes.byteLength<100 || bytes.byteLength>500000)
    throw Error("Premium PNG invalid size");
  const data=new Uint8Array(bytes);
  if(data[0]!==137||data[1]!==80||data[2]!==78||data[3]!==71)
    throw Error("Premium PNG invalid signature");
  const form=new FormData();
  form.set("chat_id",OWNER_ID);
  if(!isOwner)form.set("protect_content","true");
  form.set("caption",caption);
  if(reply_markup)form.set("reply_markup",JSON.stringify(reply_markup));
  form.set("photo",new Blob([bytes],{type:"image/png"}),"premium.png");
  const result=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/sendPhoto",{
    method:"POST",body:form,signal:AbortSignal.timeout(15000)
  });
  const parsed=await result.json();
  if(!result.ok || parsed.ok!==true || !Number.isSafeInteger(parsed.result?.message_id))
    throw Error("Telegram premium photo: "+String(parsed.description||result.status).slice(0,180));
  return parsed.result;
}
function balanceCardUrl(count){
  return Number.isInteger(count)&&count>=0&&count<=20 ? PREMIUM_CARDS+"balance_"+String(count).padStart(2,"0")+".png" : null;
}
function dailyCardUrl(count){
  return Number.isInteger(count)&&count>=0&&count<=2 ? PREMIUM_CARDS+"daily_"+count+".png" : null;
}
async function showLibrary(env,send,knownBalance){
  await clearExtraNavigation(env,send);
  const ids=await libraryGet(env);
  let balance;
  try{balance=knownBalance||await credits(env,OWNER_ID,"status");}
  catch{
    await navigationSay(env,send,"⚠️ Сейчас не удалось проверить баланс публикаций. Пожалуйста, попробуйте позже.",
      buttons([[{text:"🔄 Обновить кабинет",callback_data:"owner_anketa:open"}]]));
    return;
  }
  // A reservation prevents concurrent overspending; it is not a completed debit.
  // Display the unspent balance and explain any temporarily reserved credits.
  const remaining=balance.remaining??(balance.available+balance.reserved);
  const pending=balance.reserved>0?"\n\n⏳ В резерве: "+balance.reserved+"\n💕 Списание — только после подтверждения оценки или отзыва скриншотом.":"";
  const heading="🌹 DAME CAMELIAS\n\n🔐 ЛИЧНЫЙ КАБИНЕТ\n🆔 Telegram ID: "+OWNER_ID+
    "\n\n💎 ВАМ ДОСТУПНО: "+remaining+" ПУБЛИКАЦИЙ";
  const info=pending+(remaining>0?
    "\n\n💕 Выберите сохранённую анкету\n✨ Или добавьте новую по актуальной ссылке.":
    (!isOwner&&balance.reserved===0?"\n\n🌹 МОИ АНКЕТЫ":"")+
    "\n\n💎 ВАШ ЛИМИТ ИСЧЕРПАН\n\n🌷 Обратитесь к администратору, чтобы пополнить баланс.\n💕 Ваши анкеты и подтверждения сохранены.");
  const signed=(await agreementStatus(env,OWNER_ID)).status==="accepted";
  let keys=remaining>0?libraryKeyboard(ids,signed):buttons([
    ...ids.map(id=>[{text:"🌹 АНКЕТА №"+id,callback_data:(!isOwner&&balance.reserved===0?"owner_anketa:balance_empty:":"owner_anketa:saved:")+id}]),
    ...(signed?[[{text:"📜 Подписанное соглашение",callback_data:"agreement:signed"}]]:[]),
    [{text:"💬 Связаться с менеджером",url:"https://t.me/DameCamelias"}],
    [{text:"🏠 В начало",callback_data:"owner_anketa:home"}]
  ]);
  const url=balanceCardUrl(remaining);
  let bannerError="not_in_library";
  if(url){
    try{
      const response=await sendPreparedCard(env,url,"🆔 Telegram ID: "+OWNER_ID+info,keys);
      if(!Number.isSafeInteger(response?.message_id))throw Error("Telegram premium card not sent");
      await trackAnketaMessage(env,response.message_id);
      let previous=null;
      try{previous=await env.VISITORS_KV?.get(NAV_MESSAGE_KEY,"json");}catch{}
      try{await env.VISITORS_KV?.put(NAV_MESSAGE_KEY,JSON.stringify({id:response.message_id,at:Date.now()}),{expirationTtl:172800});}catch{}
      if(Number.isSafeInteger(previous?.id)&&previous.id!==response.message_id)
        try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:previous.id});}catch{}
      return;
    }catch(e){
      bannerError=String(e?.message||e).slice(0,160);
      console.error("Prepared premium card unavailable",bannerError);
    }
  }
  // A clean text fallback keeps the cabinet usable when image upload fails.
  await navigationSay(env,send,heading+info,keys);
}
async function showExhaustedCabinet(env,send,id,balance){
  if(!id||!(await libraryGet(env)).includes(id))return showLibrary(env,send,balance);
  await navigationSay(env,send,
    "🌹 DAME CAMELIAS\n\n💎 ЛИМИТ ПУБЛИКАЦИЙ ИСЧЕРПАН\n\nДоступно публикаций: 0\n\n"+
    "💕 Ваши анкеты, история и подтверждения сохранены.\n\n"+
    "🌷 Чтобы продолжить работу, обратитесь к администратору для пополнения баланса.",
    buttons([[{text:"💬 Связаться с менеджером",url:"https://t.me/DameCamelias"}],
      [{text:"🌹 К моим анкетам",callback_data:"owner_anketa:open"}]]));
}
async function releaseUnsubmitted(env,id,kind,nonce,date){
  await credits(env,OWNER_ID,"release",kind,id,nonce);
  await dailyLimit(env,OWNER_ID,id,"release",kind,nonce,date);
}
async function reserveDailySlot(env,send,id,kind,nonce){
  const date=moscowDay();
  try{
    const claimed=await dailyLimit(env,OWNER_ID,id,"reserve",kind,nonce,date);
    if(claimed.ok)return date;
    await say(env,send,"📅 Сегодня для анкеты №"+id+" доступно 0 публикаций.\n\n🕛 Обновление в 00:00 по московскому времени.");
  }catch{await say(env,send,"⚠️ Не удалось проверить дневной лимит. Публикация не начата.");}
  return null;
}
async function requireCredit(env,send){
  try{
    const balance=await credits(env,OWNER_ID,"status");
    if(balance.available>0)return true;
    await say(env,send,"💎 Доступных публикаций: 0.\n\n🌹 Обратитесь к администратору за новым заказом.",
      buttons([[{text:"💬 Связаться с менеджером",url:"https://t.me/DameCamelias"}],
        [{text:"🔐 Личный кабинет",callback_data:"owner_anketa:open"}]]));
    return false;
  }catch{
    await say(env,send,"⚠️ Не удалось проверить баланс. Публикация не начата.");
    return false;
  }
}
async function profileBannerNavigation(env,send,record,id,text,markup,parseMode){
  await clearExtraNavigation(env,send);
  const photo=profileCardUrl(id,record.host);
  const hasCard=!!(await env.VISITORS_KV?.get(THUMBNAIL_PREFIX+record.host+"/"+id+".card.jpg","arrayBuffer").catch(()=>null));
  // Navigation photo is profile-specific and replaces only the prior navigation message.
  if(hasCard){
    try{
      const response=await send(env,"sendPhoto",{
        chat_id:OWNER_ID,photo,caption:text,reply_markup:markup,...(parseMode?{parse_mode:parseMode}:{})
      });
      if(Number.isSafeInteger(response?.message_id)){
        await trackAnketaMessage(env,response.message_id);
        let previous=null;
        try{previous=await env.VISITORS_KV?.get(NAV_MESSAGE_KEY,"json");}catch{}
        try{await env.VISITORS_KV?.put(NAV_MESSAGE_KEY,JSON.stringify({id:response.message_id,at:Date.now()}),{expirationTtl:172800});}catch{}
        if(Number.isSafeInteger(previous?.id) && previous.id!==response.message_id &&
           Date.now()-Number(previous.at)<47*3600000)
          try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:previous.id});}catch{}
        return;
      }
    }catch(e){console.error("Saved profile thumbnail unavailable",String(e));}
  }
  return navigationSay(env,send,text,markup,parseMode);
}
async function showSaved(env,send,id) {
  const record=await savedGet(env,id);
  if(!record){await showLibrary(env,send);return;}
  const text="🌹 АНКЕТА №"+id+"\n\n👩‍🦰 "+record.profile.name+
    "\n\n💎 Цифры рядом с оценкой ⭐ и отзывом ✍️ показывают, сколько публикаций ещё доступно на каждом аккаунте.\n\n1️⃣ — доступно для публикации\n\n0️⃣ — уже опубликовано ранее";
  const recovering=await env.VISITORS_KV.get(DOMAIN_RESUME_KEY+id,"json");
  const markup=buttons([
      ...(recovering?[[{text:"🔗 Обновить ссылку",callback_data:"owner_anketa:domain_resume:"+id}]]:[]),
      [{text:"👥 Выбрать аккаунт",callback_data:"owner_anketa:accounts:"+id}],
      [{text:"🔐 В личный кабинет",callback_data:"owner_anketa:open"}],
      [{text:"🏠 В начало",callback_data:"owner_anketa:home"}]
    ]);
  return profileBannerNavigation(env,send,record,id,text,markup);
}
const CHAT_IDS_KEY="owner_anketa_chat_ids:"+OWNER_ID;
const CLIENT_FLOW_KEY="owner_anketa_client_flow:"+OWNER_ID;
const NAV_MESSAGE_KEY="owner_anketa_navigation:"+OWNER_ID;
const EXTRA_NAV_KEY="owner_anketa_navigation_extra:"+OWNER_ID;
async function clearExtraNavigation(env,send){
  let old=null;
  try{old=await env.VISITORS_KV?.get(EXTRA_NAV_KEY,"json");}catch{}
  if(Number.isSafeInteger(old?.id))
    try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:old.id});}catch{}
  try{await env.VISITORS_KV?.delete(EXTRA_NAV_KEY);}catch{}
}

// Navigation has one active message; audit, publication and result messages
// are sent through say() and are never removed by navigation cleanup.
async function navigationSay(env,send,text,reply_markup,parse_mode){
  await clearExtraNavigation(env,send);
  const rows=Array.isArray(reply_markup?.inline_keyboard)?reply_markup.inline_keyboard:[];
  const hasHome=rows.some(row=>row.some(button=>button.callback_data==="owner_anketa:home"));
  const markup=buttons(hasHome?rows:[...rows,[{text:"🏠 В начало",callback_data:"owner_anketa:home"}]]);
  let previous=null;
  try{previous=await env.VISITORS_KV?.get(NAV_MESSAGE_KEY,"json");}catch{}
  if(Number.isSafeInteger(previous?.id)){
    try{const edited=await sendWithLoadingEmoji(env,send,"editMessageText",{chat_id:OWNER_ID,message_id:previous.id,text,reply_markup:markup,...(parse_mode?{parse_mode}:{})});
      if(edited)return edited;
    }catch(e){if(String(e).includes("message is not modified"))return {message_id:previous.id};}
  }
  const response=await say(env,send,text,markup,parse_mode);
  const id=response?.message_id;
  if(!Number.isSafeInteger(id)||!env.VISITORS_KV)return response;
  try{await env.VISITORS_KV.put(NAV_MESSAGE_KEY,JSON.stringify({id,at:Date.now()}),{expirationTtl:172800});}catch{}
  if(Number.isSafeInteger(previous?.id)&&previous.id!==id&&Date.now()-Number(previous.at)<47*3600000){
    try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:previous.id});}catch{}
  }
  return response;
}
async function trackAnketaMessage(env,id){
  if(!env.VISITORS_KV || !Number.isSafeInteger(id) || id<=0)return;
  try{
    const list=(await env.VISITORS_KV.get(CHAT_IDS_KEY,"json"))||[];
    const recent=Array.isArray(list)?list.filter(x=>Number.isSafeInteger(x.id) && Date.now()-x.at<47*3600000 && x.id!==id):[];
    recent.push({id,at:Date.now()});
    await env.VISITORS_KV.put(CHAT_IDS_KEY,JSON.stringify(recent.slice(-150)),{expirationTtl:172800});
  }catch(e){console.error("Owner anketa message tracking unavailable",e);}
}
async function startClientFlow(env,id){
  if(!env.VISITORS_KV)return;
  try{await env.VISITORS_KV.put(CLIENT_FLOW_KEY,JSON.stringify({id:String(id),since:Date.now()}),{expirationTtl:172800});}catch{}
}
async function closeClientFlow(env,send,id,proofMessageId){
  let scope=null;
  try{scope=await env.VISITORS_KV?.get(CLIENT_FLOW_KEY,"json");}catch{}
  // Never delete historical chat messages if the flow marker is unavailable.
  // Never delete a range of tracked bot messages: it can contain audit reports,
  // verification results or messages belonging to another navigation branch.
  // Navigation messages are replaced independently by navigationSay().
  if(scope?.id===String(id)){
    try{await env.VISITORS_KV?.delete(CLIENT_FLOW_KEY);}catch{}
  }
  await clearProgress(env,send);
}
async function cleanAnketaChat(env,send){
  if(!env.VISITORS_KV)return;
  let list=[];
  try{list=await env.VISITORS_KV.get(CHAT_IDS_KEY,"json")||[];}catch{return;}
  if(!Array.isArray(list))return;
  // Telegram normally allows deleting private chat messages only within 48 hours.
  // Never delete messages from other bot sections or from other chats.
  const ids=[...new Set(list.filter(x=>Number.isSafeInteger(x.id)&&Date.now()-x.at<47*3600000).map(x=>x.id))];
  const failed=[];
  for(const id of ids){
    try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:id});}
    catch{failed.push({id,at:Date.now()});}
  }
  try{await env.VISITORS_KV.delete(CHAT_IDS_KEY);}catch{}
}
function buttons(rows) { return {inline_keyboard:rows}; }
const NEW_NUMBER = [{text:"🔄 Ввести другую анкету",callback_data:"owner_anketa:change"}];
// Keep meaningful bot replies and found-profile cards in Telegram history.
// Only the transient progress message is updated; owner-entered IDs are cleaned up.
async function say(env, send, text, reply_markup, parse_mode) {
  const response=await sendWithLoadingEmoji(env,send,"sendMessage",{chat_id:OWNER_ID,text,...(reply_markup?{reply_markup}:{}),...(parse_mode?{parse_mode}:{})});
  await trackAnketaMessage(env,response?.message_id);
  return response;
}
const PROGRESS_KEY="owner_anketa_progress:"+OWNER_ID;
async function progressSay(env,send,text){
  let old=null;
  try{old=await env.VISITORS_KV?.get(PROGRESS_KEY,"json");}catch{}
  if(Number.isSafeInteger(old?.id)){
    try{
      await sendWithLoadingEmoji(env,send,"editMessageText",{chat_id:OWNER_ID,message_id:old.id,text});
      return;
    }catch(e){
      if(String(e).includes("message is not modified"))return;
    }
  }
  const res=await say(env,send,text);
  if(Number.isSafeInteger(res?.message_id))
    try{await env.VISITORS_KV?.put(PROGRESS_KEY,JSON.stringify({id:res.message_id}),{expirationTtl:172800});}catch{}
}
async function clearProgress(env,send){
  let old=null;
  try{old=await env.VISITORS_KV?.get(PROGRESS_KEY,"json");}catch{}
  if(Number.isSafeInteger(old?.id))
    try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:old.id});}catch{}
  try{await env.VISITORS_KV?.delete(PROGRESS_KEY);}catch{}
}
// One-screen editable draft. No Telegram action here publishes ratings.
function ratingMenu(state) {
  const selected=state.selected||{};
  const rows=[];
  state.catalog.forEach((field,i)=>{
    const chosen=selected[i];
    const display=chosen===undefined?"":" · "+chosen;
    rows.push([{text:(chosen===undefined?"◯ ":"🔘 ")+field.label.slice(0,32)+display.slice(0,15),
      callback_data:"owner_anketa:toggle:"+i+":"+state.nonce}]);
    if(chosen===undefined) return;
    const alternatives=field.options.filter(v=>v && v.toLowerCase()!=="не знаю" && !/^[1-4]$/.test(v));
    if(alternatives.length<2) return;
    rows.push(alternatives.slice(0,4).map(v=>({
      text:(chosen===v?"🔘 ":"◯ ")+v.slice(0,18),
      callback_data:"owner_anketa:option:"+i+":"+field.options.indexOf(v)+":"+state.nonce
    })));
  });
  rows.push([{text:"📋 Посмотреть выбор",callback_data:"owner_anketa:preview:"+state.nonce}]);
  rows.push([{text:"🧹 Сбросить отметки",callback_data:"owner_anketa:reset:"+state.nonce}]);
  rows.push([{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+state.profile.id}]);
  rows.push(NEW_NUMBER);
  return buttons(rows);
}
function ratingSummary(state) {
  const count=Object.keys(state.selected||{}).length;
  return "🌹 ОЦЕНКИ АНКЕТЫ\n\n👤 "+state.profile.name+
    "\n⭐ Отмечено: "+count+" из "+state.catalog.length+
    "\n\n💕 Нажмите ◯, чтобы отметить категорию. Повторное нажатие снимет отметку."+
    "\n✨ Для вариантов с текстом можно выбрать значение отдельно.\n\n🌷 Пока это только черновик.";
}
function ratingSubgroup(field) {
  const label=String(field.label||"").toLowerCase().trim();
  const group=String(field.group||"").toLowerCase().trim();
  // Use explicit site headings first. These two labels only fill in the
  // site's nested captions when its HTML does not expose a heading.
  if (/массаж/.test(group)) return "Массаж";
  if (/бдсм|bdsm/.test(group)) return "БДСМ";
  if (/^(классический|расслабляющий)$/.test(label)) return "Массаж";
  if (label==="игры") return "БДСМ";
  return "";
}
// Build contiguous site-style service complexes without sorting any fields.
// The category changes only when a source heading or distinctive first item appears.
function organizeCatalog(catalog) {
  // Section transitions follow the approved owner report sample.
  // Never sort the criteria: retain their original website order.
  let section="Основной перечень";
  const stages=["Основной перечень","Секс","Массаж","БДСМ","Другое"];
  const stageIndex=name=>stages.indexOf(name);
  return catalog.map(field=>{
    const label=String(field.label||"").trim();
    const low=label.toLowerCase();
    const siteGroup=String(field.group||"").toLowerCase();
    const sourceSubgroup=String(field.subgroup||"").toLowerCase();
    let next=null;
    if(low==="классический секс")next="Секс";
    else if(/^(классический|расслабляющий)$/.test(low) ||
      /массаж/.test(siteGroup))next="Массаж";
    else if(/^(?:игры|бондаж|доминирование|подчинение|порка|флагелляция|страпон|фетиш|садо-мазо|садомазо)$/.test(low)||/(?:бдсм|bdsm)/.test(siteGroup)||/(?:бдсм|bdsm)/.test(sourceSubgroup))next="БДСМ";
    else if(/^(?:окончание в рот|окончание на грудь|золотой дождь|фетиш)$/.test(low) ||
      /^(?:другое|другие услуги|дополнительные услуги)$/.test(siteGroup))next="Другое";
    // Explicit field boundaries win over previously cached heuristic subgroups.
    // Unambiguous source section captions are a fallback for other profiles.
    else if(/^(?:массаж|бдсм|другое)$/.test(sourceSubgroup))
      next=sourceSubgroup==="секс"?"Секс":sourceSubgroup==="массаж"?"Массаж":
        sourceSubgroup==="бдсм"?"БДСМ":"Другое";
    if(next && stageIndex(next)>stageIndex(section))section=next;
    return {...field,label:/^isFair$/i.test(label)?"Фото соответствует":label,
      group:"Оценки анкеты",subgroup:section};
  });
}

function validProfile(data, id, host) {
  if (!data || String(data.id) !== id || typeof data.name !== "string" ||
      !data.name.trim() || data.name.length > 100 ||
      !Number.isInteger(data.age) || data.age < 18 || data.age > 99 ||
      typeof data.metro !== "string" || data.metro.length > 100 ||
      data.url !== `https://${host}/indi/anketa${id}.htm`) return null;
  let photoUrl="";
  if(typeof data.photoUrl==="string" && data.photoUrl.length<1600){
    try{
      const u=new URL(data.photoUrl);
      if(u.protocol==="https:" && !u.username && !u.password && !u.port && !u.hash &&
          (u.href===thumbnailUrl(id,host) ||
            (["cdn2.intimtur.com",host].includes(u.hostname) && !u.search &&
              /\.(?:jpg|jpeg|png|webp)$/i.test(u.pathname))))photoUrl=u.href;
    }catch{}
  }
  return {id,name:data.name.trim(),age:data.age,metro:data.metro.trim(),url:data.url,photoUrl};
}
async function dispatchLookup(env,id,nonce,mode="profile",siteHost="a.intimcity.rip") {
  if (!env.DC_ACTIONS_TOKEN) return {ok:false,reason:"Отсутствует DC_ACTIONS_TOKEN в Cloudflare"};
  if (!env.ANKETA_CALLBACK_TOKEN) return {ok:false,reason:"Отсутствует ANKETA_CALLBACK_TOKEN в Cloudflare"};
  const response=await fetch(
    "https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/intimcity-profile-lookup.yml/dispatches",
    {method:"POST",headers:{
      "Authorization":"Bearer "+env.DC_ACTIONS_TOKEN,
      "Accept":"application/vnd.github+json",
      "User-Agent":"dame-camelias-worker",
      "X-GitHub-Api-Version":"2022-11-28",
      "Content-Type":"application/json"},
    body:JSON.stringify({ref:env.CABINET_ACTIONS_REF||"main",inputs:{profile_id:id,nonce,mode,site_host:siteHost,user_id:OWNER_ID}}),
    signal:AbortSignal.timeout(15000)});
  if(response.status===204) return {ok:true};
  const descriptions={401:"GitHub отклонил токен (401)",403:"GitHub запретил запуск: проверь Actions Write и срок токена (403)",404:"GitHub не нашёл workflow или у токена нет доступа к репозиторию (404)",422:"GitHub не принял параметры запуска (422)",429:"GitHub ограничил число запросов (429)"};
  return {ok:false,definitiveFailure:[401,403,404,422].includes(response.status),reason:descriptions[response.status]||("GitHub HTTP "+response.status)};
}
async function ownerDryfillPayload(request,env) {
  if (!env.ANKETA_CALLBACK_TOKEN ||
      request.headers.get("Authorization")!=="Bearer "+env.ANKETA_CALLBACK_TOKEN)
    return new Response("Forbidden",{status:403});
  const url=new URL(request.url);
  const id=url.searchParams.get("profile_id")||"";
  const nonce=url.searchParams.get("nonce")||"";
  if(!ID_PATTERN.test(id)||!/^[a-f0-9]{12}$/.test(nonce))
    return new Response("Invalid request",{status:400});
  const state=await stateGet(env);
  const publication=state?.step==="publishing" && state?.nonce===nonce &&
    state?.dispatchPending===true;
  if(!state || (!publication && state.step!=="dryfill_loading") || String(state.id)!==id ||
      state.nonce!==nonce || !state.profile || String(state.profile.id)!==id ||
      Date.now()-Number(state.agreedAt||0)>20*60*1000)
    return new Response("Stale",{status:409});
  if(publication){
    // Consume the grant before the external submission attempt. Never auto-retry.
    await statePut(env,{...state,dispatchPending:false,submissionStartedAt:Date.now()});
  }
  const selections=Object.keys(state.selected||{}).map(Number).sort((a,b)=>a-b).map(i=>({
    index:i,label:state.catalog?.[i]?.label,value:state.selected[i]
  }));
  if(selections.length===0 || selections.length>120 ||
      selections.some(x=>!Number.isInteger(x.index)||!x.label||typeof x.value!=="string"))
    return new Response("Invalid state",{status:409});
  return Response.json({selections,metElsewhere:state.metElsewhere===true},
    {headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
async function ownerReviewStage(request,env) {
  if(!env.ANKETA_CALLBACK_TOKEN ||
     request.headers.get("Authorization")!=="Bearer "+env.ANKETA_CALLBACK_TOKEN)
    return new Response("Forbidden",{status:403});
  let data;
  try{data=await request.json();}catch{return new Response("Bad JSON",{status:400});}
  const id=String(data.profile_id||""),nonce=String(data.nonce||"");
  if(!ID_PATTERN.test(id)||!/^[a-f0-9]{12}$/.test(nonce)||
     !["review_submit_boundary","review_preflight_failed"].includes(data.type))
    return new Response("Invalid stage",{status:400});
  const state=await stateGet(env);
  if(state?.step!=="review_dispatch" || state.id!==id || state.nonce!==nonce ||
     state.account!=="yan_first" || !/^[a-f0-9]{16}$/.test(state.claimNonce||"") ||
     state.payloadIssued!==true)return new Response("Stale",{status:409});
  let result;
  try{result=await reviewGuard(env,id,data.type,state.claimNonce);}catch{return new Response("Stage rejected",{status:409});}
  return Response.json(result,{status:result.ok?200:409});
}
async function ownerReviewPayload(request,env) {
  if(!env.ANKETA_CALLBACK_TOKEN ||
      request.headers.get("Authorization")!=="Bearer "+env.ANKETA_CALLBACK_TOKEN)
    return new Response("Forbidden",{status:403});
  const url=new URL(request.url),id=url.searchParams.get("profile_id")||"";
  const nonce=url.searchParams.get("nonce")||"",mode=url.searchParams.get("mode")||"";
  if(!ID_PATTERN.test(id)||!/^[a-f0-9]{12}$/.test(nonce)||
      !["review_publish","review_proof"].includes(mode))
    return new Response("Invalid request",{status:400});
  const current=await stateGet(env);
  if(!current || current.id!==id || current.nonce!==nonce ||
      current.account!=="yan_first" || !["review_dispatch","review_recheck"].includes(current.step) ||
      !await savedGet(env,id) ||
      typeof current.text!=="string" || current.text.length<10 || current.text.length>3000 ||
      !(current.agreedAt>0) || Date.now()-current.agreedAt>30*60*1000)
    return new Response("Stale",{status:409});
  if(mode==="review_publish"){
    if(current.step!=="review_dispatch"||current.payloadIssued===true)
      return new Response("Already issued",{status:409});
    const guard=await reviewGuard(env,id,"review_status");
    if(!guard.claimed||guard.status!=="submission_maybe_sent")
      return new Response("Submission not authorized",{status:409});
    // Consume BEFORE returning the payload: Actions retries can never submit twice.
    await statePut(env,{...current,payloadIssued:true});
  }
  return Response.json({text:current.text},
    {headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
const THUMBNAIL_PREFIX="profile-thumbnails/";
function thumbnailUrl(id,host){
  return "https://dame-camelias.gptjjjgpt.workers.dev/api/anketa/photo/"+id+"?site="+encodeURIComponent(host);
}
async function serveProfileThumbnail(request,env){
  const url=new URL(request.url);
  const match=/^\/api\/anketa\/(photo|card)\/(\d{1,9})$/.exec(url.pathname);
  const host=url.searchParams.get("site")||"";
  if(!match || !HOST_PATTERN.test(host) || !env.VISITORS_KV)
    return new Response("Not found",{status:404});
  const bytes=await env.VISITORS_KV.get(THUMBNAIL_PREFIX+host+"/"+match[2]+(match[1]==="card"?".card.jpg":".jpg"),"arrayBuffer");
  if(!bytes)return new Response("Not found",{status:404});
  return new Response(bytes,{headers:{
    "Content-Type":"image/jpeg",
    "Cache-Control":"public, max-age=3600",
    "X-Content-Type-Options":"nosniff"
  }});
}
async function saveProfileCard(env,profile,id,host){
  if(!env.VISITORS_KV || !profile || String(profile.id)!==id ||
     typeof profile.cardData!=="string" || profile.cardData.length>145000 ||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(profile.cardData))return false;
  try{
    const bytes=Uint8Array.from(atob(profile.cardData),x=>x.charCodeAt(0));
    if(bytes.length<3000 || bytes.length>105000 || bytes[0]!==255 || bytes[1]!==216 ||
       bytes[bytes.length-2]!==255 || bytes[bytes.length-1]!==217)return false;
    await env.VISITORS_KV.put(THUMBNAIL_PREFIX+host+"/"+id+".card.jpg",bytes);
    return true;
  }catch(e){console.error("Profile banner KV save failed",String(e));return false;}
}
function profileCardUrl(id,host){
  return "https://dame-camelias.gptjjjgpt.workers.dev/api/anketa/card/"+id+"?site="+encodeURIComponent(host);
}
async function saveProfileThumbnail(env,profile,id,host){
  if(!env.VISITORS_KV || !profile || String(profile.id)!==id ||
     typeof profile.photoData!=="string" || profile.photoData.length>140000 ||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(profile.photoData))return "";
  try{
    const bytes=Uint8Array.from(atob(profile.photoData),x=>x.charCodeAt(0));
    if(bytes.length<500 || bytes.length>100000 || bytes[0]!==0xff || bytes[1]!==0xd8 ||
       bytes[bytes.length-2]!==0xff || bytes[bytes.length-1]!==0xd9)return "";
    await env.VISITORS_KV.put(THUMBNAIL_PREFIX+host+"/"+id+".jpg",bytes);
    return thumbnailUrl(id,host);
  }catch(e){
    console.error("Profile thumbnail KV save failed",String(e));
    return "";
  }
}

async function handleAnketaLookupResult(request,env,send) {
  if (!env.ANKETA_CALLBACK_TOKEN ||
      request.headers.get("Authorization")!=="Bearer "+env.ANKETA_CALLBACK_TOKEN)
    return new Response("Forbidden",{status:403,headers:{"X-DC-Callback-Handler":"reached"}});
  let data;
  try {data=await request.json();}catch{return new Response("Invalid JSON",{status:400});}
  if(data.user_id&&String(data.user_id)!==OWNER_ID)return new Response("User mismatch",{status:403});
  const id=String(data.profile_id??""),nonce=String(data.nonce??"");
  if(!ID_PATTERN.test(id)||!/^[a-f0-9]{12}$/.test(nonce))
    return new Response("Invalid request",{status:400});
  const current=await stateGet(env);
  if(current?.step==="domain_refresh_verify"&&current.id===id&&current.nonce===nonce&&data.mode==="domain_probe"){
    const verified=data.status==="found"?validProfile(data.profile,id,current.host):null;
    if(!verified){await statePut(env,{step:"domain_recovery",id,recoveryKey:current.recoveryKey});await showDomainRecovery(env,send,id);return Response.json({ok:true,domainUpdated:false});}
    if(!await resumeVerifiedDomain(env,send,current))return new Response("Recovery context unavailable",{status:409});
    return Response.json({ok:true,domainUpdated:true});
  }
  if(data.status==="error"&&current?.step==="loading"&&current.source==="mini_app"&&current.id===id&&current.nonce===nonce&&data.mode==="profile"){
    await statePut(env,{step:"mini_lookup_failed",id,host:current.host,reason:"unavailable"});
    return Response.json({ok:true,found:false});
  }
  if(data.status==="error"&&current?.id===id&&current.nonce===nonce&&recoverable(data.mode,current.step)){
    await requestDomainRecovery(env,send,current,data.mode);return Response.json({ok:true,domainRecoveryRequested:true});
  }
  // Only trusted, authenticated lookup callbacks may upload profile photos.
  // Bind the bytes to this exact profile and active lookup nonce.
  if(data.status==="found" && ["profile","ratings"].includes(data.mode) &&
     current?.id===id && current?.nonce===nonce && HOST_PATTERN.test(current.host||"") &&
     ((current.step==="loading"&&data.mode==="profile")||(current.step==="ratings_loading"&&data.mode==="ratings")) && validProfile(data.profile,id,current.host)){
    const stored=await saveProfileThumbnail(env,data.profile,id,current.host);
    if(stored)data.profile.photoUrl=stored;
    await saveProfileCard(env,data.profile,id,current.host);
  }
  if(data.profile && "photoData" in data.profile)delete data.profile.photoData;
  if(data.profile && "cardData" in data.profile)delete data.profile.cardData;
  // A working example profile may have a DIFFERENT ID from the review.
  // Verify its destination, then resume proof for the original review ID.
  // No saved domain is changed until Telegram confirms photo delivery.
  if(current?.step==="domain_verify" && current.verifyId===id &&
     current.nonce===nonce && data.mode==="domain_probe"){
    const verified=validProfile(data.profile,id,current.host);
    if(data.status!=="found"||!verified){
      await statePut(env,{step:"domain_recovery",id:current.targetId,mode:current.mode});
      await navigationSay(env,send,"🌷 Ссылка пока не подтвердилась. Пришлите рабочую ссылку на любую действующую анкету Intimcity.\n\n🔒 Данные и домены не изменены.");
      return Response.json({ok:true,domainUpdated:false});
    }
    const originalId=String(current.targetId);
    if(current.mode!=="review_proof" || !ID_PATTERN.test(originalId))
      return new Response("Invalid recovery context",{status:409});
    const pending=await env.VISITORS_KV?.get(REVIEW_PENDING_KEY+originalId,"json");
    const guard=await reviewGuard(env,originalId,"review_status");
    if(pending?.account!==ACTIVE_ACCOUNT || String(pending.id)!==originalId ||
       typeof pending.text!=="string"||pending.text.length<10 ||
       !/^[a-f0-9]{16}$/.test(pending.claimNonce||"")||!guard.claimed){
      await statePut(env,{step:"domain_recovery",id:originalId,mode:"review_proof"});
      await navigationSay(env,send,"🌷 Новый адрес доступен, но данные для безопасной проверки исходного отзыва не найдены. Ничего не публиковалось и домен не изменён.");
      return Response.json({ok:true,domainUpdated:false,proofDispatched:false});
    }
    const proofNonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    await statePut(env,{step:"review_recheck",id:originalId,account:ACTIVE_ACCOUNT,
      nonce:proofNonce,text:pending.text,claimNonce:pending.claimNonce,moderationTicket:pending.moderationTicket,creditNonce:pending.creditNonce||pending.claimNonce,dailyDate:pending.dailyDate||(pending.savedAt?moscowDay(new Date(pending.savedAt)):undefined),
      agreedAt:Date.now(),host:current.host,recoveryHost:current.host,
      verifiedViaId:id});
    let dispatched=false;
    try{dispatched=(await dispatchLookup(env,originalId,proofNonce,"review_proof",current.host)).ok;}catch{}
    if(!dispatched){
      await statePut(env,{step:"domain_recovery",id:originalId,mode:"review_proof"});
      await navigationSay(env,send,"🌷 Ссылка работает, но не удалось запустить проверку отзыва. Сохранённые домены пока не изменены.");
      return Response.json({ok:true,domainUpdated:false,proofDispatched:false});
    }
    await progressSay(env,send,"⏳ Актуальная ссылка проверена.\n\n✍️ Ищу уже опубликованный отзыв к анкете №"+originalId+
      " в разделе «Ваши отзывы».\n📸 После получения скриншота обновлю домен сохранённых анкет аккаунта ЯН ПЕРВЫЙ.\n🔒 Повторной публикации не будет.");
    return Response.json({ok:true,domainUpdated:false,proofDispatched:true});
  }
  if(["review_publish","review_proof"].includes(data.mode)){
    if(!current || current.id!==id || current.nonce!==nonce ||
       !["review_dispatch","review_recheck"].includes(current.step) ||
       current.account!=="yan_first")return new Response("Stale",{status:409});
    const publication=data.review_publication||{};
    const proof=publication.proof;
    if(data.status==="found" && publication.confirmed===true &&
       proof?.account==="yan_first" && proof.profile_id===id &&
       proof.text_verified===true && proof.mime==="image/jpeg" &&
       typeof proof.image==="string" && proof.image.length<950000 &&
       /^[A-Za-z0-9+/]+={0,2}$/.test(proof.image)){
      const bytes=Uint8Array.from(atob(proof.image),x=>x.charCodeAt(0));
      if(bytes.length<1000||bytes.length>700000||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)
        return new Response("Invalid proof",{status:400});
      const payload=new FormData();
      payload.append("chat_id",OWNER_ID);
    if(!isOwner)payload.append("protect_content","true");
      payload.append("caption","✍️ ОТЗЫВ ОПУБЛИКОВАН!\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+id+
        "\n✅ Публикация подтверждена\n📸 Скриншот опубликованного отзыва");
      payload.append("reply_markup",JSON.stringify(proofNav(id)));
      payload.append("photo",new Blob([bytes],{type:"image/jpeg"}),"review-"+id+".jpg");
      const delivered=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/sendPhoto",
        {method:"POST",body:payload});
      if(!delivered.ok)throw new Error("Review proof Telegram delivery failed");
      const telegramData=await delivered.json();
      if(!telegramData.ok)throw new Error("Review proof Telegram API rejected");
      await rememberProofMessage(env,telegramData.result?.message_id);
      const fileId=telegramData.result?.photo?.at(-1)?.file_id;
      if(typeof fileId==="string"&&fileId.length<300)
        await env.VISITORS_KV.put(REVIEW_ARCHIVE_KEY+id,
          JSON.stringify({account:"yan_first",profileId:id,fileId,savedAt:new Date().toISOString()}));
      // Only Telegram's accepted screenshot authorizes changing saved hosts.
      if(current.recoveryHost){
        try{
          const updated=await switchVerifiedDomain(env,current.recoveryHost);
          console.log("Review proof delivered; saved profile domains updated",updated);
        }catch(e){
          console.error("Review proof delivered, but domain migration failed",String(e));
          await say(env,send,"⚠️ Скриншот доставлен, но обновить домены сохранённых анкет пока не удалось.");
        }
      }
      await reviewGuard(env,id,"review_verified",current.claimNonce);
      await recordPublication(env,id,"review","published","verified-comments-screenshot");
      if(current.creditNonce){
        try{await credits(env,OWNER_ID,"complete","review",id,current.creditNonce);}
        catch(e){console.error("Review credit completion pending",String(e));}
        if(current.dailyDate){
          try{await dailyLimit(env,OWNER_ID,id,"complete","review",current.creditNonce,current.dailyDate);}
          catch(e){console.error("Daily quota completion pending",String(e));}
        }
      }
      try{await env.VISITORS_KV.delete(REVIEW_PENDING_KEY+id);}catch{}
      await statePut(env,{...current,host:current.recoveryHost||current.host,step:"review_result",text:null,completedAt:Date.now()});
      await clearProgress(env,send);
      if(current.moderationTicket){
       try{await moderationRPC(env,OWNER_ID,current.moderationTicket,{action:"published",proofDelivered:true,profileId:id,proofFileId:fileId});}
       catch{if(env.__enqueueModerationNotice)await env.__enqueueModerationNotice(current.moderationTicket,id);}
      }
      return Response.json({ok:true,reviewPublished:true});
    }
    // No positive proof is NOT success, including timeout after a POST.
    await recordPublication(env,id,"review","needs_verification","review-submit-unverified");
    await statePut(env,{...current,step:"review_result",text:current.text,
      attempted:publication.attempted===true});
    if(data.mode==="review_proof" && data.status==="error"){
      await statePut(env,{step:"domain_recovery",id,mode:"review_proof"});
      await navigationSay(env,send,"🌷 Извините, возможно, сайт перешёл на другой домен или временно недоступен.\n\n🔗 Пришлите актуальную рабочую ссылку на любую анкету этого сайта (не обязательно №"+id+").\n\n💕 Я проверю её и обновлю адреса сохранённых анкет. Оценки и отзывы останутся на месте.\n🔒 Повторной публикации не будет.",buttons([[{text:"🌹 Мои анкеты",callback_data:"owner_anketa:open"}]]));
      return Response.json({ok:true,domainRecoveryRequested:true});
    }
    await progressSay(env,send,"🌷 Публикацию отзыва пока не удалось подтвердить.\n\n🌹 Анкета №"+id+
      "\n🔒 Повторная отправка заблокирована. Мы можем проверить результат без повторной публикации.");
    return Response.json({ok:true,reviewPublished:false});
  }
  const proofLoading=current?.step==="proof_loading" && data.mode==="proof";
  if(proofLoading){
    if(current.id!==id || current.nonce!==nonce || current.account!=="yan_first")
      return new Response("Stale",{status:409});
    const proof=data.proof;
    if(data.status!=="found" || !proof || proof.account!=="yan_first" || proof.profile_id!==id || proof.mime!=="image/jpeg" ||
       !/^\d{2}\.\d{2}\.\d{4}$/.test(proof.date||"") ||
       typeof proof.image!=="string" || proof.image.length>950000 ||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(proof.image))
    {
      await statePut(env,{...current,step:"publication_result"});
      await progressSay(env,send,"🌷 Пока не удалось получить подтверждение для анкеты №"+id+".\n\n💕 Ваши оценки остаются под защитой от повторного размещения. Чуть позже вы сможете запросить подтверждение снова.");
      return Response.json({ok:true,proof:false});
    }
    if(id===VERIFIED_FIRST_PUBLICATION && proof.date!=="13.10.2026")
      return new Response("Proof date mismatch",{status:409});
    const binary=atob(proof.image);
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    if(bytes.length<1000 || bytes.length>700000 || bytes[0]!==255 || bytes[1]!==216 || bytes.at(-2)!==255 || bytes.at(-1)!==217)
      return new Response("Invalid photo",{status:400});
    const payload=new FormData();
    payload.append("chat_id",OWNER_ID);
    if(!isOwner)payload.append("protect_content","true");
    payload.append("caption",proofText(current.account,id,proof.date));
    payload.append("reply_markup",JSON.stringify(proofNav(id)));
    payload.append("photo",new Blob([bytes],{type:"image/jpeg"}),"checked-"+id+".jpg");
    const telegramResponse=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/sendPhoto",
      {method:"POST",body:payload});
    if(!telegramResponse.ok)throw new Error("Proof telegram photo rejected: "+telegramResponse.status);
    const telegramData=await telegramResponse.json();
    if(!telegramData.ok)throw new Error("Proof telegram API rejected");
    // Telegram stores the photo; keep its reusable file_id in persistent KV.
    // This is per account + profile and survives deleting the saved anketa.
    await rememberProofMessage(env,telegramData.result?.message_id);
    const telegramPhoto=telegramData.result?.photo;
    const fileId=Array.isArray(telegramPhoto)?telegramPhoto.at(-1)?.file_id:null;
    if(typeof fileId==="string" && fileId.length<300 && env.VISITORS_KV){
      try{await env.VISITORS_KV.put(proofArchiveKey(current.account,id),JSON.stringify({
        account:current.account,profileId:id,fileId,date:proof.date,
        savedAt:new Date().toISOString()
      }));}catch{console.error("Proof archive write failed");}
    }
    await clearProgress(env,send);
    await recordPublication(env,id,"rating","published","verified-checked-list-screenshot");
    if(current.creditNonce){
      try{await credits(env,OWNER_ID,"complete","rating",id,current.creditNonce);}
      catch(e){console.error("Rating credit completion pending",String(e));}
      if(current.dailyDate){
        try{await dailyLimit(env,OWNER_ID,id,"complete","rating",current.creditNonce,current.dailyDate);}
        catch(e){console.error("Daily quota completion pending",String(e));}
      }
    }
    await statePut(env,{...current,step:"publication_result",proofDeliveredAt:Date.now()});
    return Response.json({ok:true,proof:true});
  }
  const publishLoading=current?.step==="publishing" && data.mode==="publish";
  if(publishLoading){
    const attempt=data.publication||{};
    const wasStarted=current.submissionStartedAt>0;
    if(current.id!==id || current.nonce!==nonce || !wasStarted)
      return new Response("Stale",{status:409});
    // A visible success alert alone is not proof of a matching public entry.
    // The screenshot verifier (#57) will set "published" only after matching
    // the exact profile and delivering the screenshot to Telegram.
    await recordPublication(env,id,"rating","needs_verification",
      attempt.confirmed===true?"site-ack-awaiting-screenshot":
      attempt.attempted===true?"submission-unconfirmed":"submission-not-proven");
    const next={...current,step:"publication_result",publicationReport:{
      attempted:attempt.attempted===true,
      confirmed:attempt.confirmed===true,
      confirmedBy:typeof attempt.confirmedBy==="string"?attempt.confirmedBy.slice(0,70):"",
      at:Date.now()},readyAt:null,dispatchPending:false};
    if(attempt.attempted===true){
      // Verification only: no second submit. Use the existing authenticated
      // account/proxy through the read-only "proof" workflow mode.
      const proofNonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
      const verifyState={...next,step:"proof_loading",nonce:proofNonce,
        account:ACTIVE_ACCOUNT,previousNonce:nonce};
      await statePut(env,verifyState);
      let proofStarted=false;
      try {proofStarted=(await dispatchLookup(env,id,proofNonce,"proof",current.host)).ok;}catch{}
      if(proofStarted){
        await progressSay(env,send,"⏳ Ещё немного терпения!\n\n💕 Мы завершаем оформление ваших оценок.\n📸 Как только всё будет готово, пришлём красивое подтверждение с фотографией.");
        return Response.json({ok:true,proofStarted:true});
      }
      await statePut(env,next);
    }
    const title=attempt.confirmed===true?"🔎 ОЖИДАЕМ ПОДТВЕРЖДЕНИЕ ПУБЛИКАЦИИ":
       attempt.attempted===true||!data.publication?"⚠️ РЕЗУЛЬТАТ ПУБЛИКАЦИИ НЕ ПОДТВЕРЖДЁН":
       "❌ ПУБЛИКАЦИЯ НЕ ВЫПОЛНЕНА";
    await say(env,send,title+"\n\n🆔 Анкета №"+id+
      "\n🌷 Повторной отправки не будет."+
      ((attempt.attempted===true||!data.publication)&&attempt.confirmed!==true?
       "\nПожалуйста, проверьте результат на Intimcity вручную.":""));
    return Response.json({ok:true});
  }
  const dryfillLoading = current?.step === "dryfill_loading" && data.mode === "dryfill";
  const auditLoading = current?.step === "audit_loading" && data.mode === "mapping";
  const ratingsLoading = current?.step === "ratings_loading" && data.mode === "ratings";
  if(!current || (!ratingsLoading && !auditLoading && !dryfillLoading && current.step!=="loading") || current.id!==id || current.nonce!==nonce)
    return new Response("Stale",{status:409});
  if(dryfillLoading){
    const restored={...current,step:"ratings_agreed",nonce:current.previousNonce};
    delete restored.previousNonce;
    delete restored.id;
    await statePut(env,restored);
    const report=data.dryfill;
    const ratedTotal=Object.keys(current.selected||{}).length;
    const total=ratedTotal+(current.metElsewhere===true?1:0);
    const extraOk=current.metElsewhere!==true || (report?.extraFlag?.ok===true && report.extraFlag.count===1);
    const finalAuditOk=report?.finalAudit?.ok===true &&
      Object.values(report.finalAudit.checks||{}).length===6 &&
      Object.values(report.finalAudit.checks).every(v=>v===true);
    const ok=data.status==="found" && data.profile && String(data.profile.id)===id &&
      report && report.applied===ratedTotal && report.verified===ratedTotal && extraOk &&
      Array.isArray(report.results) && report.results.length===ratedTotal &&
      report.results.every(x=>x.ok===true);
    const misses=Array.isArray(report?.results)?
      report.results.filter(x=>!x.ok).map(x=>"• "+String(x.label||"Пункт").slice(0,90)): [];
    if(!extraOk)misses.push("• Встречался по другой анкете — не найдено однозначное поле сайта");
    if(!finalAuditOk)misses.push("• Финальная проверка отправляемых полей формы не пройдена");
    if(current.prepublish){
      if(ok && finalAuditOk){
        const finalState={...restored,step:"prepublish_ready",prepublish:true,readyAt:Date.now()};
        await statePut(env,finalState);
        // The preparation progress is transient; remove it before showing the final choice.
        await clearProgress(env,send);
        await say(env,send,"✅ ВСЁ ГОТОВО К ПУБЛИКАЦИИ\n\n👤 "+current.profile.name+
          "\n\n🆔 Анкета №"+id+
          "\n\n✅ Зашли через устройство клиента. "+
          "\n\n✅ Выдержаны условия безопастности.  "+
          "\n\n✅ Анкета найдена в списке индивидуалок. "+
          "\n\n✅ Все услуги совпали: "+total+" из "+total+
          "\n\n💎 Вы точно хотите опубликовать выбранные оценки?",
          buttons([[{text:"✅ Да, опубликовать",callback_data:"owner_anketa:publish_confirm:"+current.previousNonce}],
            [{text:"❌ Отмена",callback_data:"owner_anketa:publish_cancel:"+current.previousNonce}]]));
      }else{
        await say(env,send,"⚠️ ПОДГОТОВКА НЕ ПРОШЛА\n\n🆔 Анкета №"+id+
          "\n✅ Проверено в браузере: "+((Number(report?.verified)||0)+(report?.extraFlag?.ok===true?1:0))+" из "+total+
          (misses.length?"\n\nПроверьте:\n"+misses.slice(0,20).join("\n"):"")+
          "\n\n🌷 Публикация не предлагалась. На сайт ничего не отправлялось.");
      }
      return Response.json({ok:true,prepublish:!!ok});
    }
    await say(env,send,(ok?"✅ ТЕСТ ЗАПОЛНЕНИЯ ПРОЙДЕН":"⚠️ ТЕСТ ЗАПОЛНЕНИЯ НЕ ПРОЙДЕН")+
      "\n\n🆔 Анкета №"+id+
      "\n📋 Выбрано пунктов: "+total+
      "\n✅ Проверено в браузере: "+((Number(report?.verified)||0)+(report?.extraFlag?.ok===true?1:0))+
      (misses.length?"\n\nНе совпали:\n"+misses.slice(0,30).join("\n"):"")+
      (current.metElsewhere===true?"\n\n☑️ Галочка «Встречался по другой анкете»: "+(extraOk?"проверена":"не сопоставлена"):"")+
      "\n\n🌷 Значения проверены только во временном браузере. Форма на Intimcity не отправлялась.",
      buttons([[{text:"⭐ Открыть оценки",callback_data:"owner_anketa:savedrating:"+id}],
        [{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+id}]]));
    return Response.json({ok:true,dryfill:ok});
  }
  if(auditLoading) {
    const selected=current.selected||{};
    const restored={step:"ratings_agreed",account:current.account,profile:current.profile,host:current.host,
      nonce:current.previousNonce,catalog:current.catalog,selected,
      metElsewhere:current.metElsewhere===true,draftReady:true,agreedAt:current.agreedAt};
    await statePut(env,restored);
    const raw=Array.isArray(data.catalog)?data.catalog:[];
    if(data.status!=="found" || !data.profile || String(data.profile.id)!==id || !raw.length){
      await say(env,send,"⚠️ Проверка полей анкеты №"+id+" не удалась. На сайте ничего не изменено.");
      return Response.json({ok:true,audit:false});
    }
    const normalized=t=>String(t||"").trim().toLowerCase().replace(/\s+/g," ");
    const source=organizeCatalog(raw);
    const wanted=Object.keys(selected).map(Number).sort((a,b)=>a-b);
    let matched=0;
    const misses=[];
    for(const i of wanted){
      const local=current.catalog[i],remote=source[i],value=selected[i];
      const choices=remote?.options||[];
      const index=choices.findIndex(x=>normalized(x)===normalized(value));
      const control=remote?.control;
      const unique=control && ["radio","select"].includes(control.type) &&
        (control.name||control.id) &&
        source.filter(x=>x.control?.type===control.type &&
          (x.control.name||x.control.id)===(control.name||control.id)).length===1;
      if(local && remote && normalized(local.label)===normalized(remote.label) &&
          index>=0 && unique && typeof control.values?.[index]==="string"){
        matched++;
      } else misses.push("• "+(local?.label||("Пункт "+(i+1)))+" — нет однозначного соответствия");
    }
    // The extra flag has no proven site control mapping yet.
    if(current.metElsewhere===true)misses.push("• Встречался по другой анкете — элемент сайта не сопоставлен");
    const extras=current.metElsewhere===true?1:0;
    const total=wanted.length+extras;
    await say(env,send,"🔎 ПРОВЕРКА ПОЛЕЙ САЙТА\n\n🆔 Анкета №"+id+
      "\n✅ Совпали: "+matched+" из "+total+
      "\n⚠️ Требуют проверки: "+(total-matched)+
      (misses.length?"\n\n"+misses.slice(0,25).join("\n"):"")+
      "\n\n🌷 Режим только чтения. Ни одно поле на сайте не изменено и ничего не опубликовано.",
      buttons([[{text:"⭐ Открыть оценки",callback_data:"owner_anketa:savedrating:"+id}],
        [{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+id}]]));
    return Response.json({ok:true,audit:true,matched,total});
  }
  if(ratingsLoading) {
    // The lookup can bring a new verified thumbnail. Preserve the original
    // identity if lookup has no photo, but never silently discard a new one.
    const refreshed=validProfile(data.profile,id,current.host);
    const profile = refreshed ? {...current.profile,...refreshed,
      photoUrl:refreshed.photoUrl || current.profile?.photoUrl || ""} : current.profile;
    const raw = Array.isArray(data.catalog) ? data.catalog : [];
    const catalog = raw.slice(0,120).filter(x => x && typeof x.label === "string" && Array.isArray(x.options))
      .map(x => ({label:x.label.slice(0,90),group:typeof x.group==="string" ? x.group.slice(0,90) : "Оценки анкеты",subgroup:ratingSubgroup(x),options:x.options.filter(v=>typeof v==="string").slice(0,20).map(v=>v.slice(0,50))}));
    if(data.status!=="found" || !catalog.length || !data.profile || String(data.profile.id)!==id) {
      await statePut(env,{step:"chosen",profile,nonce:current.previousNonce,host:current.host});
      await say(env,send,"🌷 Сейчас не удалось загрузить категории оценок для анкеты №"+id+
        ".\n\n💕 Пожалуйста, попробуйте немного позже.",buttons([NEW_NUMBER]));
      return Response.json({ok:true,found:false});
    }
    const orderedCatalog=organizeCatalog(catalog);
    if(current.account!==ACTIVE_ACCOUNT || !await selectedAccount(env,id)){
      await say(env,send,"🌷 Выбор аккаунта устарел. Откройте анкету и выберите 👨‍💻 Ян Первый.");return Response.json({ok:false},{status:409});
    }
    const next={step:"ratings",account:current.account,profile,host:current.host,nonce:current.previousNonce,catalog:orderedCatalog,selected:{},...await ratingDraftGet(env,id,current.host,orderedCatalog)};
    await savedPut(env,{profile,host:current.host,catalog:orderedCatalog});
    await statePut(env,next);
    await navigationSay(env,send,"🌹 ВСЁ ГОТОВО!\n\n💕 Я подготовила для вас индивидуальную форму оценок анкеты "+profile.name+
      ".\n\n✨ Откройте её, отметьте нужные пункты и нажмите «Готово». Все выбранные значения вернутся сюда на проверку.",
      buttons([[{text:"💎 Заполнить оценки",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/anketa/ratings?key="+next.nonce}}],NEW_NUMBER]));
    return Response.json({ok:true,found:true});
  }
  // Mini App callbacks use the same validation and persistent state as Telegram,
  // but must never send lookup results into the Telegram chat.
  if(current?.step==="loading"&&current.source==="mini_app"&&current.id===id&&current.nonce===nonce&&data.mode==="profile"){
    const found=data.status==="found"?validProfile(data.profile,id,current.host):null;
    if(!found){
      await statePut(env,{step:"mini_lookup_failed",id,host:current.host,reason:data.status==="not_found"?"not_found":"unavailable"});
      return Response.json({ok:true,found:false});
    }
    const decision=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    await statePut(env,{step:"confirm",source:"mini_app",profile:found,host:current.host,nonce:decision});
    return Response.json({ok:true,found:true});
  }
  const found=data.status==="found"?validProfile(data.profile,id,current.host):null;
  if(!found) {
    await statePut(env,{step:"number"});
    const empty = data.status === "not_found";
    await say(env,send,empty
      ? "🔎 АНКЕТА НЕ НАЙДЕНА\n\n📋 По номеру №"+id+" нет результатов поиска.\n\n🔓 Пожалуйста, включите анкету, если она отключена, или проверьте правильность введённого ID.\n\n🔄 Можете попробовать ещё раз."
      : "🌷 НЕБОЛЬШАЯ ЗАМИНКА\n\n💕 Сейчас не получилось завершить проверку анкеты №"+id+
      ". Это может быть временная техническая ошибка, а не проблема с вашим номером.\n\n✨ Пожалуйста, попробуйте ещё раз чуть позже.",
      buttons([NEW_NUMBER]));
    return Response.json({ok:true,found:false});
  }
  const decision=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  await statePut(env,{step:"confirm",profile:found,host:current.host,nonce:decision});
  const location=found.metro?"\n📍 м. "+found.metro:"";
  await navigationSay(env,send,"🌹 АНКЕТА НАЙДЕНА\n\n👤 "+found.name+
    "\n🎂 Возраст: "+found.age+" лет"+location+"\n🆔 Номер анкеты: №"+id+"\n🔗 "+
    found.url+"\n\n✅ Это нужная анкета?",
    buttons([[{text:"✅ Подтвердить анкету",callback_data:"owner_anketa:confirm:"+decision}],
      NEW_NUMBER]));
  return Response.json({ok:true,found:true});
}
async function askNumber(env,send) {
  if (!await statePut(env,{step:"number"})) {
    await say(env,send,"⚠️ Хранилище состояния не настроено. Ввод анкеты сейчас недоступен.");
    return;
  }
  await navigationSay(env,send,"🌹 ДОБРО ПОЖАЛОВАТЬ В DAME CAMELIAS!\n\n💕 Давайте найдём вашу анкету.\n\n🔗 Пришлите, пожалуйста, полную ссылку на анкету с актуальным доменом Intimcity одним сообщением.\n\n✨ Я бережно проверю данные и предложу дальнейшие шаги.");
}
async function showDomainRecovery(env,send,id,late=false){
 const text="🌹 DAME CAMELIAS\n\n🌐 ОБНОВИМ ССЫЛКУ НА АНКЕТУ\n\n🌹 Анкета №"+id+
  "\n\n🌷 Возможно, прежний домен устарел или сайт временно недоступен.\n\n💕 Откройте свою анкету через действующий сайт и пришлите её полную ссылку одним сообщением. Номер анкеты должен остаться прежним."+
  "\n\n🔒 Сохраним ваш шаг, выбранные оценки, текст отзыва, баланс, историю и подтверждения. Уже отправленные действия повторно публиковаться не будут.";
 const rows=[[{text:"🔗 Обновить ссылку",callback_data:"owner_anketa:domain_resume:"+id}]];
 rows.push([{text:"🌹 К моим анкетам",callback_data:"owner_anketa:open"}],[{text:"🏠 В начало",callback_data:"owner_anketa:home"}]);
 if(late)await say(env,send,text,buttons(rows));else await navigationSay(env,send,text,buttons(rows));
}
async function requestDomainRecovery(env,send,resume,mode){
 const id=String(resume.id||resume.profile?.id||"");if(!ID_PATTERN.test(id))return false;
 const key=DOMAIN_RESUME_KEY+id;
 await env.VISITORS_KV.put(key,JSON.stringify({id,mode,resume,createdAt:Date.now()}));
 const original="cabinet_operation:"+OWNER_ID+":"+resume.nonce;
 if(/^[a-f0-9]{12}$/.test(resume.nonce||"")&&await env.VISITORS_KV.get(original))
  await env.VISITORS_KV.put(original,JSON.stringify({...resume,step:"domain_recovery",id,recoveryKey:key}));
 await statePut(env,{step:"domain_recovery",id,recoveryKey:key});
 if(!env.__operationKey)await clearProgress(env,send);
 await showDomainRecovery(env,send,id,!!env.__operationKey);return true;
}
async function verifyRecoveryLink(env,send,state,text,messageId){
 const link=parseProfileLink(text);
 if(!link||link.id!==state.id){
  await navigationSay(env,send,"🌹 DAME CAMELIAS\n\n🔗 НУЖНА ССЫЛКА НА ТУ ЖЕ АНКЕТУ\n\n🌹 Ожидаем анкету №"+state.id+"\n\n💕 Откройте именно её через действующий сайт и пришлите полную HTTPS-ссылку с актуальным доменом.",buttons([[{text:"🌹 К моим анкетам",callback_data:"owner_anketa:open"}]]));return;
 }
 const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
 await statePut(env,{step:"domain_refresh_verify",id:state.id,host:link.host,nonce,recoveryKey:state.recoveryKey});
 const started=await dispatchLookup(env,link.id,nonce,"domain_probe",link.host).catch(()=>({ok:false}));
 if(!started.ok){await statePut(env,state);await showDomainRecovery(env,send,state.id);return;}
 if(Number.isSafeInteger(messageId))try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:messageId});}catch{}
 await navigationSay(env,send,"⏳ Проверяю новую ссылку на анкету №"+state.id+"…\n\n💕 Затем продолжим с сохранённого шага. Публикации и списания сейчас не выполняются.");
}
async function resumeVerifiedDomain(env,send,current){
 const recovery=await env.VISITORS_KV.get(current.recoveryKey,"json");
 if(!recovery||recovery.id!==current.id||!recoverable(recovery.mode,recovery.resume?.step))return false;
 const id=current.id,host=current.host;
 const rehost=state=>({...state,host,...(state.profile?{profile:{...state.profile,url:"https://"+host+"/indi/anketa"+id+".htm"}}:{})});
 const record=await savedGet(env,id);
 if(record){
  await env.VISITORS_KV.put(PROFILE_KEY+id,JSON.stringify({...rehost(record),updatedAt:Date.now()}));
  for(const suffix of [".jpg",".card.jpg"]){
   const target=THUMBNAIL_PREFIX+host+"/"+id+suffix;
   if(!await env.VISITORS_KV.get(target,"arrayBuffer")){
    const image=await env.VISITORS_KV.get(THUMBNAIL_PREFIX+record.host+"/"+id+suffix,"arrayBuffer");
    if(image)await env.VISITORS_KV.put(target,image);
   }
  }
 }
 const draftKey="cabinet_rating_draft:"+OWNER_ID+":"+id,draft=await env.VISITORS_KV.get(draftKey,"json");
 if(draft)await env.VISITORS_KV.put(draftKey,JSON.stringify({...draft,host,url:"https://"+host+"/indi/anketa"+id+".htm"}),{expirationTtl:604800});
 const pending=await env.VISITORS_KV.get(REVIEW_PENDING_KEY+id,"json");
 if(pending)await env.VISITORS_KV.put(REVIEW_PENDING_KEY+id,JSON.stringify({...pending,host}));
 const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
 let mode=recovery.mode,next=rehost(recovery.resume);
 if(mode==="publish"){mode="proof";next={...next,step:"proof_loading",account:ACTIVE_ACCOUNT};}
 if(mode==="review_publish"){mode="review_proof";next={...next,step:"review_recheck",account:ACTIVE_ACCOUNT};}
 next={...next,id,nonce};
 if(mode==="ratings")next.previousNonce=nonce;
 if(["dryfill","review_proof"].includes(mode))next.agreedAt=Date.now();
 if(next.account===ACTIVE_ACCOUNT)await chooseAccount(env,id);
 await statePut(env,next);
 const started=await dispatchLookup(env,id,nonce,mode,host).catch(()=>({ok:false}));
 if(!started.ok){await requestDomainRecovery(env,send,next,mode);return true;}
 await env.VISITORS_KV.delete(current.recoveryKey);
 await navigationSay(env,send,"⏳ Новый адрес анкеты №"+id+" проверен.\n\n💕 Продолжаем с сохранённого шага."+(["proof","review_proof"].includes(mode)?"\n📸 Только проверяем результат — повторной отправки не будет.":"\n🔒 Выбранные данные сохранены. Новая публикация без подтверждения не запускается."));
 return true;
}
async function inspect(env,send,urlText) {
  const link=parseProfileLink(urlText);
  if (!link) {
    const previous=oldProfileLink(urlText);
    if(previous){
     const key=DOMAIN_RESUME_KEY+previous.id,recovery=await env.VISITORS_KV.get(key,"json");
     if(recovery){await statePut(env,{step:"domain_recovery",id:previous.id,recoveryKey:key});await showDomainRecovery(env,send,previous.id);}
     else await requestDomainRecovery(env,send,{step:"loading",id:previous.id,host:previous.host},"profile");return;
    }
    await say(env,send,"🌷 Кажется, ссылка указана не полностью.\n\n💕 Пришлите, пожалуйста, прямую ссылку на вашу анкету с актуальным доменом Intimcity. Я помогу продолжить.");
    return;
  }
  const {id,host}=link;
  const recoveryKey=DOMAIN_RESUME_KEY+id;
  if(await env.VISITORS_KV.get(recoveryKey,"json")){await verifyRecoveryLink(env,send,{step:"domain_recovery",id,recoveryKey},urlText);return;}
  const existing=await savedGet(env,id);
  if(existing?.confirmed&&existing.profile?.url===`https://${host}/indi/anketa${id}.htm`){await showSaved(env,send,id);return;}
  const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  if(!await statePut(env,{step:"loading",id,host,nonce})) {
    await say(env,send,"⚠️ Хранилище недоступно.");
    return;
  }
  let dispatched;
  try {dispatched=await dispatchLookup(env,id,nonce,"profile",host);}
  catch {dispatched={ok:false,reason:"Не удалось связаться с GitHub API"};}
  if(!dispatched?.ok) {
    await statePut(env,{step:"number"});
    await say(env,send,"🌷 Не получилось начать проверку анкеты.\n\n💕 Пожалуйста, попробуйте ещё раз чуть позже."+(isOwner?"\n\nТехническая информация: "+dispatched.reason:""));
    return;
  }
  await navigationSay(env,send,"⏳ Минутку, пожалуйста!\n\n💕 Проверяю вашу анкету №"+id+"…\n✨ Скоро всё будет готово!");
}
async function moderateReview(env,send,input){
 const key="cabinet_review_moderation:"+OWNER_ID+":"+input.ticket;
 const ticket=await env.VISITORS_KV.get(key,"json");if(!ticket)return {ok:false,note:"Заявка в кабинете не найдена."};
 if(input.action==="cancel"){
  if(ticket.status==="cancelled"&&ticket.cancelNoticeSent)return {ok:true,already:true};
  if(!["pending","cancelled"].includes(ticket.status))return {ok:false,note:"Отправка уже начиналась. Отмена недоступна."};
  if(Number.isSafeInteger(ticket.waitingMessageId)){
   await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:ticket.waitingMessageId}).catch(()=>{});
   const progress=await env.VISITORS_KV.get(PROGRESS_KEY,"json");if(progress?.id===ticket.waitingMessageId)await env.VISITORS_KV.delete(PROGRESS_KEY);
  }
  await env.VISITORS_KV.put(key,JSON.stringify({...ticket,status:"cancelled"}));
  await reviewDraftSave(env,ticket.snapshot);
  const active=await stateGet(env);
  if(active?.step==="review_moderation"&&active.moderationTicket===input.ticket)await statePut(env,{...ticket.snapshot,step:"review_cancelled",moderationTicket:input.ticket});
  await navigationSay(env,send,"🌹 DAME CAMELIAS\n\n✍️ ПОПРОБУЕМ ДРУГОЙ ОТЗЫВ\n\n🌹 Анкета №"+ticket.snapshot.id+"\n\n🌷 Этот отзыв не отправлен. Публикация не списана.\n\n💕 Напишите другой текст и отправьте его на повторную проверку.",buttons([[{text:"✍️ Ввести другой отзыв",callback_data:"owner_anketa:reviewretry:"+input.ticket}],[{text:"🌹 К моим анкетам",callback_data:"owner_anketa:open"}],[{text:"🏠 В начало",callback_data:"owner_anketa:home"}]]));
  await env.VISITORS_KV.put(key,JSON.stringify({...ticket,status:"cancelled",cancelNoticeSent:true}));return {ok:true};
 }
 if(ticket.status==="started")return {ok:true,already:true};
 if(ticket.status!=="pending"||input.action!=="approve"||typeof input.text!=="string"||input.text.length<10||input.text.length>3000)return {ok:false,note:"Заявка уже закрыта или текст некорректен."};
 const current={...ticket.snapshot,text:input.text,agreedAt:Date.now()};
 const saved=await savedGet(env,current.id);
 if(current.account!==ACTIVE_ACCOUNT||!saved||!HOST_PATTERN.test(saved.host||""))return {ok:false,note:"Проверьте сохранённую анкету и её адрес."};
 if(await publicationStatus(env,current.id,"review"))return {ok:false,note:"Публикация этой анкеты уже выполнена или требует проверки."};
 const balance=await credits(env,OWNER_ID,"status");if(balance.available<=0)return {ok:false,note:"У клиентки нет свободных публикаций."};
 const dailyDate=moscowDay();
 const daily=await dailyLimit(env,OWNER_ID,current.id,"reserve","review",current.nonce,dailyDate);
 if(!daily.ok)return {ok:false,note:"Дневной лимит анкеты исчерпан или действие уже зарезервировано."};
 let reserved;
 try{reserved=await credits(env,OWNER_ID,"reserve","review",current.id,current.nonce);}catch{await dailyLimit(env,OWNER_ID,current.id,"release","review",current.nonce,dailyDate);return {ok:false,note:"Не удалось проверить резерв публикации."};}
 if(!reserved.ok){await dailyLimit(env,OWNER_ID,current.id,"release","review",current.nonce,dailyDate);return {ok:false,note:"Не удалось зарезервировать публикацию."};}
 let claimed;
 try{claimed=await reviewGuard(env,current.id,"review_claim",current.nonce);}catch{}
 if(!claimed?.claimed){await releaseUnsubmitted(env,current.id,"review",current.nonce,dailyDate);return {ok:false,note:"Отзыв уже защищён от повторной отправки."};}
 if(!await recordPublication(env,current.id,"review","publishing","moderator-approved-review",{userId:OWNER_ID,creditNonce:current.nonce,dailyDate})){
  await releaseUnsubmitted(env,current.id,"review",current.nonce,dailyDate);return {ok:false,note:"Защита от повторов остановила отправку."};
 }
 const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
 const next={...current,host:saved.host,step:"review_dispatch",nonce,claimNonce:current.nonce,creditNonce:current.nonce,dailyDate,payloadIssued:false,confirmedAt:Date.now(),moderationTicket:input.ticket};
 await env.VISITORS_KV.put(REVIEW_PENDING_KEY+current.id,JSON.stringify({id:current.id,account:ACTIVE_ACCOUNT,text:current.text,claimNonce:current.nonce,creditNonce:current.nonce,dailyDate,host:saved.host,agreedAt:current.agreedAt,savedAt:new Date().toISOString(),moderationTicket:input.ticket}));
 await env.VISITORS_KV.put(key,JSON.stringify({...ticket,status:"started",text:input.text,operationNonce:nonce}));
 const active=await stateGet(env);
 if(active?.moderationTicket!==input.ticket)env={...env,__operationKey:"cabinet_operation:"+OWNER_ID+":"+nonce};
 await statePut(env,next);
 let dispatched;
 try{dispatched=await dispatchLookup(env,current.id,nonce,"review_publish",saved.host);}catch{}
 if(dispatched?.definitiveFailure)await releaseUnsubmitted(env,current.id,"review",current.nonce,dailyDate);
 return {ok:true,...(!dispatched?.ok?{note:"Запуск отправки не подтверждён. Повторной автоматической отправки не будет."}:{})};
}
async function handleOwnerAnketa(update,env,send) {
  const cb=update.callback_query;
  const msg=update.message;
  const data=String(cb?.data ?? "");
  const txt=String(msg?.text ?? "").trim();
  const command=txt.split(/\s+/)[0].split("@")[0];
  const owner=ownerAllowed(update);
  const ownerAction=data.startsWith("owner_anketa:") || command==="/anketa";
  if(owner){
    const pending=await env.VISITORS_KV?.get(CABINET_PENDING_KEY).catch(()=>null);
    if(isOwner && pending && msg?.text && !txt.startsWith("/")){
      try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:msg.message_id});}catch{}
      const attempts=Number(await env.VISITORS_KV?.get(CABINET_FAIL_KEY).catch(()=>0)||0);
      if(attempts>=5){
        await env.VISITORS_KV?.delete(CABINET_PENDING_KEY).catch(()=>{});
        await navigationSay(env,send,"🔒 Слишком много попыток. Повторите вход через 15 минут.");
        return true;
      }
      const configuredHash=String(env.OWNER_CABINET_PIN_SHA256||INITIAL_OWNER_PIN_HASH).toLowerCase();
      const matched=await pinDigest(txt)===configuredHash;
      if(matched){
        await env.VISITORS_KV.put(CABINET_SESSION_KEY,JSON.stringify({authorized:true,telegramId:OWNER_ID,verifiedAt:new Date().toISOString()}));
        await env.VISITORS_KV.delete(CABINET_PENDING_KEY);
        await env.VISITORS_KV.delete(CABINET_FAIL_KEY);
        await showLibrary(env,send);
      }else{
        await env.VISITORS_KV.put(CABINET_FAIL_KEY,String(attempts+1),{expirationTtl:900});
        await navigationSay(env,send,"🔐 Неверный код. Попробуйте снова.\n\nПосле пяти неудачных попыток вход временно блокируется.");
      }
      return true;
    }
    if(ownerAction || (msg?.text && oldProfileLink(txt))){
      if(data==="owner_anketa:home"){
        await env.VISITORS_KV?.delete(CABINET_PENDING_KEY).catch(()=>{});
      }else if(!(await cabinetAuthorized(env))){
        if(cb)await send(env,"answerCallbackQuery",{callback_query_id:cb.id}).catch(()=>{});
        const failed=Number(await env.VISITORS_KV?.get(CABINET_FAIL_KEY).catch(()=>0)||0);
        if(failed>=5){
          await navigationSay(env,send,"🔒 Вход временно заблокирован. Повторите через 15 минут.");
        }else{
          await cabinetChallenge(env,send);
        }
        return true;
      }
    }
  }
  const state=owner && !ownerAction ? await stateGet(env) : null;
  // Intimcity profile links take priority over general order free-text routing,
  // including when the previous owner prompt came from an older Worker version.
  const isProfileLink=owner && Boolean(msg?.text) && Boolean(oldProfileLink(txt));
  const typedLink=owner && Boolean(msg?.text) &&
    (isProfileLink || (["number","domain_recovery"].includes(state?.step) && /^https?:\/\//i.test(txt)));
  const reviewText=owner && !ownerAction && !typedLink && Boolean(msg?.text) &&
    ["review_input","review_preview"].includes(state?.step) && !txt.startsWith("/");
  // Cabinet access is permanent for a whitelisted ID after one successful PIN check.
  if(reviewText && !(await cabinetAuthorized(env))){
    await cabinetChallenge(env,send);
    return true;
  }
  if (!ownerAction && !typedLink && !reviewText) return false;
  if (!owner) {
    if(cb) await send(env,"answerCallbackQuery",{callback_query_id:cb.id,text:"Недоступно"});
    return true;
  }
  if(cb) await send(env,"answerCallbackQuery",{callback_query_id:cb.id});
  const domainResume=/^owner_anketa:domain_resume:(\d{1,9})$/.exec(data);
  if(domainResume){
   const id=domainResume[1],key=DOMAIN_RESUME_KEY+id,recovery=await env.VISITORS_KV.get(key,"json");
   if(!recovery){await showLibrary(env,send);return true;}
   await statePut(env,{step:"domain_recovery",id,recoveryKey:key});await showDomainRecovery(env,send,id);return true;
  }
  if(state?.step==="domain_recovery"&&state.recoveryKey&&!ownerAction&&Boolean(msg?.text)){
   await verifyRecoveryLink(env,send,state,txt,msg.message_id);return true;
  }
  if(state?.step==="domain_recovery" && !ownerAction && Boolean(msg?.text)){
    const link=parseProfileLink(txt);
    if(!link||link.id!==String(state.id)){
      await navigationSay(env,send,"🌷 Пришлите актуальную ссылку именно на анкету №"+state.id+". Номер должен остаться прежним.");
      return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const targetId=String(state.id);
    await statePut(env,{step:"domain_verify",verifyId:link.id,targetId,
      host:link.host,nonce,mode:state.mode});
    const started=await dispatchLookup(env,link.id,nonce,"domain_probe",link.host).catch(()=>({ok:false}));
    if(!started.ok){
      await statePut(env,{step:"domain_recovery",id:targetId,mode:state.mode});
      await navigationSay(env,send,"🌷 Не получилось проверить новый адрес. Пожалуйста, повторите ссылку позже.");
      return true;
    }
    if(Number.isSafeInteger(msg.message_id))try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:msg.message_id});}catch{}
    await navigationSay(env,send,"⏳ Проверяю действующий адрес анкеты №"+link.id+
      "…\n\n✍️ Затем проверю ваш ранее опубликованный отзыв №"+targetId+
      ". Домен обновлю только после отправки скриншота в Telegram.");
    return true;
  }
  if (data==="owner_anketa:home") {await closeProofMessages(env,send,cb?.message?.photo?.length?cb.message.message_id:null);let nav=null;try{nav=await env.VISITORS_KV?.get(NAV_MESSAGE_KEY,"json");}catch{} if(Number.isSafeInteger(nav?.id)){try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:nav.id});}catch{}} await clearProgress(env,send);try{await env.VISITORS_KV?.delete(NAV_MESSAGE_KEY);}catch{} return true;}
  if (data==="owner_anketa:open" ||
      (command==="/anketa" && txt.split(/\s+/).length===1)) {
    if(data==="owner_anketa:open")await closeProofMessages(env,send,cb?.message?.photo?.length?cb.message.message_id:null);
    await showLibrary(env,send); return true;
  }
  if (data==="owner_anketa:new" || data==="owner_anketa:change") {await askNumber(env,send);return true;}
  if (command==="/anketa") {
    const url=txt.split(/\s+/)[1] ?? "";
    await inspect(env,send,url); return true;
  }
  if(reviewText){
    const id=String(state?.id||"");
    if(!ID_PATTERN.test(id)||!await savedGet(env,id)||!await selectedAccount(env,id)||await publicationStatus(env,id,"review")){
      await showLibrary(env,send);return true;
    }
    if(txt.length<10||txt.length>3000){
      await navigationSay(env,send,"✍️ Отзыв должен содержать от 10 до 3000 символов. Пришлите исправленный текст.",
        buttons([[{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+id}]]));return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,16);
    await statePut(env,{step:"review_preview",id,account:ACTIVE_ACCOUNT,text:txt,nonce});
    await reviewDraftSave(env,{id,account:ACTIVE_ACCOUNT,text:txt});
    try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:msg.message_id});}catch{}
    await navigationSay(env,send,"👀 ПРОВЕРКА ОТЗЫВА\n\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+id+
      "\n\n💬 Ваш текст:\n\n"+txt+"\n\n☑️ Подтверждаю, что текст соответствует реальности и не ведет в заблуждение клиентов.\n\n🌷 Публикация пока недоступна.",
      buttons([[{text:"☐ Подтвердить достоверность",callback_data:"owner_anketa:reviewagree:"+nonce}],
        [{text:"✏️ Изменить текст",callback_data:"owner_anketa:reviewedit:"+nonce}],
        [{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+id}],
        [{text:"📋 К моим анкетам",callback_data:"owner_anketa:open"}]]));return true;
  }
  const reviewAgree=/^owner_anketa:reviewagree:([a-f0-9]{16})$/.exec(data);
  if(reviewAgree){
    const current=await stateGet(env);
    if(current?.step!=="review_preview" || current.nonce!==reviewAgree[1] ||
        !await selectedAccount(env,current.id) || await publicationStatus(env,current.id,"review")){
      await showLibrary(env,send);return true;
    }
    await statePut(env,{...current,step:"review_agreed",agreedAt:Date.now()});
    await navigationSay(env,send,"✅ ДОСТОВЕРНОСТЬ ПОДТВЕРЖДЕНА\n\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+current.id+
      "\n\n💬 Текст отзыва:\n\n"+current.text+
      "\n\nПодтверждаю, что текст соответствует реальности и не ведет в заблуждение клиентов."+
      "\n\n✨ Всё готово. Для отправки нажмите кнопку публикации.",
      buttons([[{text:"✅ Опубликовать отзыв",callback_data:"owner_anketa:reviewfinal:"+current.nonce}],
        [{text:"✏️ Изменить текст",callback_data:"owner_anketa:reviewedit:"+current.nonce}],
        [{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+current.id}],
        [{text:"📋 К моим анкетам",callback_data:"owner_anketa:open"}]]));return true;
  }
  if(data.startsWith("owner_anketa:reviewrecover")){
    await navigationSay(env,send,"🔒 Повторная публикация исторического отзыва запрещена. Доступна только проверка подтверждения.");return true;
  }
  const reviewProof=/^owner_anketa:reviewproof:(\d{1,9})$/.exec(data);
  if(reviewProof){
    const id=reviewProof[1];
    if(!await selectedAccount(env,id) || !await savedGet(env,id) ||
       (await publicationStatus(env,id,"review"))?.status!=="published"){
      await showLibrary(env,send);return true;
    }
    if(!await deliverSavedReviewProof(env,send,id))
      await navigationSay(env,send,"🌷 Скриншот пока недоступен. Попробуйте проверить отзыв позже.");
    return true;
  }
  const reviewCheck=/^owner_anketa:reviewcheck:(\d{1,9})$/.exec(data);
  if(reviewCheck){
    const id=reviewCheck[1],pending=await env.VISITORS_KV?.get(REVIEW_PENDING_KEY+id,"json");
    const guard=await reviewGuard(env,id,"review_status");
    if(!await selectedAccount(env,id)||!await savedGet(env,id)||!guard.claimed||
       guard.status==="published"||pending?.account!==ACTIVE_ACCOUNT||
       pending.id!==id||!HOST_PATTERN.test(pending.host||"")||
       typeof pending.text!=="string"||pending.text.length<10||
       !/^[a-f0-9]{16}$/.test(pending.claimNonce||"")){
      await navigationSay(env,send,"🌷 Сейчас проверка недоступна. Повторная публикация запрещена.");return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    await statePut(env,{step:"review_recheck",id,account:ACTIVE_ACCOUNT,
      nonce,text:pending.text,claimNonce:pending.claimNonce,moderationTicket:pending.moderationTicket,creditNonce:pending.creditNonce||pending.claimNonce,dailyDate:pending.dailyDate||(pending.savedAt?moscowDay(new Date(pending.savedAt)):undefined),
      agreedAt:Date.now(),host:pending.host});
    await progressSay(env,send,"⏳ ПРОВЕРЯЕМ ОТЗЫВ\n\n🌹 Анкета №"+id+
      "\n📸 Ищем опубликованный отзыв и подтверждение.");
    let launched=false;
    try{launched=(await dispatchLookup(env,id,nonce,"review_proof",pending.host)).ok;}catch{}
    if(!launched)await progressSay(env,send,"🌷 Не удалось начать проверку. Повторная отправка не выполнялась.");
    return true;
  }
  const reviewFinal=/^owner_anketa:reviewfinal:([a-f0-9]{16})$/.exec(data);
  if(reviewFinal){
    const current=await stateGet(env);
    if(current?.step==="review_moderation"&&current.moderationTicket===reviewFinal[1])return true;
    if(current?.step!=="review_agreed" || current.nonce!==reviewFinal[1] ||
       current.account!==ACTIVE_ACCOUNT || !ID_PATTERN.test(String(current.id)) ||
       !(current.agreedAt>0) || Date.now()-current.agreedAt>15*60*1000 ||
       typeof current.text!=="string" || current.text.length<10 || current.text.length>3000 ||
       !await selectedAccount(env,current.id) || !await savedGet(env,current.id)){
      await navigationSay(env,send,"🌷 Подтверждение устарело. Откройте анкету и проверьте отзыв заново.");return true;
    }
    const key="cabinet_review_moderation:"+OWNER_ID+":"+current.nonce;
    const existing=await env.VISITORS_KV.get(key,"json");if(existing)return true;
    if(await ensureNoRepeat(env,current.id,"review",send))return true;
    if(!await requireCredit(env,send))return true;
    await env.VISITORS_KV.put(key,JSON.stringify({status:"pending",snapshot:current}));
    let queued;
    try{queued=await moderationRPC(env,OWNER_ID,current.nonce,{action:"enqueue",profileId:current.id,account:current.account,text:current.text,username:cb?.from?.username||msg?.from?.username});}catch{}
    if(!queued?.ok){
      await env.VISITORS_KV.put(key,JSON.stringify({status:"delivery_unknown",snapshot:current}));
      await navigationSay(env,send,"🌷 Не удалось подтвердить передачу отзыва на проверку. Текст сохранён, публикация и списание не выполнялись. Обратитесь к менеджеру.",buttons([[{text:"💬 Связаться с менеджером",url:"https://t.me/DameCamelias"}]]));return true;
    }
    await statePut(env,{...current,step:"review_moderation",moderationTicket:current.nonce});
    await progressSay(env,send,"⏳ ПУБЛИКУЕМ ОТЗЫВ\n\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+current.id+"\n\n💕 Проверяем результат. Скоро пришлём подтверждение.");
    const waiting=await env.VISITORS_KV.get(PROGRESS_KEY,"json");
    await env.VISITORS_KV.put(key,JSON.stringify({status:"pending",snapshot:current,waitingMessageId:waiting?.id}));
    return true;
  }

  const reviewDraft=/^owner_anketa:reviewdraft:([a-f0-9]{16})$/.exec(data);
  if(reviewDraft){
    const draft=await stateGet(env);
    if(draft?.step!=="review_input" || draft.editing!==true ||
       draft.nonce!==reviewDraft[1] || !ID_PATTERN.test(String(draft.id)) ||
       !await selectedAccount(env,draft.id) || !await savedGet(env,draft.id) ||
       await publicationStatus(env,draft.id,"review") ||
       typeof draft.text!=="string" || draft.text.length<10 || draft.text.length>3000){
      await showLibrary(env,send);return true;
    }
    await statePut(env,{...draft,step:"review_preview",editing:false,agreedAt:null});
    await reviewDraftSave(env,draft);
    await navigationSay(env,send,"👀 ПРОВЕРКА ОТЗЫВА\n\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+draft.id+
      "\n\n💬 Ваш текст:\n\n"+draft.text+
      "\n\n☑️ Подтверждаю, что текст соответствует реальности и не ведет в заблуждение клиентов.\n\n🌷 Публикация пока недоступна.",
      buttons([[{text:"☐ Подтвердить достоверность",callback_data:"owner_anketa:reviewagree:"+draft.nonce}],
        [{text:"✏️ Изменить текст",callback_data:"owner_anketa:reviewedit:"+draft.nonce}],
        [{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+draft.id}],
        [{text:"📋 К моим анкетам",callback_data:"owner_anketa:open"}]]));
    return true;
  }
  const reviewEdit=/^owner_anketa:reviewedit:([a-f0-9]{16})$/.exec(data);
  if(reviewEdit){
    const current=await stateGet(env);
    if(!["review_preview","review_agreed"].includes(current?.step)||current.nonce!==reviewEdit[1]||!await selectedAccount(env,current.id)){
      await showLibrary(env,send);return true;
    }
    await reviewDraftSave(env,current);
    await statePut(env,{...current,step:"review_input",editing:true,agreedAt:null});
    await navigationSay(env,send,"✍️ ИЗМЕНИТЬ ОТЗЫВ\n\n🌹 Анкета №"+current.id+
      "\n\n💬 Ваш предыдущий текст сохранён:\n\n"+current.text+
      "\n\nПришлите исправленный текст одним сообщением или вернитесь к черновику.",
      buttons([[{text:"↩️ К черновику",callback_data:"owner_anketa:reviewdraft:"+current.nonce}],
        [{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+current.id}]]));return true;
  }
  if (typedLink) {
    await trackAnketaMessage(env,msg?.message_id);
    // Remove the submitted URL when it has been processed; state retains the profile.
    // Do not route a profile URL into the customer order conversation.
    await inspect(env,send,txt);
    try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:msg.message_id});}catch{}
    return true;
  }
  const proofThanks=/^owner_anketa:proofthanks:(\d{1,9})$/.exec(data);
  if(proofThanks){
    const id=proofThanks[1];
    await closeClientFlow(env,send,id,cb?.message?.message_id);
    if(!await savedGet(env,id)){await showLibrary(env,send);return true;}
    if(!await chooseAccount(env,id)){await showSaved(env,send,id);return true;}
    const summary=await availabilitySummary(env,id,ACTIVE_ACCOUNT);
    await accountCardNavigation(env,send,ACTIVE_ACCOUNT,id,
      "👥 КЛИЕНТ\n\n👨‍💻 ЯН ПЕРВЫЙ\n\n🌹 Ваша анкета №"+id+
      "\n\n"+summary+"\n\n💕 Выберите действие:",
      await profileKeyboard(env,id));
    await startClientFlow(env,id);
    return true;
  }
  const savedMenu=/^owner_anketa:saved:(\d{1,9})$/.exec(data);
  if(savedMenu){await closeProofMessages(env,send,cb?.message?.photo?.length?cb.message.message_id:null);await showSaved(env,send,savedMenu[1]);return true;}
  const accountList=new RegExp("^owner_anketa:accounts:([0-9]{1,9})$").exec(data);
  if(accountList){await showAccountPicker(env,send,accountList[1]);return true;}
  const account1=/^owner_anketa:account1:(\d{1,9})$/.exec(data);
  if(account1){
    const rec=await savedGet(env,account1[1]);
    if(!rec){await showLibrary(env,send);return true;}
    if(!await chooseAccount(env,account1[1])){
      await say(env,send,"⚠️ Не удалось сохранить выбор аккаунта. Попробуйте ещё раз.");return true;
    }
    await startClientFlow(env,account1[1]);
    const summary=await availabilitySummary(env,account1[1],ACTIVE_ACCOUNT);
    await profileBannerNavigation(env,send,rec,account1[1],"👥 КЛИЕНТ\n\n👨‍💻 ЯН ПЕРВЫЙ\n\n🌹 Ваша анкета №"+account1[1]+
      "\n\n"+summary+
      (summary.includes("Все доступные публикации завершены!")?"\n\n📸 Подтверждения ваших публикаций доступны ниже.":"\n\n💕 Выберите действие:"),await profileKeyboard(env,account1[1]),"HTML");
    return true;
  }
  const account2=/^owner_anketa:account2:(\d{1,9})$/.exec(data);
  if(account2){
    const inactiveProfile=await savedGet(env,account2[1]);
    if(!inactiveProfile){await showLibrary(env,send);return true;}
    await profileBannerNavigation(env,send,inactiveProfile,account2[1],"🔒 ЯН ВТОРОЙ\n🌹 Анкета №"+account2[1]+
      "\n\nДля данной анкеты доступны:\n\n"+await availabilitySummary(env,account2[1],"yan_second")+
      "\n\n🔒 Аккаунт пока не подключён.\n\n💕 Выберите действие:",buttons([
        [{text:"👥 К выбору клиентов",callback_data:"owner_anketa:accounts:"+account2[1]}],
        [{text:"⬅️ К анкете",callback_data:"owner_anketa:saved:"+account2[1]}],
        [{text:"🏠 В начало",callback_data:"owner_anketa:home"}]
      ]));
    return true;
  }
  const proofRequest=/^owner_anketa:proof:(\d{1,9})$/.exec(data);
  if(proofRequest){
    const id=proofRequest[1];
    if(!await selectedAccount(env,id)){
      await showSaved(env,send,id);return true;
    }
    const rec=await savedGet(env,id);
    const rated=await publicationStatus(env,id,"rating");
    if(!rec || !rated || rated.shared){await say(env,send,"🌷 Оценка для этой анкеты ещё не публиковалась.");return true;}
    if(await deliverSavedProof(env,send,ACTIVE_ACCOUNT,id))return true;
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    await statePut(env,{step:"proof_loading",id,nonce,account:ACTIVE_ACCOUNT,profile:rec.profile,host:rec.host,creditNonce:rated.creditNonce,dailyDate:rated.dailyDate});
    let started=false;
    try{started=(await dispatchLookup(env,id,nonce,"proof",rec.host)).ok;}catch{}
    if(!started){
      await statePut(env,{step:"publication_result",id,profile:rec.profile});
      await say(env,send,"⚠️ Проверку пока не удалось запустить. Ничего на сайте не изменено.");
      return true;
    }
    await progressSay(env,send,"⏳ Минуточку, пожалуйста!\n\n💕 Мы готовим для вас подтверждение опубликованных оценок.\n📸 Совсем скоро пришлём красивый отчёт с фотографией.");
    return true;
  }
  const draftRoute=/^owner_anketa:draft(resume|new):(\d{1,9})$/.exec(data);
  if(draftRoute){
    const [,choice,id]=draftRoute;
    if(!await savedGet(env,id)||!await selectedAccount(env,id)||
       await publicationStatus(env,id,"review")){await showSaved(env,send,id);return true;}
    const draft=await reviewDraftGet(env,id);
    if(choice==="resume"){
      if(!draft){await navigationSay(env,send,"🌷 Черновик больше недоступен.",buttons([[{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+id}]]));return true;}
      const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,16);
      await statePut(env,{step:"review_preview",id,account:ACTIVE_ACCOUNT,text:draft.text,nonce});
      await navigationSay(env,send,"👀 ПРОВЕРКА ОТЗЫВА\n\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+id+
        "\n\n💬 Ваш текст:\n\n"+draft.text+
        "\n\n☑️ Подтверждаю, что текст соответствует реальности и не ведет в заблуждение клиентов.\n\n🌷 Публикация пока недоступна.",
        buttons([[{text:"☐ Подтвердить достоверность",callback_data:"owner_anketa:reviewagree:"+nonce}],
          [{text:"✏️ Изменить текст",callback_data:"owner_anketa:reviewedit:"+nonce}],
          [{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+id}]]));
      return true;
    }
    await env.VISITORS_KV?.delete(REVIEW_DRAFT_KEY+id);
    await statePut(env,{step:"review_input",id,account:ACTIVE_ACCOUNT});
    await navigationSay(env,send,"✍️ НОВЫЙ ОТЗЫВ\n\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+id+
      "\n\n💬 НАПИШИТЕ ТЕКСТ ОТЗЫВА\n\n👇 Введите ваш отзыв в поле сообщения внизу экрана и отправьте его на проверку",
      buttons([[{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+id}]]));
    return true;
  }
  const retryReview=/^owner_anketa:reviewretry:([a-f0-9]{16})$/.exec(data);
  if(retryReview){
    const ticket=await env.VISITORS_KV.get("cabinet_review_moderation:"+OWNER_ID+":"+retryReview[1],"json");
    const id=String(ticket?.snapshot?.id||"");
    if(ticket?.status!=="cancelled"||!ID_PATTERN.test(id)||!await savedGet(env,id)){await showLibrary(env,send);return true;}
    if(await ensureNoRepeat(env,id,"review",send))return true;
    if(!await requireCredit(env,send))return true;
    await chooseAccount(env,id);
    await statePut(env,{step:"review_input",id,account:ACTIVE_ACCOUNT});
    await navigationSay(env,send,"🌹 DAME CAMELIAS\n\n✍️ НОВЫЙ ТЕКСТ ОТЗЫВА\n\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+id+"\n\n💕 Напишите другой отзыв одним сообщением. Затем проверьте текст и подтвердите отправку на проверку.",buttons([[{text:"⬅️ К анкете",callback_data:"owner_anketa:saved:"+id}],[{text:"🌹 К моим анкетам",callback_data:"owner_anketa:open"}]]));return true;
  }
  const savedReview=/^owner_anketa:savedreview:(\d{1,9})$/.exec(data);
  if(savedReview){
    if(!await selectedAccount(env,savedReview[1])){
      await showSaved(env,send,savedReview[1]);return true;
    }
    if(await ensureNoRepeat(env,savedReview[1],"review",send))return true;
    if(!await requireCredit(env,send))return true;
    if(!await savedGet(env,savedReview[1])){await showLibrary(env,send);return true;}
    const existingDraft=await reviewDraftGet(env,savedReview[1]);
    if(existingDraft){
      await navigationSay(env,send,"✍️ СОХРАНЁННЫЙ ЧЕРНОВИК\n\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+savedReview[1]+
        "\n\n💬 Ваш текст:\n\n"+existingDraft.text+
        "\n\nПродолжить работу с черновиком или начать заново?",
        buttons([[{text:"📝 Продолжить черновик",callback_data:"owner_anketa:draftresume:"+savedReview[1]}],
          [{text:"🆕 Начать заново",callback_data:"owner_anketa:draftnew:"+savedReview[1]}],
          [{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+savedReview[1]}]]));
      return true;
    }
    await statePut(env,{step:"review_input",id:savedReview[1],account:ACTIVE_ACCOUNT});
    await navigationSay(env,send,"✍️ НОВЫЙ ОТЗЫВ\n\n👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+savedReview[1]+
      "\n\n💬 НАПИШИТЕ ТЕКСТ ОТЗЫВА\n\n👇 Введите ваш отзыв в поле сообщения внизу экрана и отправьте его на проверку",
      buttons([[{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+savedReview[1]}],
        [{text:"📋 К моим анкетам",callback_data:"owner_anketa:open"}]]));
    return true;
  }
  const savedRating=/^owner_anketa:savedrating:(\d{1,9})$/.exec(data);
  if(savedRating){
    if(!await selectedAccount(env,savedRating[1])){
      await showSaved(env,send,savedRating[1]);return true;
    }
    if(await ensureNoRepeat(env,savedRating[1],"rating",send))return true;
    if(!await requireCredit(env,send))return true;
    const rec=await savedGet(env,savedRating[1]);
    if(!rec){await showLibrary(env,send);return true;}
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    if(rec.catalog?.length && (!rec.profile?.photoUrl ||
       (!rec.profile.photoUrl.startsWith("https://cdn2.intimtur.com/") &&
        rec.profile.photoUrl!==thumbnailUrl(rec.profile.id,rec.host)))){
      // One-time thumbnail backfill for existing saved profiles.
      const refreshNonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
      await statePut(env,{step:"ratings_loading",account:ACTIVE_ACCOUNT,id:rec.profile.id,
        nonce:refreshNonce,previousNonce:refreshNonce,profile:rec.profile,host:rec.host});
      let refreshed=false;
      try{refreshed=(await dispatchLookup(env,rec.profile.id,refreshNonce,"ratings",rec.host)).ok;}catch{}
      if(refreshed){
        await navigationSay(env,send,"🌹 Обновляю фотографию анкеты №"+rec.profile.id+
          ".\n\n💕 Сохранённые оценки и история публикаций останутся на месте.");
        return true;
      }
    }
    if(rec.catalog?.length){
      await statePut(env,{step:"ratings",account:ACTIVE_ACCOUNT,profile:rec.profile,host:rec.host,catalog:organizeCatalog(rec.catalog),selected:{},nonce,...await ratingDraftGet(env,rec.profile.id,rec.host,organizeCatalog(rec.catalog))});
      await navigationSay(env,send,"🌹 ВАША ФОРМА ГОТОВА!\n\n💎 Откройте сохранённый перечень услуг и отметьте нужное.\n💕 Сохранённый выбор восстановится, если перечень услуг не изменился.",
        buttons([[{text:"💎 Заполнить оценки",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/anketa/ratings?key="+nonce}}],
        [{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+savedRating[1]}]]));
      return true;
    }
    await statePut(env,{step:"ratings_loading",account:ACTIVE_ACCOUNT,id:rec.profile.id,nonce,previousNonce:nonce,profile:rec.profile,host:rec.host});
    let started=false;
    try{started=(await dispatchLookup(env,rec.profile.id,nonce,"ratings",rec.host)).ok;}catch{}
    if(!started){await say(env,send,"🌷 Пока не получилось загрузить услуги. Попробуйте ещё раз позже.");return true;}
    await navigationSay(env,send,"🌸 Первый раз собираю доступные услуги этой анкеты. Это займёт немного времени.\n✨ В дальнейшем форма будет открываться сразу.");
    return true;
  }
  const deleteAsk=/^owner_anketa:deleteask:(\d{1,9})$/.exec(data);
  if(deleteAsk){
    if(!await savedGet(env,deleteAsk[1])){await showLibrary(env,send);return true;}
    await navigationSay(env,send,"🌷 Удалить анкету №"+deleteAsk[1]+" из вашего списка и хранилища DAME CAMELIAS?\n\nЭто действие нельзя отменить.",
      buttons([[{text:"🗑 Да, удалить",callback_data:"owner_anketa:deleteyes:"+deleteAsk[1]}],
        [{text:"↩️ Оставить анкету",callback_data:"owner_anketa:saved:"+deleteAsk[1]}]]));
    return true;
  }
  const deleteYes=/^owner_anketa:deleteyes:(\d{1,9})$/.exec(data);
  if(deleteYes){
    await savedDelete(env,deleteYes[1]);
    const currentState=await stateGet(env);
    if(String(currentState?.profile?.id||currentState?.id)===deleteYes[1])await env.VISITORS_KV.delete(PREFIX+OWNER_ID);
    await showLibrary(env,send);
    return true;
  }
  const current=await stateGet(env);
  if(data.startsWith("owner_anketa:confirm:")) {
    const nonce=data.slice("owner_anketa:confirm:".length);
    if(current && ["chosen","ratings"].includes(current.step) && current.nonce===nonce) {
      await say(env,send,"✅ Анкета "+current.profile.name+" уже подтверждена. 🌹\n\n💕 Продолжим работу с ней?",
        buttons([[{text:"⭐ Оценки",callback_data:"owner_anketa:rating:"+nonce}],
                 [{text:"✍️ Отзыв",callback_data:"owner_anketa:review:"+nonce}],NEW_NUMBER]));
      return true;
    }
    if(!current || current.step!=="confirm" || current.nonce!==nonce) {
      await say(env,send,"⏳ Подтверждение устарело. Нажми 🔐 АНКЕТА и введи номер заново.");
      return true;
    }
    const prior=await savedGet(env,current.profile.id);
    await savedPut(env,{profile:current.profile,host:current.host,catalog:prior?.host===current.host?prior.catalog||[]:[]});
    await statePut(env,{step:"chosen",profile:current.profile,host:current.host,nonce});
    await showSaved(env,send,current.profile.id);
    return true;
  }
  const consent=/^owner_anketa:consent:([a-f0-9]{12})$/.exec(data);
  if(consent) {
    if(current?.account!==ACTIVE_ACCOUNT || !await selectedAccount(env,current.profile?.id)){
      await say(env,send,"🌷 Сначала выберите 👨‍💻 Ян Первый в меню анкеты.");return true;
    }
    if(current?.profile?.id && await ensureNoRepeat(env,current.profile.id,"rating",send))return true;
    if(!current || current.step!=="ratings" || current.nonce!==consent[1] || !current.draftReady) {
      await say(env,send,"🌷 Это подтверждение уже неактуально. Откройте форму оценок и проверьте выбор ещё раз.");
      return true;
    }
    const picks=Object.keys(current.selected||{}).map(Number).sort((a,b)=>a-b).map(i=>({
      index:i,label:current.catalog[i]?.label,value:current.selected[i]
    }));
    const approved={...current,step:"ratings_agreed",agreedAt:Date.now()};
    if(!picks.length || picks.length>120 || picks.some(x=>!x.label||typeof x.value!=="string")){
      await statePut(env,approved);
      await say(env,send,"⚠️ Подготовка остановлена: не удалось проверить перечень оценок. Ничего не опубликовано.");
      return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const pending={...approved,step:"dryfill_loading",id:current.profile.id,previousNonce:current.nonce,
      nonce,prepublish:true};
    if(!await statePut(env,pending)){
      await say(env,send,"⚠️ Не удалось сохранить подготовку. Ничего не опубликовано.");return true;
    }
    await progressSay(env,send,"⏳ Спасибо! Ваши оценки получены.\n\n💕 Сейчас мы аккуратно проверяем все детали перед публикацией.\n✨ Пожалуйста, подождите немного — скоро сообщим, когда всё будет готово.");
    let started=false;
    try{started=(await dispatchLookup(env,pending.id,nonce,"dryfill",current.host)).ok;}catch{}
    if(!started){
      await statePut(env,approved);
      await say(env,send,"⚠️ Не удалось запустить подготовку. Ничего не опубликовано.");
    }
    return true;
  }
  const publishConfirm=/^owner_anketa:publish_confirm:([a-f0-9]{12})$/.exec(data);
  if(publishConfirm){
    if(current?.account!==ACTIVE_ACCOUNT || !await selectedAccount(env,current.profile?.id)){
      await say(env,send,"🌷 Для публикации нужно заново выбрать 👨‍💻 Ян Первый и подготовить оценки.");return true;
    }
    if(current?.profile?.id && await ensureNoRepeat(env,current.profile.id,"rating",send))return true;
    if(!current || current.step!=="prepublish_ready" || current.nonce!==publishConfirm[1] ||
        !current.readyAt || Date.now()-current.readyAt>15*60*1000){
      await say(env,send,"🌷 Подтверждение устарело. Проверьте оценки повторно.");return true;
    }
    if(!await requireCredit(env,send))return true;
    const dailyDate=await reserveDailySlot(env,send,current.profile.id,"rating",current.nonce);
    if(!dailyDate)return true;
    let creditReservation;
    try{creditReservation=await credits(env,OWNER_ID,"reserve","rating",current.profile.id,current.nonce);}
    catch{
      try{await dailyLimit(env,OWNER_ID,current.profile.id,"release","rating",current.nonce,dailyDate);}catch{}
      await say(env,send,"⚠️ Не удалось зарезервировать публикацию. Повторите позже.");return true;
    }
    if(!creditReservation.ok){
      try{await dailyLimit(env,OWNER_ID,current.profile.id,"release","rating",current.nonce,dailyDate);}catch{}
      await say(env,send,"💎 Нет свободных публикаций или эта анкета уже зарезервирована.");
      return true;
    }
    // Permanent per-profile guard before the external submission is dispatched.
    let claim;
    try{claim=await claimPublication(env,OWNER_ID,current.profile.id,"rating",current.nonce);}catch{}
    if(!claim?.ok){
      await credits(env,OWNER_ID,"release","rating",current.profile.id,current.nonce);
      await dailyLimit(env,OWNER_ID,current.profile.id,"release","rating",current.nonce,dailyDate);
      await say(env,send,"🔒 Публикация этой оценки уже начиналась или временно недоступна.");return true;
    }
    if(!await recordPublication(env,current.profile.id,"rating","publishing","owner-confirmation",{userId:OWNER_ID,creditNonce:current.nonce,dailyDate})){
      await say(env,send,"🔒 Публикация уже была начата или завершена. Повтор запрещён.");
      return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const pending={...current,step:"publishing",id:current.profile.id,creditNonce:current.nonce,dailyDate,
      nonce,previousNonce:current.nonce,readyAt:null,
      confirmedAt:Date.now(),dispatchPending:true};
    if(!await statePut(env,pending)){
      await say(env,send,"⚠️ Не удалось сохранить подтверждение. Ничего не опубликовано.");
      return true;
    }
    // The accepted confirmation must not remain with active publication buttons.
    // Clear the older preparation progress first so publication status is last in the chat.
    await clearProgress(env,send);
    if(Number.isSafeInteger(cb?.message?.message_id)){
      try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:cb.message.message_id});}
      catch{
        // If deletion is unavailable, at least disable stale confirm/cancel buttons.
        try{await send(env,"editMessageReplyMarkup",{chat_id:OWNER_ID,message_id:cb.message.message_id,reply_markup:buttons([])});}catch{}
      }
    }
    await progressSay(env,send,"⏳ Спасибо за доверие!\n\n💕 Сейчас мы публикуем ваши оценки для анкеты №"+pending.id+".\n📸 Пожалуйста, подождите немного — по завершении пришлём подтверждение с фотографией.");
    let launched=false;
    let dispatchResult;
    try{dispatchResult=await dispatchLookup(env,pending.id,nonce,"publish",current.host);launched=dispatchResult.ok;}catch{}
    if(dispatchResult?.definitiveFailure)await releaseUnsubmitted(env,pending.id,"rating",current.nonce,dailyDate);
    if(!launched){
      // Dispatch may have succeeded despite a transport timeout. Do not restore
      // the ready-to-publish state or trigger a second attempt.
      await say(env,send,"⚠️ GitHub не подтвердил запуск. Автоматического повтора не будет. Проверьте GitHub Actions.");
    }
    return true;
  }
  const publishCancel=/^owner_anketa:publish_cancel:([a-f0-9]{12})$/.exec(data);
  if(publishCancel){
    if(current?.step==="prepublish_ready" && current.nonce===publishCancel[1]){
      await statePut(env,{...current,step:"ratings_agreed",prepublish:false,readyAt:null});
      if(Number.isSafeInteger(cb?.message?.message_id)){
        try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:cb.message.message_id});}
        catch{try{await send(env,"editMessageReplyMarkup",{chat_id:OWNER_ID,message_id:cb.message.message_id,reply_markup:buttons([])});}catch{}}
      }
      await clearProgress(env,send);
      await navigationSay(env,send,"❌ Подготовка отменена. Ничего не опубликовано.",buttons([
        [{text:"⬅️ Вернуться к клиенту",callback_data:"owner_anketa:account1:"+current.profile.id}],
        [{text:"📋 К моим анкетам",callback_data:"owner_anketa:open"}]
      ]));
    }
    return true;
  }
  const dryfill=/^owner_anketa:dryfill:([a-f0-9]{12})$/.exec(data);
  if(dryfill){
    if(current?.profile?.id && await ensureNoRepeat(env,current.profile.id,"rating",send))return true;
    if(!current || current.step!=="ratings_agreed" || current.nonce!==dryfill[1] ||
        !Object.keys(current.selected||{}).length){
      await say(env,send,"🌷 Для теста подтвердите новый отчёт оценок.");return true;
    }
    const picks=Object.keys(current.selected).map(Number).sort((a,b)=>a-b).map(i=>({
      index:i,label:current.catalog[i]?.label,value:current.selected[i]
    }));
    if(picks.some(x=>!x.label||typeof x.value!=="string")||picks.length>120){
      await say(env,send,"⚠️ Некорректный перечень выбранных полей.");return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const pending={...current,step:"dryfill_loading",id:current.profile.id,previousNonce:current.nonce,nonce};
    await statePut(env,pending);
    let started=false;
    try{started=(await dispatchLookup(env,pending.id,nonce,"dryfill",current.host)).ok;}catch{}
    if(!started){
      await statePut(env,current);
      await say(env,send,"🌷 Тестовый запуск не удался. Ничего не опубликовано.");return true;
    }
    await say(env,send,"🧪 Проверяю выбранные поля анкеты №"+pending.id+
      " во временном браузере.\n\n🌷 Отправка формы на Intimcity отключена.");
    return true;
  }
  const audit=/^owner_anketa:audit:([a-f0-9]{12})$/.exec(data);
  if(audit){
    if(current?.profile?.id && await ensureNoRepeat(env,current.profile.id,"rating",send))return true;
    if(!current || current.step!=="ratings_agreed" || current.nonce!==audit[1] ||
        !Object.keys(current.selected||{}).length){
      await say(env,send,"🌷 Сначала подтвердите новый отчёт с оценками.");return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const pending={...current,step:"audit_loading",id:current.profile.id,
      previousNonce:current.nonce,nonce};
    await statePut(env,pending);
    let started=false;
    try{started=(await dispatchLookup(env,pending.id,nonce,"mapping",current.host)).ok;}catch{}
    if(!started){
      await statePut(env,current);
      await say(env,send,"🌷 Не удалось запустить проверку. Оценки на сайт не отправлялись.");
      return true;
    }
    await say(env,send,"🔎 Проверяю технические поля Intimcity для анкеты №"+pending.id+
      ".\n\n🌷 Это только диагностика — оценок на сайте не будет.");
    return true;
  }
  const toggle=/^owner_anketa:toggle:(\d+):([a-f0-9]{12})$/.exec(data);
  if(toggle) {
    const i=Number(toggle[1]);
    if(current?.step!=="ratings"||current.nonce!==toggle[2]||!current.catalog[i]) return true;
    const chosen={...(current.selected||{})};
    const options=current.catalog[i].options.filter(v=>v.toLowerCase()!=="не знаю");
    if(chosen[i]!==undefined) delete chosen[i];
    else chosen[i]=options.includes("5")?"5":(options[0]||"");
    const next={...current,selected:chosen};
    await statePut(env,next);
    if(cb?.message?.message_id) {
      try {
        await send(env,"editMessageText",{chat_id:OWNER_ID,message_id:cb.message.message_id,
          text:ratingSummary(next),reply_markup:ratingMenu(next)});
        return true;
      } catch {}
    }
    await say(env,send,ratingSummary(next),ratingMenu(next));
    return true;
  }
  const option=/^owner_anketa:option:(\d+):(\d+):([a-f0-9]{12})$/.exec(data);
  if(option && current?.step==="ratings" && current.nonce===option[3]) {
    const i=Number(option[1]),j=Number(option[2]),value=current.catalog[i]?.options[j];
    if(!value || value.toLowerCase()==="не знаю") return true;
    const next={...current,selected:{...(current.selected||{}),[i]:value}};
    await statePut(env,next);
    try {
      await send(env,"editMessageText",{chat_id:OWNER_ID,message_id:cb.message.message_id,
        text:ratingSummary(next),reply_markup:ratingMenu(next)});
    } catch { await say(env,send,ratingSummary(next),ratingMenu(next)); }
    return true;
  }
  const preview=/^owner_anketa:preview:([a-f0-9]{12})$/.exec(data);
  if(preview && current?.step==="ratings" && preview[1]===current.nonce) {
    const lines=current.catalog.map((f,i)=>"• "+f.label+": "+(current.selected?.[i]??"Не знаю"));
    await say(env,send,"💎 ВАШ ЧЕРНОВИК\n\n"+lines.join("\n")+
      "\n\n🌷 Ничего не опубликовано.",buttons([[{text:"⬅️ К выбору",callback_data:"owner_anketa:criteria:"+current.nonce}],NEW_NUMBER]));
    return true;
  }
  const reset=/^owner_anketa:reset:([a-f0-9]{12})$/.exec(data);
  if(reset&&current?.step==="ratings"&&reset[1]===current.nonce) {
    const next={...current,selected:{}};
    await statePut(env,next);
    await say(env,send,ratingSummary(next),ratingMenu(next));
    return true;
  }
  const chosenCriterion=/^owner_anketa:criterion:(\d+):([a-f0-9]{12})$/.exec(data);
  if(chosenCriterion) {
    const index=Number(chosenCriterion[1]);
    if(current?.step!=="ratings" || current.nonce!==chosenCriterion[2] || !current.catalog[index]) {
      await say(env,send,"⏳ Эти данные уже устарели. Пожалуйста, выберите анкету заново.");
      return true;
    }
    const item=current.catalog[index];
    await say(env,send,"⭐ "+item.label+"\n\n💖 Доступные варианты:\n"+
      item.options.map((v,i)=>(i+1)+". "+v).join("\n")+
      "\n\n🌷 Это информация с сайта. Пока ничего не отправляем.",
      buttons([[{text:"⬅️ К списку оценок",callback_data:"owner_anketa:criteria:"+current.nonce}],NEW_NUMBER]));
    return true;
  }
  if(data.startsWith("owner_anketa:criteria:")) {
    const nonce=data.slice("owner_anketa:criteria:".length);
    if(current?.step!=="ratings" || current.nonce!==nonce) return true;
    await say(env,send,"🌹 Доступные категории оценок для "+current.profile.name+":",
      ratingMenu(current));
    return true;
  }
  const match=/^owner_anketa:(rating|review):([a-f0-9]{12})$/.exec(data);
  if(match) {
    if(!current?.profile?.id || !await selectedAccount(env,current.profile.id) ||
       current.account!==ACTIVE_ACCOUNT){
      if(current?.profile?.id)await showSaved(env,send,current.profile.id);
      else await showLibrary(env,send);
      return true;
    }
    if(current?.step==="ratings" && current.nonce===match[2]) {
      if(match[1]==="rating") await say(env,send,ratingSummary(current),ratingMenu(current));
      else await say(env,send,"✍️ Раздел отзывов пока подготавливается.\n\n💕 Спасибо за терпение!");
      return true;
    }
    if(!current || current.step!=="chosen" || current.nonce!==match[2]) {
      await say(env,send,"⏳ Сначала подтвердите анкету."); return true;
    }
    if(match[1]==="rating") {
      const lookupNonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
      await statePut(env,{step:"ratings_loading",account:ACTIVE_ACCOUNT,id:current.profile.id,nonce:lookupNonce,
        previousNonce:current.nonce,profile:current.profile,host:current.host});
      let launched=false;
      try { launched=(await dispatchLookup(env,current.profile.id,lookupNonce,"ratings",current.host)).ok; } catch {}
      if(!launched) {
        await statePut(env,current);
        await say(env,send,"🌷 Не удалось начать загрузку оценок. Попробуйте ещё раз немного позже.");
        return true;
      }
      await say(env,send,"⏳ Минутку, пожалуйста!\n\n💕 Проверяю доступные категории оценок для анкеты "+current.profile.name+".\n✨ Скоро всё будет готово!");
      return true;
    }
    await say(env,send,"✍️ Раздел отзывов пока подготавливается.\n\n💕 Спасибо за терпение!");
    return true;
  }
  return ownerAction;
}

async function ownerRatingFormApi(request, env, send, verifyTelegram) {
  if (Number(request.headers.get("content-length")||0)>30000) return new Response("Too large",{status:413});
  let input;
  try { input=await request.json(); } catch {return new Response("Invalid JSON",{status:400});}
  if (!await verifyTelegram(input.initData,env.BOT_TOKEN,3600)) return new Response("Forbidden",{status:403});
  let user;
  try {user=JSON.parse(new URLSearchParams(input.initData).get("user")||"null");}catch{}
  if(String(user?.id)!==OWNER_ID) return new Response("Forbidden",{status:403});
  const state=await stateGet(env);
  if(!state || !["ratings","ratings_agreed"].includes(state.step) || state.nonce!==input.key) return Response.json({error:"expired"},{status:409});
  const existingRating=await publicationStatus(env,state.profile?.id,"rating");
  if(existingRating)return Response.json({error:"already_published_or_pending"},{status:409});
  if(state.account!==ACTIVE_ACCOUNT ||
      !await selectedAccount(env,state.profile?.id))
    return Response.json({error:"account_not_selected"},{status:409});
  if(input.action==="load") return Response.json({
    profile:state.profile,selected:state.selected||{},metElsewhere:state.metElsewhere===true,catalog:organizeCatalog(state.catalog).map(x=>({
      label:x.label,group:x.group||"Оценки анкеты",subgroup:x.subgroup||"",
      options:x.options.filter(v=>!/^\s*(?:не знаю|отказано|[1-4])\s*$/i.test(v))
    }))
  },{headers:{"Cache-Control":"no-store"}});
  if(input.action!=="save" || !input.selected || typeof input.selected!=="object" || Array.isArray(input.selected))
    return new Response("Invalid request",{status:400});
  if(input.metElsewhere!==undefined && typeof input.metElsewhere!=="boolean")return new Response("Invalid checkbox",{status:400});
  const metElsewhere=input.metElsewhere===true;
  const safe={};
  const photoIndices=new Set(state.catalog.map((f,i)=>/^(?:isFair|Фото соответствует)$/i.test(String(f.label||"").trim())?i:-1).filter(i=>i>=0));
  for(const [index,value] of Object.entries(input.selected)) {
    if(photoIndices.has(Number(index)) && value!=="Фото соответствует")
      return new Response("Invalid photo value",{status:400});
    if(!/^(0|[1-9]\d{0,2})$/.test(index)) return new Response("Invalid field",{status:400});
    const field=state.catalog[Number(index)];
    if(!field || typeof value!=="string" || !field.options.includes(value) ||
        /^\s*(?:не знаю|отказано|[1-4])\s*$/i.test(value)) return new Response("Invalid choice",{status:400});
    safe[index]=value;
  }
  // The owner-only photo correspondence answer is fixed and never editable.
  for(const i of photoIndices){
    if(!state.catalog[i].options.includes("Фото соответствует"))
      return new Response("Unavailable photo option",{status:409});
    safe[i]="Фото соответствует";
  }
  await statePut(env,{...state,step:"ratings",selected:safe,metElsewhere,draftReady:true,agreedAt:null});
  // Preserve source field order and group headings in the Telegram review.
  const selected=Object.entries(safe).sort((a,b)=>Number(a[0])-Number(b[0]));
  const orderedFields=organizeCatalog(state.catalog);
  const sections=[];
  let lastGroup="";
  let lastSubgroup="";
  for(const [i,v] of selected){
    const field=orderedFields[Number(i)];
    const group=field.group||"Оценки анкеты";
    if(group!==lastGroup){sections.push("\n━━━━━━━━━━━━\n💎 "+group);lastGroup=group;lastSubgroup="";}
    const subgroup=field.subgroup||"";
    if(subgroup && subgroup!==lastSubgroup)sections.push("\n"+subgroup+"\n────────────");
    lastSubgroup=subgroup;
    sections.push(field.label==="Фото соответствует" && v==="Фото соответствует" ? "• Фото соответствует" : "• "+field.label+": "+(v==="5"?"5⭐":v));
  }
  if(metElsewhere)sections.push("\n☑️ Встречался по другой анкете");
  const intro="🌹 ВАШИ ОЦЕНКИ ГОТОВЫ\n\n👤 "+state.profile.name+
    "\n🆔 №"+state.profile.id+"\n";
  const footer="\n🌷 Пожалуйста, проверьте выбор. Это только черновик, оценки на сайт не отправлялись.";
  const textLines=sections.length?sections:["\nПока ничего не выбрано"];
  const pages=[];let page=intro;
  for(const line of textLines){
    if(page.length+line.length+2>3400){pages.push(page);page="🌹 ПРОДОЛЖЕНИЕ ОЦЕНОК\n";}
    page+="\n"+line;
  }
  pages.push(page+footer);
  for(let n=0;n<pages.length;n++){
    await say(env,send,pages[n],n===pages.length-1?buttons([
      [{text:"✅ Согласна",callback_data:"owner_anketa:consent:"+state.nonce}],
      [{text:"✏️ Скорректировать анкету",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/anketa/ratings?key="+state.nonce}}],NEW_NUMBER]):undefined);
  }
  return Response.json({ok:true});
}

async function miniReviewAction(env,profileId,action,text){
 if(!ID_PATTERN.test(String(profileId))||!["submit","status"].includes(action))return {ok:false,reason:"invalid_request"};
 const saved=await savedGet(env,profileId);
 if(!saved?.confirmed)return {ok:false,reason:"not_saved"};
 const receipt=await publicationStatus(env,profileId,"review");
 if(receipt)return {ok:true,stage:receipt.status==="published"?"published":"waiting"};
 const ticketKey=privatePrefix("mini_review_ticket_v1:")+profileId;
 const activeTicket=await env.VISITORS_KV.get(ticketKey,"json");
 if(action==="status"){
  if(!activeTicket?.ticket)return {ok:true,stage:"draft"};
  const record=await env.VISITORS_KV.get("cabinet_review_moderation:"+OWNER_ID+":"+activeTicket.ticket,"json");
  if(record?.status==="cancelled")return {ok:true,stage:"rejected"};
  if(record?.status==="delivery_unknown")return {ok:true,stage:"unknown"};
  return {ok:true,stage:"waiting"};
 }
 if(activeTicket?.ticket){
  const previous=await env.VISITORS_KV.get("cabinet_review_moderation:"+OWNER_ID+":"+activeTicket.ticket,"json");
  if(previous?.status!=="cancelled")return {ok:true,stage:previous?.status==="delivery_unknown"?"unknown":"waiting"};
  await env.VISITORS_KV.delete(ticketKey);
 }
 if(typeof text!=="string"||text.trim().length<10||text.length>3000)return {ok:false,reason:"invalid_text"};
 if(!await selectedAccount(env,profileId))return {ok:false,reason:"account_not_selected"};
 const balance=await credits(env,OWNER_ID,"status").catch(()=>null);
 if(!Number.isSafeInteger(balance?.available)||balance.available<1)return {ok:false,reason:"credits"};
 const draft=await stateGet(env);
 if(draft&&["publishing","review_dispatch","review_recheck","proof_loading","dryfill_loading","review_moderation"].includes(draft.step))return {ok:false,reason:"busy"};
 const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,16);
 const snapshot={step:"review_agreed",id:String(profileId),account:ACTIVE_ACCOUNT,text:text.trim(),nonce,agreedAt:Date.now(),host:saved.host};
 const key="cabinet_review_moderation:"+OWNER_ID+":"+nonce;
 await env.VISITORS_KV.put(key,JSON.stringify({status:"pending",snapshot}));
 // Establish the ticket before delivery, so subsequent requests cannot enqueue another review.
 await env.VISITORS_KV.put(ticketKey,JSON.stringify({ticket:nonce,at:Date.now()}));
 const queued=await moderationRPC(env,OWNER_ID,nonce,{action:"enqueue",profileId:String(profileId),account:ACTIVE_ACCOUNT,text:snapshot.text}).catch(()=>null);
 if(!queued?.ok){await env.VISITORS_KV.put(key,JSON.stringify({status:"delivery_unknown",snapshot}));return {ok:true,stage:"unknown"};}
 await statePut(env,{...snapshot,step:"review_moderation",moderationTicket:nonce});
 return {ok:true,stage:"waiting"};
}
async function miniReviewDraft(env,profileId,action,text){
 if(!ID_PATTERN.test(String(profileId)))return {ok:false,reason:"invalid_profile"};
 const record=await savedGet(env,profileId);
 if(!record?.confirmed||String(record.profile?.id)!==String(profileId))return {ok:false,reason:"not_saved"};
 if(await publicationStatus(env,profileId,"review"))return {ok:false,reason:"already_published_or_pending"};
 if(action==="load"){
  const draft=await reviewDraftGet(env,profileId);
  return {ok:true,text:draft?.text||"",savedAt:draft?.savedAt||null};
 }
 if(action!=="save"||typeof text!=="string"||text.length<10||text.length>3000)return {ok:false,reason:"invalid_text"};
 const current=await stateGet(env);
 if(current&&["publishing","review_dispatch","review_recheck","proof_loading","dryfill_loading","review_moderation"].includes(current.step))
  return {ok:false,reason:"busy"};
 await reviewDraftSave(env,{id:String(profileId),account:ACTIVE_ACCOUNT,text});
 return {ok:true,text,saved:true};
}
async function miniRatingOpen(env,profileId){
 if(!ID_PATTERN.test(String(profileId)))return {ok:false,reason:"invalid_profile"};
 const record=await savedGet(env,profileId);
 if(!record?.confirmed||String(record.profile?.id)!==String(profileId))return {ok:false,reason:"not_saved"};
 if(await publicationStatus(env,profileId,"rating"))return {ok:false,reason:"already_published_or_pending"};
 const balance=await credits(env,OWNER_ID,"status").catch(()=>null);
 if(!Number.isSafeInteger(balance?.available)||balance.available<=0)return {ok:false,reason:"credits"};
 const day=await dailyLimit(env,OWNER_ID,profileId,"status","rating").catch(()=>null);
 if(!Number.isSafeInteger(day?.remaining)||day.remaining<=0)return {ok:false,reason:"daily_limit"};
 const current=await stateGet(env);
 if(current?.step==="ratings_loading"&&String(current.profile?.id||current.id)===String(profileId)&&current.account===ACTIVE_ACCOUNT)
  return {ok:true,stage:"loading"};
 if(current&&["publishing","review_dispatch","review_recheck","proof_loading","dryfill_loading","audit_loading","ratings_loading"].includes(current.step))
  return {ok:false,reason:"busy"};
 if(current&&["ratings","ratings_agreed"].includes(current.step)&&String(current.profile?.id)===String(profileId)&&
   current.account===ACTIVE_ACCOUNT&&Array.isArray(current.catalog)&&current.catalog.length>0&&current.catalog.length<=120){
  await chooseAccount(env,profileId);
  return miniRatingFormLoad(env,profileId);
 }
 const catalog=Array.isArray(record.catalog)?organizeCatalog(record.catalog):[];
 if(!catalog.length||catalog.length>120){
  if(!await chooseAccount(env,profileId))return {ok:false,reason:"unavailable"};
  const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  const pending={step:"ratings_loading",account:ACTIVE_ACCOUNT,id:String(profileId),profile:record.profile,host:record.host,nonce};
  if(!await statePut(env,pending))return {ok:false,reason:"unavailable"};
  const started=await dispatchLookup(env,profileId,nonce,"ratings",record.host).catch(()=>({ok:false}));
  if(!started.ok){await statePut(env,{step:"chosen",account:ACTIVE_ACCOUNT,profile:record.profile,host:record.host,nonce});return {ok:false,reason:"lookup_failed"};}
  return {ok:true,stage:"loading"};
 }
 if(!await chooseAccount(env,profileId))return {ok:false,reason:"unavailable"};
 const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
 const draft=await ratingDraftGet(env,profileId,record.host,catalog);
 await statePut(env,{step:"ratings",account:ACTIVE_ACCOUNT,id:String(profileId),profile:record.profile,host:record.host,catalog,nonce,selected:draft.selected||{},metElsewhere:draft.metElsewhere===true,draftReady:draft.draftReady===true});
 return miniRatingFormLoad(env,profileId);
}
async function miniRatingFormLoad(env,profileId){
 if(!ID_PATTERN.test(String(profileId)))return {ok:false,reason:"invalid_profile"};
 const state=await stateGet(env);
 if(!state||!["ratings","ratings_agreed"].includes(state.step)||String(state.profile?.id)!==String(profileId))
  return {ok:false,reason:"not_ready"};
 if(!await savedGet(env,profileId))return {ok:false,reason:"not_saved"};
 if(await publicationStatus(env,profileId,"rating"))return {ok:false,reason:"already_published_or_pending"};
 if(state.account!==ACTIVE_ACCOUNT||!await selectedAccount(env,profileId))
  return {ok:false,reason:"account_not_selected"};
 if(!Array.isArray(state.catalog)||state.catalog.length>120)return {ok:false,reason:"unavailable"};
 const isIndieField=field=>/реальн\S*\s+инди/i.test(String(field?.label||""));
 const catalog=organizeCatalog(state.catalog).map(field=>({
  label:String(field.label||"").slice(0,110),
  group:String(field.group||"Оценки анкеты").slice(0,90),
  subgroup:String(field.subgroup||"").slice(0,90),
  options:field.options.filter(value=>typeof value==="string"&&!/^\s*(?:не знаю|отказано|[1-4])\s*$/i.test(value)&&(!isIndieField(field)||/^(?:\s*да\s*|\s*реальная\s+инди\s*)$/i.test(value))).map(value=>value.slice(0,100))
 }));
 return {ok:true,profile:{id:state.profile.id,name:state.profile.name},catalog,
  selected:state.selected||{},metElsewhere:state.metElsewhere===true};
}
async function miniRatingAction(env,profileId,action){
 if(!ID_PATTERN.test(String(profileId))||!["prepare","status","publish"].includes(action))return {ok:false,reason:"invalid_request"};
 const state=await stateGet(env);
 if(!state||String(state.profile?.id||state.id)!==String(profileId)||state.account!==ACTIVE_ACCOUNT)
  return {ok:false,reason:"not_ready"};
 const prior=await publicationStatus(env,profileId,"rating");
 if(prior)return {ok:true,stage:prior.status==="published"?"published":"checking"};
 if(action==="status"){
  return {ok:true,stage:state.step==="prepublish_ready"&&Date.now()-Number(state.readyAt||0)<900000?"ready":
    state.step==="prepublish_ready"?"expired":state.step==="dryfill_loading"?"preparing":
    state.step==="publishing"?"publishing":state.step==="ratings_agreed"?"failed":
    state.step==="ratings"?"draft":"checking"};
 }
 if(action==="prepare"){
  if(state.step==="dryfill_loading")return {ok:true,stage:"preparing"};
  if(state.step==="prepublish_ready"&&Date.now()-Number(state.readyAt||0)<900000)return {ok:true,stage:"ready"};
  if(!["ratings","ratings_agreed"].includes(state.step)||!state.draftReady||!Object.keys(state.selected||{}).length)return {ok:false,reason:"not_ready"};
  if(!await selectedAccount(env,profileId))return {ok:false,reason:"account_not_selected"};
  const approved={...state,step:"ratings_agreed",agreedAt:Date.now()};
  const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  const pending={...approved,step:"dryfill_loading",id:String(profileId),previousNonce:state.nonce,nonce,prepublish:true};
  if(!await statePut(env,pending))return {ok:false,reason:"unavailable"};
  const started=await dispatchLookup(env,profileId,nonce,"dryfill",state.host).catch(()=>({ok:false}));
  if(!started.ok){await statePut(env,{...approved,step:"ratings_agreed"});return {ok:false,reason:"dispatch_failed"};}
  return {ok:true,stage:"preparing"};
 }
 if(state.step!=="prepublish_ready"||!state.readyAt||Date.now()-state.readyAt>900000)return {ok:false,reason:"expired"};
 if(!await selectedAccount(env,profileId))return {ok:false,reason:"account_not_selected"};
 const balance=await credits(env,OWNER_ID,"status").catch(()=>null);
 if(!Number.isSafeInteger(balance?.available)||balance.available<1)return {ok:false,reason:"credits"};
 const day=moscowDay(),token=state.nonce;
 let reservedDay=false,reservedCredit=false,claimed=false;
 try{
  const slot=await dailyLimit(env,OWNER_ID,profileId,"reserve","rating",token,day);
  if(!slot?.ok)return {ok:false,reason:"daily_limit"};reservedDay=true;
  const cr=await credits(env,OWNER_ID,"reserve","rating",profileId,token);
  if(!cr?.ok)return {ok:false,reason:"credits"};reservedCredit=true;
  const claim=await claimPublication(env,OWNER_ID,profileId,"rating",token);
  if(!claim?.ok)return {ok:false,reason:"already_published_or_pending"};
  claimed=true;
  if(!await recordPublication(env,profileId,"rating","publishing","mini-app-confirmation",{userId:OWNER_ID,creditNonce:token,dailyDate:day}))
   return {ok:false,reason:"already_published_or_pending"};
  const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  const pending={...state,step:"publishing",id:String(profileId),creditNonce:token,dailyDate:day,
   nonce,previousNonce:token,readyAt:null,confirmedAt:Date.now(),dispatchPending:true};
  if(!await statePut(env,pending))return {ok:false,reason:"state_failure"};
  const dispatch=await dispatchLookup(env,profileId,nonce,"publish",state.host).catch(()=>null);
  if(dispatch?.definitiveFailure)await releaseUnsubmitted(env,profileId,"rating",token,day);
  return {ok:true,stage:"publishing"};
 }finally{
  // Never release a claim after an ambiguous external dispatch or publication start.
  if(!claimed){
   if(reservedCredit)await credits(env,OWNER_ID,"release","rating",profileId,token).catch(()=>{});
   if(reservedDay)await dailyLimit(env,OWNER_ID,profileId,"release","rating",token,day).catch(()=>{});
  }
 }
}
async function miniRatingDraftSave(env,profileId,selected,metElsewhere){
 const gate=await miniRatingFormLoad(env,profileId);
 if(!gate.ok)return gate;
 const state=await stateGet(env);
 if(state.step!=="ratings")return {ok:false,reason:"not_ready"};
 if(!selected||typeof selected!=="object"||Array.isArray(selected)||typeof metElsewhere!=="boolean")return {ok:false,reason:"invalid_choice"};
 const safe={};
 for(const [index,value] of Object.entries(selected)){
  if(!/^(0|[1-9]\d{0,2})$/.test(index)||typeof value!=="string")return {ok:false,reason:"invalid_choice"};
  const field=state.catalog[Number(index)];
  if(!field||!Array.isArray(field.options)||!field.options.includes(value)||/^\s*(?:не знаю|отказано|[1-4])\s*$/i.test(value))return {ok:false,reason:"invalid_choice"};
  if(/реальн\S*\s+инди/i.test(String(field.label||""))&&!/^(?:\s*да\s*|\s*реальная\s+инди\s*)$/i.test(value))return {ok:false,reason:"invalid_choice"};
  if(/^(?:isFair|Фото соответствует)$/i.test(String(field.label||"").trim())&&value!=="Фото соответствует")return {ok:false,reason:"invalid_choice"};
  safe[index]=value;
 }
 for(let i=0;i<state.catalog.length;i++){
  const field=state.catalog[i];
  if(/^(?:isFair|Фото соответствует)$/i.test(String(field.label||"").trim())){
   if(!field.options.includes("Фото соответствует"))return {ok:false,reason:"unavailable"};
   safe[i]="Фото соответствует";
  }
 }
 await statePut(env,{...state,step:"ratings",selected:safe,metElsewhere,draftReady:true,agreedAt:null});
 return {ok:true,selected:safe,metElsewhere};
}
async function miniDeleteProfile(env,id){
 if(!ID_PATTERN.test(String(id)))return {ok:false,reason:"invalid"};
 if(!await savedGet(env,id))return {ok:false,reason:"not_found"};
 await savedDelete(env,id);
 const active=await stateGet(env);
 if(String(active?.profile?.id||active?.id)===String(id)&&!["publishing","review_dispatch","review_recheck","proof_loading"].includes(active.step))
  await env.VISITORS_KV.delete(PREFIX+OWNER_ID);
 return {ok:true};
}
async function miniAddProfile(input) {
 const action=String(input?.action||"");
 if(action==="start"){
  const link=parseProfileLink(input.url);
  if(!link)return {ok:false,reason:"invalid_link"};
  const existing=await savedGet(input.env,link.id);
  if(existing?.confirmed&&existing.profile?.url===`https://${link.host}/indi/anketa${link.id}.htm`)
   return {ok:true,stage:"saved",profile:existing.profile};
  const pending=await stateGet(input.env);
  if(pending&&["publishing","review_dispatch","review_recheck","proof_loading"].includes(pending.step))
   return {ok:false,reason:"busy"};
  const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  if(!await statePut(input.env,{step:"loading",source:"mini_app",id:link.id,host:link.host,nonce}))return {ok:false,reason:"unavailable"};
  const started=await dispatchLookup(input.env,link.id,nonce,"profile",link.host).catch(()=>({ok:false}));
  if(!started.ok){await statePut(input.env,{step:"number"});return {ok:false,reason:"lookup_failed"};}
  return {ok:true,stage:"loading",id:link.id};
 }
 if(action==="status"){
  const state=await stateGet(input.env);
  if(state?.step==="confirm"&&state.profile&&state.nonce)
   return {ok:true,stage:"confirm",profile:state.profile,nonce:state.nonce};
  if(state?.step==="loading"&&state.source==="mini_app")return {ok:true,stage:"loading",id:state.id};
  if(state?.step==="mini_lookup_failed")return {ok:true,stage:"failed",reason:state.reason};
  if(state?.step==="chosen"&&state.profile)return {ok:true,stage:"saved",profile:state.profile};
  return {ok:true,stage:"idle"};
 }
 if(action==="confirm"){
  const current=await stateGet(input.env);
  if(current?.step!=="confirm"||current.source!=="mini_app"||current.nonce!==input.nonce||!current.profile)
   return {ok:false,reason:"stale"};
  const prior=await savedGet(input.env,current.profile.id);
  if(!await savedPut(input.env,{profile:current.profile,host:current.host,catalog:prior?.host===current.host?prior.catalog||[]:[]}))
   return {ok:false,reason:"unavailable"};
  await statePut(input.env,{step:"chosen",profile:current.profile,host:current.host,nonce:current.nonce});
  return {ok:true,stage:"saved",profile:current.profile};
 }
 return {ok:false,reason:"invalid_action"};
}
return {miniReviewAction,miniReviewDraft,miniRatingAction,miniRatingOpen,miniRatingDraftSave,miniRatingFormLoad,miniAddProfile,miniDeleteProfile,moderateReview,ownerAllowed,ownerDryfillPayload,ownerReviewStage,ownerReviewPayload,thumbnailUrl,serveProfileThumbnail,handleAnketaLookupResult,handleOwnerAnketa,ownerRatingFormApi,showExhaustedCabinet};
}
const ownerCabinet=createCabinet();
export const ownerAllowed = (...args) => ownerCabinet.ownerAllowed(...args);
export const ownerDryfillPayload = (...args) => ownerCabinet.ownerDryfillPayload(...args);
export const ownerReviewStage = (...args) => ownerCabinet.ownerReviewStage(...args);
export const ownerReviewPayload = (...args) => ownerCabinet.ownerReviewPayload(...args);
export const thumbnailUrl = (...args) => ownerCabinet.thumbnailUrl(...args);
export const serveProfileThumbnail = (...args) => ownerCabinet.serveProfileThumbnail(...args);
export const handleAnketaLookupResult = (...args) => ownerCabinet.handleAnketaLookupResult(...args);
export const handleOwnerAnketa = (...args) => ownerCabinet.handleOwnerAnketa(...args);
export const ownerRatingFormApi = (...args) => ownerCabinet.ownerRatingFormApi(...args);
