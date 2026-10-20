// One-use, read-only profile lookup using the selected man's own encrypted proxy.
// No publications, no credits, no Yan First fallback and no credential logging.
import {requireManId} from "./man_account_isolation.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";
const PREFIX="secondary-profile-probe-v1:",PROXY="man-proxy-sealed-v1:",SITE="man-intimcity-sealed-v1:",APPROVAL="man-owner-approval-v1:";
const te=new TextEncoder(),PROFILE=/^[0-9]{1,9}$/,NONCE=/^[a-f0-9]{32}$/;
const MAX_AGE=8*60*1000;
function secondary(accountId){
 requireManId(accountId);
 if(accountId==="yan_first")throw Error("Legacy account immutable");
 return accountId;
}
async function unseal(hex,iv,sealed,aad){
 if(typeof hex!=="string"||!/^[a-f0-9]{64}$/i.test(hex)||!Array.isArray(iv)||!Array.isArray(sealed))
  throw Error("Encrypted configuration unavailable");
 const key=await crypto.subtle.importKey("raw",Uint8Array.from(hex.match(/../g).map(x=>parseInt(x,16))),{name:"AES-GCM"},false,["decrypt"]);
 const result=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(iv),additionalData:te.encode(aad)},key,new Uint8Array(sealed));
 return JSON.parse(new TextDecoder().decode(result));
}
export async function profileProbeStatus(storage,accountId){
 secondary(accountId);
 const run=await storage.get(PREFIX+accountId);
 if(!run)return {ok:true,accountId,status:"not_started"};
 return {ok:true,accountId,status:run.status,profileId:run.profileId,startedAt:run.startedAt,
  code:run.code||null,verified:run.status==="completed"&&run.code==="profile_verified"};
}
export async function startProfileProbe(storage,{accountId,profileId,at,approval,proxy,site,login,dispatch}){
 secondary(accountId);
 if(typeof profileId!=="string"||!PROFILE.test(profileId)||!Number.isSafeInteger(at)||
   !approvalMatchesConfiguration(approval,accountId,proxy?.version,site?.version)||
   !proxy?.proxyVerified||!proxy?.ipVerified||site?.proxyReady!==true||
   login?.technicalReady!==true||typeof dispatch!=="function")
  throw Error("Profile probe prerequisites unavailable");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 const nonce=crypto.randomUUID().replace(/-/g,"");
 await storage.transaction(async tx=>{
  const previous=await tx.get(PREFIX+accountId);
  if(previous?.status==="running"&&at-previous.startedAt<MAX_AGE)
   throw Error("Probe already running");
  await tx.put(PREFIX+accountId,{accountId,profileId,nonce,startedAt:at,status:"running",
   claimed:false,proxyVersion:proxy.version,siteVersion:site.version});
 });
 let outcome;
 try{outcome=await dispatch({accountId,profileId,nonce,siteHost:new URL(site.siteUrl).hostname});}
 catch{outcome={ok:false};}
 if(outcome?.ok!==true){
  await storage.transaction(async tx=>{
   const old=await tx.get(PREFIX+accountId);
   if(old?.nonce===nonce&&!old.claimed)await tx.put(PREFIX+accountId,{...old,status:"dispatch_failed",code:"dispatch_unavailable"});
  });
  return {ok:false,accountId,status:"dispatch_failed"};
 }
 return {ok:true,accountId,status:"running",profileId};
}
export async function claimProfileProbe(storage,env,{accountId,profileId,nonce,at}){
 secondary(accountId);
 if(typeof profileId!=="string"||!PROFILE.test(profileId)||!NONCE.test(nonce)||!Number.isSafeInteger(at))
  throw Error("Invalid claim");
 const result=await storage.transaction(async tx=>{
  const [run,proxy,site,approval]=await Promise.all([tx.get(PREFIX+accountId),tx.get(PROXY+accountId),tx.get(SITE+accountId),tx.get(APPROVAL+accountId)]);
  if(!run||run.accountId!==accountId||run.profileId!==profileId||run.nonce!==nonce||
     run.status!=="running"||run.claimed||at<run.startedAt||at-run.startedAt>MAX_AGE||
     proxy?.accountId!==accountId||site?.accountId!==accountId||
     run.proxyVersion!==proxy.version||run.siteVersion!==site.version||
     !approvalMatchesConfiguration(approval,accountId,proxy.version,site.version)||
     site.boundProxyVersion!==proxy.version||!proxy.proxyVerified||!proxy.ipVerified)
   throw Error("Claim not authorized");
  await tx.put(PREFIX+accountId,{...run,claimed:true});
  return {proxy,site};
 });
 const proxy=await unseal(env.MAN_PROXY_ENCRYPTION_KEY,result.proxy.iv,result.proxy.sealed,accountId);
 const site=await unseal(env.MAN_SITE_ENCRYPTION_KEY,result.site.iv,result.site.sealed,accountId+":intimcity:"+result.proxy.version);
 if(proxy.protocol!=="http"||proxy.expectedIp!==result.proxy.expectedIp||
    site.siteUrl!==result.site.siteUrl)throw Error("Pinned proxy or login mismatch");
 return {ok:true,accountId,nonce,mode:"profile",profileId,
  proxyVersion:result.proxy.version,siteVersion:result.site.version,
  proxyHost:proxy.host,proxyPort:proxy.port,proxyUsername:proxy.username,proxyPassword:proxy.password,
  expectedIp:proxy.expectedIp,siteUrl:site.siteUrl,siteLogin:site.login,sitePassword:site.password};
}
export async function completeProfileProbe(storage,{accountId,profileId,nonce,at,code}){
 secondary(accountId);
 if(!PROFILE.test(String(profileId))||!NONCE.test(String(nonce))||
    !["profile_verified","profile_unavailable","browser_failed"].includes(code)||!Number.isSafeInteger(at))
  throw Error("Invalid result");
 return storage.transaction(async tx=>{
  const run=await tx.get(PREFIX+accountId);
  if(!run||run.accountId!==accountId||run.profileId!==profileId||run.nonce!==nonce||
     run.status!=="running"||!run.claimed||at<run.startedAt||at-run.startedAt>MAX_AGE)
   throw Error("Stale profile result");
  const next={...run,status:"completed",code,finishedAt:at};
  await tx.put(PREFIX+accountId,next);
  return {ok:true,accountId,profileId,status:next.status,code,verified:code==="profile_verified"};
 });
}
