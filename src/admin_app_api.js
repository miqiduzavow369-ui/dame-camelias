// Dedicated ADMIN Mini App API adapter. Existing owner and client flows are untouched.
// Only server-verified Telegram owner can use these routes.
import {validWebApp} from "./telegram_auth.js";
import {registry,OWNER_ID,validId,pinRecord} from "./client_registry.js";
import {credits,adjustCredits,creditHistory} from "./publication_credits.js";
import {cabinetRPC} from "./cabinet_runtime.js";
import {agreementStatus} from "./agreement.js";
import {moderationHistory} from "./review_moderation.js";

const safeHeaders={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const respond=(value,status=200)=>Response.json(value,{status,headers:safeHeaders});
const bad=(reason,status=400)=>respond({ok:false,reason},status);
const validOp=x=>typeof x==="string"&&/^[a-f0-9]{16}$/.test(x);
const validAmount=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000;
async function readBody(request){
 if(Number(request.headers.get("content-length")||0)>16000)return null;
 try{const input=await request.json();return input&&typeof input==="object"&&!Array.isArray(input)?input:null;}catch{return null;}
}
async function authenticatedOwner(input,env){
 if(!await validWebApp(input?.initData,env.BOT_TOKEN,900))return false;
 try{return String(JSON.parse(new URLSearchParams(input.initData).get("user"))?.id||"")===OWNER_ID;}catch{return false;}
}
// ADMIN-only read: Telegram getChat provides a username only when the bot can access the chat.
const usernameCache=new Map();
async function telegramUsername(env,uid){
 const now=Date.now(),existing=usernameCache.get(uid);
 if(existing&&existing.until>now)return existing.value;
 let value=null;
 try{
  const response=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/getChat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:uid}),signal:AbortSignal.timeout(4500)});
  const body=await response.json();
  const raw=body?.ok&&String(body.result?.id)===uid?body.result.username:null;
  if(typeof raw==="string"&&/^[A-Za-z0-9_]{5,32}$/.test(raw))value=raw;
 }catch{}
 usernameCache.set(uid,{value,until:now+(value?15*60_000:2*60_000)});
 return value;
}
async function enrichClient(env,client,balance){
 return {...summarize(client,balance),username:await telegramUsername(env,String(client.id))};
}
function summarize(client,balance){
 return {id:String(client.id),username:null,active:client.active===true,
  available:balance.available,spent:balance.spent,reserved:balance.reserved,
  grant:client.grant,revision:client.revision};
}
export async function handleAdminApi(request,env){
 if(request.method!=="POST")return bad("method_not_allowed",405);
 const body=await readBody(request);
 if(!body)return bad("invalid_request");
 if(!await authenticatedOwner(body,env))return bad("forbidden",403);
 const action=String(body.action||"");
 const uid=String(body.userId||"");
 try{
  if(action==="clients"){
   const result=await registry(env,{action:"list",actorId:OWNER_ID});
   if(!result.ok)return bad("registry_unavailable",503);
   // Use the same credit ledger for both old and new ADMIN.
   // Bounded Telegram lookups avoid flooding getChat for large client lists.
   const entries=[];
   for(let i=0;i<result.clients.length;i+=6){
    const batch=await Promise.all(result.clients.slice(i,i+6).map(async client=>{
     try{return await enrichClient(env,client,await credits(env,client.id,"status"));}
     catch{return {...client,username:null,financeUnavailable:true};}
    }));
    entries.push(...batch);
   }
   return respond({ok:true,clients:entries});
  }
  if(action==="review_history"){
   const listed=await registry(env,{action:"list",actorId:OWNER_ID});
   if(!listed?.ok)return bad("registry_unavailable",503);
   const clients=listed.clients||[];
   // Reuse the exact same read-only archive as existing ADMIN; no new journal or moderation writes.
   const outcomes=await Promise.all(clients.map(async client=>{
    const userId=String(client.id);
    try{
     const result=await cabinetRPC(env,userId,{kind:"admin_archive",actorId:OWNER_ID});
     if(result?.status!==200)throw Error("archive_unavailable");
     const items=(result.archive?.items||[]).filter(x=>x.kind==="review").map(x=>({
      userId,profileId:String(x.profileId),account:x.account,
      kind:"review",date:x.date,at:x.at||null,proof:!!x.fileId
     }));
     return {ok:true,items};
    }catch{return {ok:false,items:[]};}
   }));
   const archived=outcomes.flatMap(x=>x.items).map(x=>({...x,status:"published",text:null,corrected:false}));
   let decisions=[],journalUnavailable=false;
   try{
    const history=await moderationHistory(env);
    if(!history?.ok)throw Error("history_unavailable");
    decisions=history.items||[];
   }catch{journalUnavailable=true;}
   const results=new Map();
   // Archive entries stay visible, including legacy publications before the journal existed.
   for(const item of archived)results.set("archive:"+item.userId+":"+item.profileId+":"+item.account,item);
   for(const decision of decisions){
    const matching=archived.find(item=>item.userId===decision.userId&&item.profileId===decision.profileId&&item.account===decision.account);
    const key=matching?"archive:"+matching.userId+":"+matching.profileId+":"+matching.account:"decision:"+decision.userId+":"+decision.ticket;
    results.set(key,{...matching,...decision,proof:matching?.proof||false,date:matching?.date||null,at:matching?.at||null,
     status:matching? "published":decision.status});
   }
   const items=[...results.values()].sort((a,b)=>Number(b.decidedAt||b.publishedAt||b.at||0)-Number(a.decidedAt||a.publishedAt||a.at||0));
   return respond({ok:true,items,partial:outcomes.some(x=>!x.ok)||journalUnavailable,source:"moderation_decisions_and_publication_archive"});
  }
  if(!validId(uid)||uid===OWNER_ID)return bad("invalid_client_id");
  if(action==="client"){
   const {client}=await registry(env,{action:"get",userId:uid});
   if(!client)return bad("missing",404);
   const [balance,agreement]=await Promise.all([credits(env,uid,"status"),agreementStatus(env,uid)]);
   return respond({ok:true,client:{...await enrichClient(env,client,balance),agreement}});
  }
  if(action==="archive_proof"){
   const profileId=String(body.profileId||""),account=String(body.account||""),kind=String(body.kind||"");
   if(!/^\d{1,9}$/.test(profileId)||!/^[a-z][a-z0-9_]{0,11}$/.test(account)||!["rating","review"].includes(kind))return bad("invalid_proof");
   const {client}=await registry(env,{action:"get",userId:uid});
   if(!client)return bad("missing",404);
   const archive=await cabinetRPC(env,uid,{kind:"admin_archive",actorId:OWNER_ID});
   if(archive.status!==200)return bad("archive_unavailable",503);
   const item=archive.archive?.items?.find(x=>String(x.profileId)===profileId&&x.account===account&&x.kind===kind&&x.fileId);
   if(!item)return bad("proof_missing",404);
   // Telegram stores image messages under photos/, and image documents under documents/.
   // The provider can return application/octet-stream even when the body is an image.
   const info=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/getFile?file_id="+encodeURIComponent(item.fileId),{signal:AbortSignal.timeout(10000)});
   const infoJson=await info.json().catch(()=>null);
   const filePath=infoJson?.result?.file_path;
   if(!info.ok||!infoJson?.ok||typeof filePath!=="string"||!new RegExp("^(photos|documents)/[A-Za-z0-9_./-]{1,240}$").test(filePath)||filePath.includes(".."))return bad("telegram_file_unavailable",502);
   const photo=await fetch("https://api.telegram.org/file/bot"+env.BOT_TOKEN+"/"+filePath,{signal:AbortSignal.timeout(12000)});
   if(!photo.ok)return bad("telegram_image_unavailable",502);
   const bytes=await photo.arrayBuffer();
   if(bytes.byteLength===0||bytes.byteLength>10*1024*1024)return bad("invalid_image_size",502);
   const first=new Uint8Array(bytes.slice(0,16));
   const jpeg=first[0]===0xff&&first[1]===0xd8&&first[2]===0xff;
   const png=first[0]===0x89&&first[1]===0x50&&first[2]===0x4e&&first[3]===0x47;
   const webp=String.fromCharCode(...first.slice(0,4))==="RIFF"&&String.fromCharCode(...first.slice(8,12))==="WEBP";
   const gif=String.fromCharCode(...first.slice(0,3))==="GIF";
   const mime=jpeg?"image/jpeg":png?"image/png":webp?"image/webp":gif?"image/gif":null;
   if(!mime)return bad("image_format_unavailable",502);
   return new Response(bytes,{headers:{...safeHeaders,"Content-Type":mime,"Content-Disposition":"inline; filename=proof."+mime.slice(6),"Content-Security-Policy":"default-src 'none'; sandbox"}});
  }
  if(action==="archive"){
   const {client}=await registry(env,{action:"get",userId:uid});
   if(!client)return bad("missing",404);
   const archive=await cabinetRPC(env,uid,{kind:"admin_archive",actorId:OWNER_ID});
   if(archive.status!==200)return bad("archive_unavailable",503);
   // Current archive contains Telegram photo file IDs. Never expose to other users.
   return respond({ok:true,archive:archive.archive});
  }
  if(action==="credit_history"){
   const {client}=await registry(env,{action:"get",userId:uid});
   if(!client)return bad("missing",404);
   return respond({ok:true,history:await creditHistory(env,uid)});
  }
  if(!["create","topup","balance","suspend","resume","pin"].includes(action))return bad("unknown_action");
  if(!validOp(body.operation))return bad("invalid_operation");
  const mutation={action,actorId:OWNER_ID,userId:uid,operation:body.operation};
  if(action==="create"){
   if(!validAmount(body.grant)||!/^\d{6,12}$/.test(String(body.pin||"")))return bad("invalid_values");
   mutation.grant=body.grant;mutation.credential=await pinRecord(body.pin);
  }else if(action==="topup"){
   if(!validAmount(body.amount)||body.amount===0)return bad("invalid_amount");
   mutation.amount=body.amount;
  }else if(action==="pin"){
   if(!/^\d{6,12}$/.test(String(body.pin||"")))return bad("invalid_pin");
   mutation.credential=await pinRecord(body.pin);
  }else if(action==="balance"){
   if(!validAmount(body.target)||!validAmount(body.expected))return bad("invalid_balance");
   // Atomic CAS in existing credit ledger; concurrent old ADMIN mutations are protected.
   const result=await adjustCredits(env,uid,body.target,body.expected,body.operation,OWNER_ID);
   return respond(result,result.ok?200:409);
  }
  const result=await registry(env,mutation);
  return respond(result,result.ok?200:409);
 }catch{
  // Avoid leaking private errors and credentials to browser.
  return bad("operation_unavailable",503);
 }
}
