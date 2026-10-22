// Read-only view over existing client archives. No ledger or publication calls.
const OWNER="5866034656";
const validProfile=id=>/^\d{1,9}$/.test(String(id));
const validAccount=id=>/^[a-z][a-z0-9_]{0,11}$/.test(String(id));
const parse=value=>{try{return typeof value==="string"?JSON.parse(value):value;}catch{return null;}};
const moscowDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"});
function timestamp(value){
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T/.test(value))return null;
 const ms=Date.parse(value);return Number.isFinite(ms)?ms:null;
}
function day(ms){const parts=Object.fromEntries(moscowDate.formatToParts(new Date(ms)).map(p=>[p.type,p.value]));return parts.year+parts.month+parts.day;}
function dated(record,archive){
 const ms=timestamp(record?.at)??timestamp(archive?.savedAt);
 if(ms!==null)return {date:day(ms),at:new Date(ms).toISOString()};
 const match=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(archive?.date||"");
 if(!match)return null;
 const date=match[3]+match[2]+match[1],iso=match[3]+"-"+match[2]+"-"+match[1];
 const parsed=Date.parse(iso+"T12:00:00Z");
 if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==iso)return null;
 return {date,at:iso+"T12:00:00.000Z"};
}
async function stored(storage,key,now){
 const entry=await storage.get("private:"+key);
 return entry===undefined?undefined:entry?.expires&&entry.expires<=now?null:parse(entry?.value);
}
async function records(storage,kv,prefix,now){
 const values=new Map();
 // Older records may still reside in KV. DO entries (including tombstones)
 // always override that fallback, never the other way round.
 if(kv?.list){
  let cursor;
  do{
   const page=await kv.list({prefix,limit:1000,...(cursor?{cursor}:{})});
   const names=page.keys.map(key=>key.name);
   for(let start=0;start<names.length;start+=100){
    const batch=names.slice(start,start+100),found=await kv.get(batch,"text");
    for(const name of batch)values.set(name,parse(found.get(name)));
   }
   cursor=page.list_complete?null:page.cursor;
  }while(cursor);
 }
 let startAfter;
 do{
  const page=await storage.list({prefix:"private:"+prefix,limit:1000,...(startAfter?{startAfter}:{})});
  for(const [key,entry] of page)values.set(key.slice(8),entry?.expires&&entry.expires<=now?null:parse(entry?.value));
  startAfter=page.size===1000?[...page.keys()].at(-1):null;
 }while(startAfter);
 return values;
}
export async function readPublicationArchive(storage,kv,userId,now=Date.now()){
 const uid=String(userId);if(!/^[1-9]\d{4,15}$/.test(uid))throw Error("Invalid archive identity");
 const prefix=uid===OWNER?"":"cabinet_v3:"+uid+":";
 const ratingPrefix=prefix+"owner_anketa_proof_archive_v1:";
 const reviewPrefix=prefix+"owner_anketa_review_proof_archive_v1:";
 const publicationPrefix=prefix+"owner_anketa_publication_v1:";
 const [ratings,reviews,publications]=await Promise.all([
  records(storage,kv,ratingPrefix,now),records(storage,kv,reviewPrefix,now),records(storage,kv,publicationPrefix,now)
 ]);
 const entries=new Map();
 for(const [kind,archives,base] of [["rating",ratings,ratingPrefix],["review",reviews,reviewPrefix]]){
  for(const [key,archive] of archives){
   const [account,id,...extra]=key.slice(base.length).split(":");
   if(extra.length||!archive||archive.account!==account||String(archive.profileId)!==id||!validProfile(id)||!validAccount(account))continue;
   const record=publications.get(publicationPrefix+kind+":"+id);
   const date=dated(record?.status==="published"&&(record.account||"yan_first")===account?record:null,archive);
   if(!date)continue;
   const fileId=typeof archive.fileId==="string"&&/^[A-Za-z0-9_-]{1,300}$/.test(archive.fileId)?archive.fileId:null;
   if(!fileId)continue;
   entries.set(account+":"+id+":"+kind,{profileId:id,account,kind,...date,fileId});
  }
 }
 // Secondary men's independent archive is populated only by trusted executor
 // proof AND successful credit settlement, not by draft saves or caller flags.
 // Entries reside in this client's own Durable Object namespace.
 const secondaryPrefix="man-account-v1:"+uid+":";
 if(storage?.list){
  let cursor;
  do{
   const page=await storage.list({prefix:secondaryPrefix,limit:1000,...(cursor?{startAfter:cursor}:{})});
   for(const [key,value] of page){
    const match=/^man-account-v1:(\d{5,16}):(yan_second|yan_(?:0[3-9]|[12][0-9]|30)):proof:(\d{1,9}):(rating|review):([a-f0-9]{12}):settlement$/.exec(key);
    if(!match||match[1]!==uid||value?.status!=="completed"||value?.ledgerStatus!=="completed"||
       value?.identity?.userId!==uid||value.identity.accountId!==match[2]||
       value.identity.profileId!==match[3]||value.identity.kind!==match[4]||
       value.identity.nonce!==match[5]||!Number.isSafeInteger(value.at))continue;
    const id=match[3],account=match[2],kind=match[4];
    const fileId=typeof value.proofFileId==="string"&&/^[A-Za-z0-9_-]{6,300}$/.test(value.proofFileId)?
     value.proofFileId:null;
    const dt=dated({at:new Date(value.at).toISOString()},null);
    if(!dt)continue;
    const identity=account+":"+id+":"+kind;
    // Keep immutable original proof: no second completed operation overwrites
    // an earlier one in the legacy single-card catalog.
    if(!entries.has(identity))entries.set(identity,{profileId:id,account,kind,...dt,fileId,nonce:match[5]});
   }
   cursor=page.size===1000?[...page.keys()].at(-1):null;
  }while(cursor);
 }
 // A confirmed action can outlive its Telegram file. Do not invent a screenshot.
 for(const [key,record] of publications){
  const [kind,id,...extra]=key.slice(publicationPrefix.length).split(":");
  const account=record?.account||"yan_first";
  if(extra.length||record?.status!=="published"||!["rating","review"].includes(kind)||!validProfile(id)||!validAccount(account))continue;
  const date=dated(record,null);if(!date)continue;
  const identity=account+":"+id+":"+kind;
  if(!entries.has(identity))entries.set(identity,{profileId:id,account,kind,...date,fileId:null});
 }
 const items=[...entries.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.profileId.localeCompare(b.profileId)||a.kind.localeCompare(b.kind));
 let firstProfile=null;
 if(items.length){
  const id=items[0].profileId,key="owner_anketa_saved:"+uid+":"+id;
  let saved=await stored(storage,key,now);if(saved===undefined)saved=parse(await kv?.get(key));
  let host=saved?.host;
  if(!host){
   const operations=await records(storage,kv,"cabinet_operation:"+uid+":",now);
   for(const operation of operations.values())if(String(operation?.id||operation?.profile?.id)===id&&operation?.host){host=operation.host;break;}
  }
  if(typeof host==="string"&&/^[a-z0-9-]+\.intimcity\.rip$/.test(host)){
   const thumbnail=await kv?.get("profile-thumbnails/"+host+"/"+id+".card.jpg","arrayBuffer");
   if(thumbnail?.byteLength>0)firstProfile={id,cardUrl:"https://dame-camelias.gptjjjgpt.workers.dev/api/anketa/card/"+id+"?site="+encodeURIComponent(host)};
  }
 }
 return {items,firstProfile};
}

export const accountLabel=account=>({yan_first:"Ян Первый",yan_second:"Ян Второй"})[account]||account;
export const displayArchiveDate=date=>date.slice(6,8)+"."+date.slice(4,6)+"."+date.slice(0,4);

