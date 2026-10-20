// Saved-profile rating form for secondary men. This reuses the same
// verified website catalog and UI contract as the legacy rating editor.
// It never submits to Intimcity, issues a callback ticket, or debits credits.
import {requireManId,manStorageKey} from "./man_account_isolation.js";
import {readSharedCriteria} from "./shared_rating_criteria.js";
const USER=/^\d{5,16}$/,PROFILE=/^\d{1,9}$/,INDEX=/^(0|[1-9]\d{0,2})$/;
const MAX_FIELDS=120;
function identity({userId,accountId,profileId}){
 if(!USER.test(userId)||!PROFILE.test(profileId))throw Error("Invalid rating identity");
 requireManId(accountId);
 if(accountId==="yan_first")throw Error("Legacy Yan First immutable");
 return {userId,accountId,profileId};
}
function draftKey(x){return manStorageKey({...x,scope:"rating-draft"})+":rating";}
function publicationKey(x){return manStorageKey({...x,scope:"publication"})+":rating";}

// Keep the legacy site's order and named sections, rather than substituting
// a generic list of 1-5 buttons.
function organizeCatalog(catalog){
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
  else if(/^(классический|расслабляющий)$/.test(low)||/массаж/.test(siteGroup))next="Массаж";
  else if(/^(?:игры|бондаж|доминирование|подчинение|порка|флагелляция|страпон|фетиш|садо-мазо|садомазо)$/.test(low)||/(?:бдсм|bdsm)/.test(siteGroup)||/(?:бдсм|bdsm)/.test(sourceSubgroup))next="БДСМ";
  else if(/^(?:окончание в рот|окончание на грудь|золотой дождь|фетиш)$/.test(low)||/^(?:другое|другие услуги|дополнительные услуги)$/.test(siteGroup))next="Другое";
  else if(/^(?:массаж|бдсм|другое)$/.test(sourceSubgroup))
   next=sourceSubgroup==="секс"?"Секс":sourceSubgroup==="массаж"?"Массаж":sourceSubgroup==="бдсм"?"БДСМ":"Другое";
  if(next&&stageIndex(next)>stageIndex(section))section=next;
  return {...field,label:/^isFair$/i.test(label)?"Фото соответствует":label,
   group:"Оценки анкеты",subgroup:section};
 });
}
function normalizeCatalog(raw){
 if(!Array.isArray(raw)||raw.length===0||raw.length>MAX_FIELDS)throw Error("Rating catalog not ready");
 const source=organizeCatalog(raw);
 const result=source.map(field=>{
  const label=String(field.label||"").slice(0,110);
  if(!label||!Array.isArray(field.options))throw Error("Rating catalog unavailable");
  const indie=/реальн\S*\s+инди/i.test(label);
  return {label,group:String(field.group||"Оценки анкеты").slice(0,90),
   subgroup:String(field.subgroup||"").slice(0,90),
   options:field.options.filter(v=>typeof v==="string"&&
     !/^\s*(?:не знаю|отказано|[1-4])\s*$/i.test(v)&&
     (!indie||/^(?:\s*да\s*|\s*реальная\s+инди\s*)$/i.test(v)))
    .map(v=>v.slice(0,100))};
 });
 return result;
}
async function catalogRecord(kv,x){
 const record=await kv?.get("owner_anketa_saved:"+x.userId+":"+x.profileId,"json");
 if(!record?.confirmed||String(record.profile?.id)!==x.profileId)
  throw Error("Saved profile not verified");
 const shared=(!Array.isArray(record.catalog)||record.catalog.length===0)?await readSharedCriteria(kv,x.profileId):null;
 const catalog=normalizeCatalog(shared||record.catalog);
 return {catalog,profile:{id:x.profileId,name:String(record.profile.name||"").slice(0,100)}};
}
function selectValues(catalog,candidate,metElsewhere){
 if(!candidate||typeof candidate!=="object"||Array.isArray(candidate)||typeof metElsewhere!=="boolean")
  throw Error("Invalid rating selection");
 if(Object.keys(candidate).length>MAX_FIELDS)throw Error("Invalid rating selection");
 const selected={};
 for(const [k,v] of Object.entries(candidate)){
  if(!INDEX.test(k)||Number(k)>=catalog.length||typeof v!=="string"||
   !catalog[Number(k)].options.includes(v))throw Error("Invalid rating selection");
  selected[k]=v;
 }
 for(let i=0;i<catalog.length;i++){
  const f=catalog[i];
  if(/^(?:isFair|Фото соответствует)$/i.test(f.label.trim())){
   if(!f.options.includes("Фото соответствует"))throw Error("Rating catalog unavailable");
   selected[i]="Фото соответствует";
  }
 }
 return selected;
}
export async function openSecondaryRatingForm(storage,kv,source){
 const x=identity(source);
 const {catalog,profile}=await catalogRecord(kv,x);
 const current=await storage.get(draftKey(x));
 const same=current?.catalogSignature===JSON.stringify(catalog);
 return {ok:true,profile,catalog,
  selected:same&&current.selected?current.selected:{},
  metElsewhere:same&&current.metElsewhere===true,
  publicationAvailable:false};
}
export async function saveSecondaryRatingForm(storage,kv,source){
 const x=identity(source);
 const {catalog}=await catalogRecord(kv,x);
 const selected=selectValues(catalog,source.selected,source.metElsewhere);
 if(typeof storage.transaction!=="function")throw Error("Atomic rating storage required");
 return storage.transaction(async tx=>{
  if(await tx.get(publicationKey(x)))throw Error("Publication already claimed");
  const k=draftKey(x),old=await tx.get(k);
  const record={...x,kind:"rating",selected,metElsewhere:source.metElsewhere,
   catalogSignature:JSON.stringify(catalog),version:(old?.version??0)+1,
   publicationAvailable:false};
  await tx.put(k,record);
  return {ok:true,selected:{...selected},metElsewhere:record.metElsewhere,
   publicationAvailable:false,version:record.version};
 });
}
