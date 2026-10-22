// Yan First's real Chromium dry-fill site audit, scoped to an individual
// secondary man's own encrypted site account and the client's saved ratings.
// A dry-fill grant is NEVER a site-publication or credit capability.
import {createAccountOperation,manStorageKey,verifyAccountCallback} from "./man_account_isolation.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";
import {preflightSecondaryRating} from "./secondary_man_rating_launch.js";

const encoder=new TextEncoder(),TTL=10*60*1000;
const key=i=>manStorageKey({...i,scope:"selection"})+":rating-site-dryfill";
const validTime=n=>Number.isSafeInteger(n)&&n>0;
function validate(source){
 const i=createAccountOperation(source);
 if(i.accountId==="yan_first"||i.kind!=="rating")throw Error("Legacy path immutable");
 return i;
}
async function decrypt(secret,row,aad){
 if(typeof secret!=="string"||!/^[a-f0-9]{64}$/i.test(secret)||
  !Array.isArray(row?.iv)||row.iv.length!==12||!Array.isArray(row?.sealed))
  throw Error("Encrypted account config unavailable");
 const bytes=Uint8Array.from(secret.match(/../g),x=>parseInt(x,16));
 const k=await crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["decrypt"]);
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(row.iv),
  additionalData:encoder.encode(aad)},k,Uint8Array.from(row.sealed));
 return JSON.parse(new TextDecoder().decode(plain));
}
export async function secondaryRatingDryfillStatus(storage,{identity}){
 const i=validate(identity),row=await storage.get(key(i));
 if(!row||!verifyAccountCallback(row.identity,i))
  return {ok:true,stage:"draft"};
 if(row.status==="verified")return {ok:true,stage:"ready",
  fingerprint:row.fingerprint,proxyVersion:row.proxyVersion,
  siteVersion:row.siteVersion,draftVersion:row.draftVersion};
 if(row.status==="running")return {ok:true,stage:"preparing",startedAt:row.startedAt};
 return {ok:true,stage:"failed"};
}
export async function startSecondaryRatingDryfill(storage,env,{
 identity,at,dispatch
}={}){
 const i=validate(identity);
 if(!validTime(at)||typeof dispatch!=="function"||
  typeof storage?.transaction!=="function")throw Error("Invalid dryfill request");
 const ready=await preflightSecondaryRating(storage,env,{identity:i});
 let prior;
 const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
 await storage.transaction(async tx=>{
  prior=await tx.get(key(i));
  if(prior?.status==="running"&&at-prior.startedAt<TTL)
   throw Error("Dryfill already running");
  if(prior?.status==="verified"&&validTime(prior.completedAt)&&at-prior.completedAt<=TTL&&
     prior.fingerprint===ready.fingerprint&&
     prior.draftVersion===ready.draft.version&&
     prior.proxyVersion===ready.proxy.version&&
     prior.siteVersion===ready.site.version)throw Error("Dryfill already verified");
  await tx.put(key(i),{identity:i,nonce,startedAt:at,status:"running",
   claimed:false,fingerprint:ready.fingerprint,
   draftVersion:ready.draft.version,proxyVersion:ready.proxy.version,
   siteVersion:ready.site.version});
 });
 try{
  const outcome=await dispatch({
   accountId:i.accountId,userId:i.userId,profileId:i.profileId,
   nonce,siteHost:new URL(ready.site.siteUrl).hostname
  });
  if(outcome?.accepted!==true)throw Error("Dryfill dispatch unavailable");
  return {ok:true,stage:"preparing",startedAt:at};
 }catch{
  await storage.transaction(async tx=>{
   const row=await tx.get(key(i));
   if(row?.nonce===nonce&&!row.claimed)
    await tx.put(key(i),{...row,status:"failed"});
  });
  return {ok:false,status:409,reason:"secondary_site_check_unavailable"};
 }
}
export async function claimSecondaryRatingDryfill(storage,env,{
 identity,nonce,at
}={}){
 const i=validate(identity);
 if(!/^[a-f0-9]{12}$/.test(nonce||"")||!validTime(at)||
  typeof storage?.transaction!=="function")throw Error("Dryfill claim invalid");
 const result=await storage.transaction(async tx=>{
  const row=await tx.get(key(i));
  if(!row||!verifyAccountCallback(row.identity,i)||row.nonce!==nonce||
   row.status!=="running"||row.claimed||at<row.startedAt||at-row.startedAt>TTL)
   throw Error("Dryfill grant used or expired");
  const [draft,proxy,site,approval,observed]=await Promise.all([
   tx.get(manStorageKey({...i,scope:"rating-draft"})+":rating"),
   tx.get("man-proxy-sealed-v1:"+i.accountId),
   tx.get("man-intimcity-sealed-v1:"+i.accountId),
   tx.get("man-owner-approval-v1:"+i.accountId),
   tx.get("secondary-site-identity-v1:"+i.accountId)
  ]);
  if(draft?.version!==row.draftVersion||
     proxy?.version!==row.proxyVersion||site?.version!==row.siteVersion||
     proxy?.accountId!==i.accountId||site?.accountId!==i.accountId||
     proxy.proxyVerified!==true||proxy.ipVerified!==true||
     site.boundProxyVersion!==proxy.version||
     !approvalMatchesConfiguration(approval,i.accountId,proxy.version,site.version)||
     observed?.accountId!==i.accountId||observed.proxyVersion!==proxy.version||
     observed.siteVersion!==site.version||!observed.siteAccountId)
   throw Error("Dryfill account config changed");
  const catalog=JSON.parse(draft.catalogSignature);
  const selections=Object.entries(draft.selected).map(([k,v])=>({
   index:Number(k),label:catalog[Number(k)]?.label,value:v
  })).sort((a,b)=>a.index-b.index);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(
   JSON.stringify({metElsewhere:draft.metElsewhere,selections})
  ))),b=>b.toString(16).padStart(2,"0")).join("");
  if(digest!==row.fingerprint)throw Error("Dryfill choices changed");
  await tx.put(key(i),{...row,claimed:true});
  return {proxy,site,observed,selection:{metElsewhere:draft.metElsewhere,selections}};
 });
 const [p,s]=await Promise.all([
  decrypt(env.MAN_PROXY_ENCRYPTION_KEY,result.proxy,i.accountId),
  decrypt(env.MAN_SITE_ENCRYPTION_KEY,result.site,i.accountId+":intimcity:"+result.proxy.version)
 ]);
 if(p.protocol!=="http"||p.expectedIp!==result.proxy.expectedIp||
   s.siteUrl!==result.site.siteUrl||
   s.login.toLowerCase()!==result.observed.siteAccountId.toLowerCase())
  throw Error("Dryfill credentials inconsistent");
 return {ok:true,mode:"dryfill",accountId:i.accountId,userId:i.userId,
  profileId:i.profileId,nonce,selections:result.selection,
  proxyHost:p.host,proxyPort:p.port,proxyUsername:p.username,proxyPassword:p.password,
  expectedIp:p.expectedIp,proxyVersion:result.proxy.version,
  siteVersion:result.site.version,siteUrl:s.siteUrl,siteLogin:s.login,sitePassword:s.password};
}
export async function completeSecondaryRatingDryfill(storage,{
 identity,nonce,at,code
}={}){
 const i=validate(identity);
 if(!/^[a-f0-9]{12}$/.test(nonce||"")||!validTime(at)||
  !["verified","failed"].includes(code)||typeof storage?.transaction!=="function")
  throw Error("Invalid dryfill completion");
 return storage.transaction(async tx=>{
  const row=await tx.get(key(i));
  if(!row||!verifyAccountCallback(row.identity,i)||row.nonce!==nonce||
   row.status!=="running"||row.claimed!==true||at<row.startedAt||at-row.startedAt>TTL)
   throw Error("Stale dryfill completion");
  // The runner never supplies ratings, credit or account state in its result.
  await tx.put(key(i),{...row,status:code,completedAt:at});
  return {ok:true,stage:code==="verified"?"ready":"failed"};
 });
}
export async function requireFreshSecondaryRatingDryfill(storage,env,identity){
 const i=validate(identity),row=await storage.get(key(i));
 const now=Date.now();
 if(!row||row.status!=="verified"||!row.claimed||
   !validTime(row.completedAt)||now-row.completedAt>TTL)
  throw Error("Site dryfill not verified");
 const ready=await preflightSecondaryRating(storage,env,{identity:i});
 if(row.fingerprint!==ready.fingerprint||
    row.draftVersion!==ready.draft.version||
    row.proxyVersion!==ready.proxy.version||
    row.siteVersion!==ready.site.version)
   throw Error("Site dryfill snapshot changed");
 return {ok:true};
}

