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
  if(action==="secondary_review_preview"||action==="secondary_review_approve"){
   if(!validId(uid)||!body.accountId||!/^\d{1,9}$/.test(String(body.profileId||"")))
    return bad("invalid_review_target");
   const result=await cabinetRPC(env,uid,{
    kind:action==="secondary_review_preview"?
      "admin_secondary_review_preview":"admin_secondary_review_approve",
    actorId:OWNER_ID,accountId:body.accountId,
    profileId:String(body.profileId),draftVersion:body.draftVersion,
    expectedTextSha256:body.expectedTextSha256,
    confirmExactText:body.confirmExactText===true
   });
   return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="man_check_status"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_check_status",actorId:OWNER_ID,accountId:body.accountId});
   return respond(result,result?.ok?200:result?.status===403?403:400);
  }
  if(action==="man_check_retry"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_check_retry",actorId:OWNER_ID,
     accountId:body.accountId,expectedVersion:body.expectedVersion});
   return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="man_site_login_status"||action==="man_site_login_start"){
   const r=await cabinetRPC(env,OWNER_ID,{kind:action==="man_site_login_status"?
     "admin_man_site_login_status":"admin_man_site_login_start",actorId:OWNER_ID,
     accountId:body.accountId,expectedVersion:body.expectedVersion,retry:body.retry===true});
   return respond(r,r?.ok?200:r?.status===403?403:409);
  }
  if(action==="man_site_status"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_site_status",actorId:OWNER_ID,accountId:body.accountId});
   return respond(result,result?.ok?200:result?.status===403?403:400);
  }
  if(action==="man_site_domain_update"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_site_domain_update",actorId:OWNER_ID,
     accountId:body.accountId,expectedVersion:body.expectedVersion});
   return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="man_site_stage"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_site_stage",actorId:OWNER_ID,
      accountId:body.accountId,expectedVersion:body.expectedVersion,settings:body.settings});
   return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="man_site_save"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_site_save",actorId:OWNER_ID,
     accountId:body.accountId,expectedVersion:body.expectedVersion,settings:body.settings});
   return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="man_private_status"){
    const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_private_status",actorId:OWNER_ID,accountId:body.accountId});
    return respond(result,result?.ok?200:result?.status===403?403:400);
  }
  if(action==="man_private_save"){
    const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_private_save",actorId:OWNER_ID,
      accountId:body.accountId,settings:body.settings,expectedVersion:body.expectedVersion});
    return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="man_private_import"){
    const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_private_import",actorId:OWNER_ID,rows:body.rows});
    return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="man_site_reachability"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_site_reachability",actorId:OWNER_ID,
     accountId:body.accountId,expectedVersion:body.expectedVersion,siteUrl:body.siteUrl,retry:body.retry===true});
   return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="man_proxy_verify"){
    const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_proxy_verify",actorId:OWNER_ID,
      accountId:body.accountId,expectedVersion:body.expectedVersion});
    return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="man_browser_status"){
 const r=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_browser_status",actorId:OWNER_ID,accountId:body.accountId});
 return respond(r,r?.ok?200:409);
 }
  if(action==="man_browser_start"){
 const r=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_browser_start",actorId:OWNER_ID,accountId:body.accountId,expectedVersion:body.expectedVersion,siteUrl:body.siteUrl});
 return respond(r,r?.ok?200:409);
 }
  if(action==="man_proxy_status"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_proxy_status",actorId:OWNER_ID,accountId:body.accountId});
   return respond(result,result?.ok?200:result?.status===403?403:400);
  }
  if(action==="man_proxy_save"){
   // Only owner-signed Mini App requests reach this action; no credentials returned.
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_proxy_save",actorId:OWNER_ID,
     accountId:body.accountId,expectedVersion:body.expectedVersion,settings:body.settings});
   return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="secondary_rating_readiness"){
    // Valid Telegram owner signature is required above; never allow an
    // unauthenticated client to infer account configuration or grant publication.
    const result=await cabinetRPC(env,OWNER_ID,{
      kind:"admin_secondary_rating_readiness",actorId:OWNER_ID,accountId:body.accountId
    });
    return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="secondary_man_approval_status"||action==="secondary_man_approval_set"){
   const result=await cabinetRPC(env,OWNER_ID,{
     kind:"admin_secondary_man_approval",actorId:OWNER_ID,
     action:action==="secondary_man_approval_set"?"set":"status",
     accountId:body.accountId,expectedVersion:body.expectedVersion,
     approved:body.approved
   });
   return respond(result,result?.ok?200:result?.status===403?403:result?.status===400?400:409);
  }
  if(action==="man_visibility_set"||action==="man_visibility_status"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_visibility",actorId:OWNER_ID,
    action:action==="man_visibility_set"?"set":"status",accountId:body.accountId,
    visible:body.visible,expectedVersion:body.expectedVersion});
   return respond(result,result?.ok?200:result?.status===403?403:result?.status===400?400:409);
  }
  if(action==="secondary_profile_probe_start"||action==="secondary_profile_probe_status"){
   const result=await cabinetRPC(env,OWNER_ID,{
    kind:"admin_secondary_profile_probe",actorId:OWNER_ID,
    action:action==="secondary_profile_probe_start"?"start":"status",
    accountId:body.accountId,profileId:body.profileId
   });
   return respond(result,result?.ok?200:result?.status===403?403:409);
  }
  if(action==="man_accounts"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_registry",actorId:OWNER_ID});
   return respond(result,result?.ok?200:result?.status===403?403:503);
  }
  if(action==="man_setup_history"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_setup_history",actorId:OWNER_ID,accountId:body.accountId});
   return respond(result,result?.ok?200:result?.status===403?403:400);
  }
  if(action==="man_setup_draft"){
   const result=await cabinetRPC(env,OWNER_ID,{kind:"admin_man_setup_draft",
     actorId:OWNER_ID,accountId:body.accountId,
     expectedVersion:body.expectedVersion,setupAction:body.setupAction});
   return respond(result,result?.ok?200:result?.status===403?403:409);
  }
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
  if(action==="visitor_seen"){
   // An explicit owner click marks a new visitor as viewed. Bot activity is not modified.
   if(!env.VISITORS_KV)return bad("visitors_unavailable",503);
   if(!/^[1-9]\d{4,15}$/.test(uid))return bad("invalid_visitor");
   const first=await env.VISITORS_KV.get("first:"+uid,"json");
   if(!first)return bad("visitor_not_found",404);
   await env.VISITORS_KV.put("admin_visitor_seen_v1:"+uid,String(Date.now()));
   return respond({ok:true});
  }
  if(action==="visitors"){
   // Read-only visitor timeline from the existing bot activity keys; no new tracking or messages.
   if(!env.VISITORS_KV)return bad("visitors_unavailable",503);
   const now=Date.now(),msDay=86400000,slots=[];
   for(let d=0;d<7;d++){
    const day=new Date(now+3*3600000-d*msDay).toISOString().slice(0,10);
    for(const hour of ["10","16","22"])slots.push(day+"_"+hour);
   }
   // 22:00–10:00 is stored under the following day's 10:00 slot.
   slots.push(new Date(now+3*3600000+msDay).toISOString().slice(0,10)+"_10");
   const unique=new Map(),names=[];let partial=false;
   for(let offset=0;offset<slots.length;offset+=4){
    const pages=await Promise.all(slots.slice(offset,offset+4).map(async slot=>{
     try{
      const page=await env.VISITORS_KV.list({prefix:"visit:"+slot+":",limit:250});
      return {keys:page.keys||[],complete:page.list_complete!==false};
     }catch{return {keys:[],complete:false};}
    }));
    for(const page of pages){
     if(!page.complete)partial=true;
     for(const key of page.keys){
      if(names.length>=500){partial=true;break;}
      names.push(key.name);
     }
    }
    if(names.length>=500)break;
   }
   // Read in bounded parallel groups to avoid a slow sequential KV waterfall.
   for(let offset=0;offset<names.length;offset+=20){
    const batch=await Promise.all(names.slice(offset,offset+20).map(name=>env.VISITORS_KV.get(name,"json").catch(()=>null)));
    for(const item of batch){
     if(!item||!/^[1-9]\d{4,15}$/.test(String(item.id||"")))continue;
     const id=String(item.id),at=Date.parse(item.visitedAt||"");
     if(!Number.isFinite(at)||at<now-7*msDay||at>now+60000)continue;
     const previous=unique.get(id);
     if(previous&&Date.parse(previous.lastAt)>=at)continue;
     unique.set(id,{id,username:String(item.username||"").slice(0,32),
      name:String(item.name||"").slice(0,100),firstSeen:item.firstSeen||null,
      lastAt:item.visitedAt,interests:Array.isArray(item.interests)?item.interests.slice(0,8):[]});
    }
   }
   const visitors=[...unique.values()].map(x=>({...x,isNew:Number.isFinite(Date.parse(x.firstSeen))&&Math.abs(Date.parse(x.lastAt)-Date.parse(x.firstSeen))<60000})).sort((a,b)=>Date.parse(b.lastAt)-Date.parse(a.lastAt));
   // Viewing is stable across ADMIN sessions and not reset by another bot visit.
   for(let i=0;i<visitors.length;i+=25){
    await Promise.all(visitors.slice(i,i+25).map(async x=>{
     x.unread=x.isNew&&!(await env.VISITORS_KV.get("admin_visitor_seen_v1:"+x.id).catch(()=>null));
    }));
   }
   return respond({ok:true,visitors,partial,periodDays:7});
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
  if(action==="secondary_operation_status"){
   if(!validId(uid)||uid===OWNER_ID)return bad("invalid_client_id");
   if(typeof body.accountId!=="string"||!/^yan_(?:second|0[3-9]|[12][0-9]|30)$/.test(body.accountId)||
      !/^\d{1,9}$/.test(String(body.profileId||""))||
      !["rating","review"].includes(body.kind)||
      !/^[a-f0-9]{12}$/.test(String(body.nonce||"")))return bad("invalid_operation_identity");
   const {client}=await registry(env,{action:"get",userId:uid});
   if(!client)return bad("missing",404);
   const result=await cabinetRPC(env,uid,{
    kind:"admin_secondary_operation_status",actorId:OWNER_ID,
    accountId:body.accountId,profileId:String(body.profileId),
    publicationKind:body.kind,nonce:body.nonce
   });
   return respond(result,result?.ok?200:result?.status===403?403:409);
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

