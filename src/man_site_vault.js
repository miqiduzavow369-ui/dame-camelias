// Independent encrypted Intimcity credentials for new men. NO site requests,
// no browser dispatch, no automatic publication, no legacy Yan First changes.
// Only the isolated future executor may decrypt, after a verified proxy/IP check.
import {requireManId} from "./man_account_isolation.js";
const PREFIX="man-intimcity-sealed-v1:";
const PROXY_PREFIX="man-proxy-sealed-v1:";
const te=new TextEncoder();
export const CURRENT_SECONDARY_SITE_URL="https://c.intimcity.rip/";
function auth(actorId,cabinetId,ownerId,accountId){
 requireManId(accountId);
 if(accountId==="yan_first")throw Error("Legacy account immutable");
 if(actorId!==cabinetId||actorId!==ownerId)throw Error("Forbidden");
}
export function validIntimcityUrl(value){
 if(typeof value!=="string"||value.length>500)return null;
 try{
  const u=new URL(value);
  if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||
     u.hostname!=="intimcity.rip"&&!u.hostname.endsWith(".intimcity.rip"))
   return null;
  if(u.search||u.pathname.includes("..")||/%2f|%5c/i.test(value))return null;
  return u.origin+"/";
 }catch{return null;}
}
export function validateSiteCredentials(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Invalid credentials");
 const siteUrl=validIntimcityUrl(input.siteUrl);
 if(!siteUrl||typeof input.login!=="string"||!input.login.trim()||
    input.login.length>256||typeof input.password!=="string"||
    input.password.length<1||input.password.length>512)
    throw Error("Invalid credentials");
 return {siteUrl,login:input.login.trim(),password:input.password};
}
async function aesKey(env){
 const hex=env?.MAN_SITE_ENCRYPTION_KEY;
 if(typeof hex!=="string"||!/^[a-fA-F0-9]{64}$/.test(hex))throw Error("Site vault key not configured");
 return crypto.subtle.importKey("raw",new Uint8Array(hex.match(/../g).map(v=>parseInt(v,16))),
   {name:"AES-GCM"},false,["encrypt"]);
}
export async function readSiteStatus(storage,{actorId,cabinetId,ownerId,accountId}){
 auth(actorId,cabinetId,ownerId,accountId);
 const [raw,proxy]=await Promise.all([storage.get(PREFIX+accountId),storage.get(PROXY_PREFIX+accountId)]);
 const validProxy=proxy?.accountId===accountId&&proxy.proxyVerified===true&&proxy.ipVerified===true&&
                   Number.isSafeInteger(proxy.version)&&proxy.version>0&&
                   raw?.accountId===accountId&&raw?.boundProxyVersion===proxy.version;
 return {ok:true,accountId,version:raw?.version||0,configured:!!raw,
   siteUrl:raw?.siteUrl||null,updatedAt:raw?.updatedAt||null,
   proxyReady:validProxy,stagedOnly:raw?.stagedOnly===true,siteIdentityVerified:false,canPublish:false,
   needsProxyVerification:!validProxy};
}
// Owner explicitly updates this man's destination, keeping only his sealed login
// and proxy binding. A new site version invalidates old login/approval/grants.
export async function updateSiteDomain(storage,env,p){
 auth(p.actorId,p.cabinetId,p.ownerId,p.accountId);
 if(!p.ownerId||!Number.isSafeInteger(p.expectedVersion)||p.expectedVersion<1||
    !Number.isSafeInteger(p.at)||p.at<0)throw Error("Invalid request");
 const hex=env?.MAN_SITE_ENCRYPTION_KEY;
 if(typeof hex!=="string"||!/^[a-fA-F0-9]{64}$/.test(hex))throw Error("Site vault key not configured");
 const key=await crypto.subtle.importKey("raw",Uint8Array.from(hex.match(/../g).map(v=>parseInt(v,16))),
  {name:"AES-GCM"},false,["encrypt","decrypt"]);
 return storage.transaction(async tx=>{
  const site=await tx.get(PREFIX+p.accountId),proxy=await tx.get(PROXY_PREFIX+p.accountId);
  if(site?.accountId!==p.accountId||proxy?.accountId!==p.accountId||
     site.version!==p.expectedVersion||site.boundProxyVersion!==proxy.version)
   throw Error("Version conflict");
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(site.iv),
   additionalData:te.encode(p.accountId+":intimcity:"+proxy.version)},key,new Uint8Array(site.sealed));
  const saved=validateSiteCredentials(JSON.parse(new TextDecoder().decode(plain)));
  if(saved.siteUrl!==site.siteUrl)throw Error("Site binding mismatch");
  if(site.siteUrl===CURRENT_SECONDARY_SITE_URL)return {ok:true,accountId:p.accountId,
   version:site.version,siteUrl:site.siteUrl,configured:true,canPublish:false,unchanged:true};
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const sealed=await crypto.subtle.encrypt({name:"AES-GCM",iv,
   additionalData:te.encode(p.accountId+":intimcity:"+proxy.version)},key,
   te.encode(JSON.stringify({...saved,siteUrl:CURRENT_SECONDARY_SITE_URL})));
  const next={schema:1,accountId:p.accountId,version:site.version+1,
   boundProxyVersion:proxy.version,siteUrl:CURRENT_SECONDARY_SITE_URL,iv:Array.from(iv),
   sealed:Array.from(new Uint8Array(sealed)),updatedAt:p.at,
   identityVerified:false,enabled:false,stagedOnly:true};
  await tx.put(PREFIX+p.accountId,next);
  return {ok:true,accountId:p.accountId,version:next.version,siteUrl:next.siteUrl,
   configured:true,siteIdentityVerified:false,canPublish:false,stagedOnly:true};
 });
}
export async function saveSiteCredentials(storage,env,{actorId,cabinetId,ownerId,accountId,expectedVersion,settings,at}){
 auth(actorId,cabinetId,ownerId,accountId);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!Number.isSafeInteger(at)||at<0)throw Error("Invalid version");
 const clean=validateSiteCredentials(settings);
 const key=await aesKey(env); // Key absence always fails closed before any write.
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async txn=>{
  const proxy=await txn.get(PROXY_PREFIX+accountId);
  if(!proxy||proxy.accountId!==accountId||proxy.proxyVerified!==true||proxy.ipVerified!==true)
   throw Error("Verified proxy required");
  const before=await txn.get(PREFIX+accountId);
  if((before?.version||0)!==expectedVersion)throw Error("Version conflict");
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const payload=await crypto.subtle.encrypt(
    {name:"AES-GCM",iv,additionalData:te.encode(accountId+":intimcity:"+proxy.version)},
    key,te.encode(JSON.stringify(clean)));
  const next={schema:1,accountId,version:expectedVersion+1,
    boundProxyVersion:proxy.version,siteUrl:clean.siteUrl,
    iv:Array.from(iv),sealed:Array.from(new Uint8Array(payload)),updatedAt:at,
    identityVerified:false,enabled:false};
  await txn.put(PREFIX+accountId,next);
  return {ok:true,accountId,version:next.version,configured:true,siteUrl:clean.siteUrl,
    updatedAt:at,proxyReady:true,siteIdentityVerified:false,canPublish:false};
 });
}
// Save encrypted credentials as inactive staging data, not as login verification.
export async function saveSiteCredentialDraft(storage,env,{actorId,cabinetId,ownerId,accountId,expectedVersion,settings,at}){
 auth(actorId,cabinetId,ownerId,accountId);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!Number.isSafeInteger(at)||at<0)throw Error("Invalid version");
 const clean=validateSiteCredentials(settings),key=await aesKey(env);
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async tx=>{
  const proxy=await tx.get(PROXY_PREFIX+accountId);
  if(!proxy||proxy.accountId!==accountId||!Number.isSafeInteger(proxy.version)||proxy.version<1)
   throw Error("Configured proxy required");
  const old=await tx.get(PREFIX+accountId);
  if((old?.version||0)!==expectedVersion)throw Error("Version conflict");
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const sealed=await crypto.subtle.encrypt({name:"AES-GCM",iv,
   additionalData:te.encode(accountId+":intimcity:"+proxy.version)},key,te.encode(JSON.stringify(clean)));
  const record={schema:1,accountId,version:expectedVersion+1,boundProxyVersion:proxy.version,
   siteUrl:clean.siteUrl,iv:Array.from(iv),sealed:Array.from(new Uint8Array(sealed)),updatedAt:at,
   identityVerified:false,enabled:false,stagedOnly:true};
  await tx.put(PREFIX+accountId,record);
  return {ok:true,accountId,version:record.version,configured:true,siteUrl:clean.siteUrl,
   updatedAt:at,proxyReady:false,siteIdentityVerified:false,canPublish:false,stagedOnly:true};
 });
}
export function requireSiteVerification({accountId,siteRecord,proxyRecord,verifiedIdentity}){
 requireManId(accountId);
 if(accountId==="yan_first"||!siteRecord||!proxyRecord||
    siteRecord.accountId!==accountId||proxyRecord.accountId!==accountId||
    siteRecord.boundProxyVersion!==proxyRecord.version||
    proxyRecord.proxyVerified!==true||proxyRecord.ipVerified!==true||
    siteRecord.identityVerified!==true||!verifiedIdentity||
    siteRecord.verifiedIdentity!==verifiedIdentity)
  throw Error("Intimcity account not verified");
 return {accountId,verifiedIdentity,proxyVersion:proxyRecord.version};
}

