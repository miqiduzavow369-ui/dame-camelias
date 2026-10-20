// Safe per-man draft entrypoint for the signed client Mini App.
// Does not authorize publication, reserve credits or impersonate a site account.
import {requireManId,manStorageKey} from "./man_account_isolation.js";
const PROFILE=/^\d{1,9}$/,TEXT_MAX=4000;
function validate({accountId,profileId,kind,userId}){
 requireManId(accountId);
 if(accountId==="yan_first")throw Error("Legacy route only");
 if(typeof userId!=="string"||!/^\d{5,16}$/.test(userId)||
  !PROFILE.test(String(profileId))||!["rating","review"].includes(kind))
  throw Error("Invalid draft identity");
 return {userId,accountId,profileId:String(profileId),kind};
}
function key(i){return manStorageKey({...i,scope:i.kind==="rating"?"rating-draft":"review-draft"})+":"+i.kind;}
export async function secondaryDraftAction(storage,{accountId,profileId,userId,kind,action,text,ratings,profileOwned,authorAttested}){
 const i=validate({accountId,profileId,userId,kind});
 if(typeof storage.transaction!=="function")throw Error("Atomic draft store unavailable");
 if(action==="status"){
  const current=await storage.get(key(i));
  return {ok:true,accountId:i.accountId,profileId:i.profileId,kind:i.kind,
   saved:!!current,version:current?.version??0,publicationAvailable:false};
 }
 if(action==="load"){
  if(i.kind!=="review"||profileOwned!==true)throw Error("Saved profile required");
  const current=await storage.get(key(i));
  if(current&&(current.userId!==i.userId||
     current.accountId!==i.accountId||current.profileId!==i.profileId||
     current.kind!==i.kind))throw Error("Draft ownership mismatch");
  return {ok:true,accountId:i.accountId,profileId:i.profileId,
   kind:i.kind,text:typeof current?.text==="string"?current.text:"",
   version:current?.version||0,saved:!!current,publicationAvailable:false};
 }
 if(action!=="save"||profileOwned!==true||authorAttested!==true)
  throw Error("Profile and independent author consent required");
 const content=kind==="review"?
  (typeof text==="string"&&text.trim().length>=10&&text.length<=TEXT_MAX?{text:text.trim()}:null):
  (Array.isArray(ratings)&&ratings.length>0&&ratings.length<=30&&
   ratings.every(r=>Number.isInteger(r)&&r>=1&&r<=5)?{ratings:[...ratings]}:null);
 if(!content)throw Error("Invalid rating or review draft");
 return storage.transaction(async tx=>{
  const k=key(i),old=await tx.get(k);
  // A draft is not a claim for a publication; versioned edits are allowed
  // only while no publication attempt has started for this man's profile.
  const gate=manStorageKey({...i,scope:"publication"})+":"+i.kind;
  if(await tx.get(gate))throw Error("Publication already reserved or attempted");
  const value={...i,...content,authorAttested:true,version:(old?.version??0)+1,
   publicationAvailable:false};
  await tx.put(k,value);
  // Per-client/per-man draft indicator for the common Mini App home view.
  // This is not a publication or moderator approval.
  const progressKey=(i.kind==="review"?"secondary-review-progress-v1:":
    "secondary-rating-progress-v1:")+i.userId;
  const progress=await tx.get(progressKey)||{};
  const slot=i.profileId+":"+i.accountId;
  await tx.put(progressKey,{...progress,[slot]:{
   accountId:i.accountId,profileId:i.profileId,kind:i.kind,
   stage:"draft_saved",count:i.kind==="review"?1:value.ratings.length,
   version:value.version
  }});
  return {ok:true,accountId:i.accountId,profileId:i.profileId,
   kind:i.kind,version:value.version,saved:true,publicationAvailable:false};
 });
}
