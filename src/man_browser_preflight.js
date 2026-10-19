// Read-only per-man Chromium verification. No Yan First, publishing or login.
import {requireManId} from "./man_account_isolation.js";
import {validateProxyInput} from "./man_proxy_vault.js";
import {allowedSiteUrl} from "./man_proxy_site_check.js";

const PROXY="man-proxy-sealed-v1:", RUN="man-browser-check-v1:";
const encoding=new TextEncoder();
const EXPIRES_MS=15*60*1000;
const HEX=/^[a-f0-9]{32}$/;
function auth(actorId,cabinetId,ownerId,accountId){
 requireManId(accountId);
 if(accountId==="yan_first"||!ownerId||actorId!==ownerId||cabinetId!==ownerId)throw Error("Forbidden");
}
async function readProxy(storage,env,id,version){
 const item=await storage.get(PROXY+id);
 if(!item||item.accountId!==id||item.version!==version||!Array.isArray(item.sealed))throw Error("Proxy changed");
 const hex=env.MAN_PROXY_ENCRYPTION_KEY;
 if(typeof hex!=="string"||!/^[0-9a-f]{64}$/i.test(hex))throw Error("Vault unavailable");
 const key=await crypto.subtle.importKey("raw",Uint8Array.from(hex.match(/../g).map(v=>parseInt(v,16))),
  {name:"AES-GCM"},false,["decrypt"]);
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(item.iv),
  additionalData:encoding.encode(id)},key,new Uint8Array(item.sealed));
 const proxy=validateProxyInput(JSON.parse(new TextDecoder().decode(plain)));
 if(proxy.protocol!=="http")throw Error("HTTP proxy required");
 return proxy;
}
function safeRun(row){
 if(!row)return {ok:true,configured:false,status:"not_started",canPublish:false};
 return {ok:true,configured:true,accountId:row.accountId,version:row.proxyVersion,
  status:row.status,code:row.code||null,at:row.startedAt||null,finishedAt:row.finishedAt||null,
  ipVerified:row.status==="verified",siteReachable:row.status==="verified"&&row.siteReachable===true,
  canPublish:false};
}
export async function browserCheckStatus(storage,{actorId,cabinetId,ownerId,accountId}){
 auth(actorId,cabinetId,ownerId,accountId);
 const run=await storage.get(RUN+accountId);
 const proxy=await storage.get(PROXY+accountId);
 if(!run||run.proxyVersion!==proxy?.version)return safeRun(null);
 return safeRun(run);
}
export async function startBrowserCheck(storage,env,{actorId,cabinetId,ownerId,accountId,expectedVersion,siteUrl,at},dispatch){
 auth(actorId,cabinetId,ownerId,accountId);
 const url=allowedSiteUrl(siteUrl);
 if(!url||!Number.isSafeInteger(expectedVersion)||expectedVersion<1||!Number.isSafeInteger(at))throw Error("Invalid request");
 await readProxy(storage,env,accountId,expectedVersion); // require configured HTTP proxy, not spreadsheet draft
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 const nonce=crypto.randomUUID().replace(/-/g,"");
 const host=new URL(url).hostname;
 const run=await storage.transaction(async tx=>{
  const proxy=await tx.get(PROXY+accountId);
  const previous=await tx.get(RUN+accountId);
  if(proxy?.version!==expectedVersion)throw Error("Version conflict");
  if(previous?.status==="running"&&previous.startedAt+EXPIRES_MS>at)throw Error("Already running");
  const value={accountId,proxyVersion:expectedVersion,nonce,host,status:"running",
   startedAt:at,finishedAt:null,code:null,payloadClaimed:false,siteReachable:false};
  await tx.put(RUN+accountId,value);
  return value;
 });
 let dispatched=false,dispatchCode="executor_unavailable";
 try{
  const outcome=await dispatch({accountId,nonce,host});
  dispatched=outcome===true||outcome?.ok===true;
  const allowed=new Set(["github_token_missing","callback_config_missing","callback_token_missing","callback_url_missing","github_unauthorized","github_forbidden","workflow_not_found","github_validation_failed","github_rate_limited","github_network_error","github_dispatch_rejected"]);
  if(!dispatched&&allowed.has(outcome?.reason))dispatchCode=outcome.reason;
 }catch{dispatchCode="github_network_error";}
 if(!dispatched){
  await storage.transaction(async tx=>{
   const current=await tx.get(RUN+accountId);
   if(current?.nonce===nonce)await tx.put(RUN+accountId,{...current,status:"dispatch_failed",code:dispatchCode,finishedAt:Date.now()});
  });
  return {ok:false,reason:dispatchCode,canPublish:false};
 }
 return {ok:true,accountId,status:"running",proxyVersion:expectedVersion,canPublish:false};
}
// GitHub Actions obtains proxy secrets only through authenticated one-time GET.
// Never return these via the ADMIN Mini App endpoints or workflow_dispatch inputs.
export async function claimBrowserCheck(storage,env,{accountId,nonce,at}){
 requireManId(accountId);
 if(accountId==="yan_first"||!HEX.test(nonce)||!Number.isSafeInteger(at))throw Error("Forbidden");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 const claim=await storage.transaction(async tx=>{
  const run=await tx.get(RUN+accountId);
  const proxy=await tx.get(PROXY+accountId);
  if(!run||run.nonce!==nonce||run.status!=="running"||run.payloadClaimed||
     run.startedAt>at||at-run.startedAt>EXPIRES_MS||proxy?.version!==run.proxyVersion)throw Error("Unavailable");
  await tx.put(RUN+accountId,{...run,payloadClaimed:true});
  return {version:run.proxyVersion,host:run.host};
 });
 const proxy=await readProxy(storage,env,accountId,claim.version);
 return {ok:true,accountId,nonce,host:claim.host,expectedIp:proxy.expectedIp,
  proxyHost:proxy.host,proxyPort:proxy.port,proxyUsername:proxy.username,proxyPassword:proxy.password};
}
export async function completeBrowserCheck(storage,{accountId,nonce,at,code,observedIp,siteReachable}){
 requireManId(accountId);
 if(accountId==="yan_first"||!HEX.test(nonce)||!Number.isSafeInteger(at))throw Error("Forbidden");
 const allowed=new Set(["verified","ip_mismatch","proxy_error","site_error","executor_error"]);
 if(!allowed.has(code))throw Error("Invalid result");
 const validIp=typeof observedIp==="string"&&/^(?:\d{1,3}\.){3}\d{1,3}$/.test(observedIp)
  &&observedIp.split(".").every(v=>Number(v)<=255);
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async tx=>{
  const run=await tx.get(RUN+accountId),proxy=await tx.get(PROXY+accountId);
  if(!run||run.nonce!==nonce||run.status!=="running"||!run.payloadClaimed||
     run.startedAt>at||at-run.startedAt>EXPIRES_MS||proxy?.version!==run.proxyVersion)throw Error("Stale result");
  const pass=code==="verified"&&validIp&&observedIp===proxy.expectedIp&&siteReachable===true;
  const savedCode=pass?"verified":code==="verified"?"invalid_result":code;
  await tx.put(RUN+accountId,{...run,status:pass?"verified":"failed",code:savedCode,
   finishedAt:at,siteReachable:pass});
  if(pass){
   // Keep the immutable legacy executor and explicit publication gate untouched.
   await tx.put(PROXY+accountId,{...proxy,proxyVerified:true,ipVerified:true,
    siteIdentityVerified:false,enabled:false});
  }
  return {ok:true,accountId,status:pass?"verified":"failed",code:savedCode,
   ipVerified:pass,siteReachable:pass,siteIdentityVerified:false,canPublish:false};
 });
}
