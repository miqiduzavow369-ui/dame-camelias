// Read-only, isolated credentialed login probe for accounts 02–30.
// A submitted login is NOT proof of account identity or publication permission.
import {requireManId} from "./man_account_isolation.js";
import {browserCheckStatus} from "./man_browser_preflight.js";
import {approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";
const PREFIX="man-site-login-check-v1:", PROXY="man-proxy-sealed-v1:", SITE="man-intimcity-sealed-v1:";
const EXPIRY=15*60*1000, RESTART_AFTER=90*1000, te=new TextEncoder();
function account(id){requireManId(id);if(id==="yan_first")throw Error("Legacy account immutable");}
function auth(p){account(p.accountId);if(!p.ownerId||p.actorId!==p.ownerId||p.cabinetId!==p.ownerId)throw Error("Forbidden");}
function safe(row){return {ok:true,accountId:row?.accountId||null,status:row?.status||"not_started",
 code:row?.code||null,startedAt:row?.startedAt||null,finishedAt:row?.finishedAt||null,
 retryAvailable:row?.retryAvailable===true,
 siteIdentityVerified:false,canPublish:false};}
async function decrypt(hex,iv,sealed,aad){
 if(typeof hex!=="string"||!/^[a-f0-9]{64}$/i.test(hex))throw Error("Vault unavailable");
 const k=await crypto.subtle.importKey("raw",Uint8Array.from(hex.match(/../g).map(v=>parseInt(v,16))),{name:"AES-GCM"},false,["decrypt"]);
 const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(iv),additionalData:te.encode(aad)},k,new Uint8Array(sealed));
 return JSON.parse(new TextDecoder().decode(bytes));
}
export async function siteLoginStatus(storage,p){
 auth(p);
 const [run,site,proxy,browser]=await Promise.all([storage.get(PREFIX+p.accountId),storage.get(SITE+p.accountId),storage.get(PROXY+p.accountId),browserCheckStatus(storage,p)]);
 if(!run||run.siteVersion!==site?.version||run.proxyVersion!==proxy?.version)return {...safe({accountId:p.accountId}),technicalReady:false,connectionVerified:false};
 const verified=run.status==="completed"&&["login_authenticated_identity_unconfirmed","login_authenticated_identity_verified"].includes(run.code)&&
   run.accountId===p.accountId&&site?.accountId===p.accountId&&proxy?.accountId===p.accountId&&
   site?.boundProxyVersion===proxy?.version&&proxy.proxyVerified===true&&proxy.ipVerified===true&&
   browser.status==="verified"&&browser.version===proxy.version&&browser.ipVerified===true&&
   browser.siteReachable===true;
 if(run.status==="running"&&Date.now()-run.startedAt>=EXPIRY)return {...safe({...run,status:"timed_out",code:"check_expired",retryAvailable:true}),technicalReady:false};
 return {...safe({...run,retryAvailable:run.status==="running"&&!run.claimed&&Date.now()-run.startedAt>=RESTART_AFTER}),
  technicalReady:verified,connectionVerified:verified,
  siteIdentityVerified:verified&&run.code==="login_authenticated_identity_verified",
  canPublish:false};
}
export async function startSiteLoginCheck(storage,env,p,dispatch){
 auth(p);
 if(!Number.isSafeInteger(p.at)||!Number.isSafeInteger(p.expectedVersion)||p.expectedVersion<1)throw Error("Invalid request");
 const [site,proxy,browser]=await Promise.all([storage.get(SITE+p.accountId),storage.get(PROXY+p.accountId),
  browserCheckStatus(storage,p)]);
 if(!site||site.accountId!==p.accountId||site.version!==p.expectedVersion||
  !proxy||proxy.accountId!==p.accountId||site.boundProxyVersion!==proxy.version||
  !proxy.proxyVerified||!proxy.ipVerified||browser.status!=="verified"||browser.version!==proxy.version)
  throw Error("Prerequisites not verified");
 if(!env.MAN_SITE_ENCRYPTION_KEY||!env.MAN_PROXY_ENCRYPTION_KEY)throw Error("Vault unavailable");
 const nonce=crypto.randomUUID().replace(/-/g,"");
 const run=await storage.transaction(async tx=>{
  const old=await tx.get(PREFIX+p.accountId);
  if(old?.status==="running"&&p.at-old.startedAt<EXPIRY){
   // A job still executing (credentials already claimed) cannot be interrupted.
   // Only an explicitly requested, unclaimed and old enough dispatch can be superseded.
   if(p.retry!==true||old.claimed||p.at-old.startedAt<RESTART_AFTER)throw Error("Already running");
  }
  if((await tx.get(SITE+p.accountId))?.version!==p.expectedVersion||
     (await tx.get(PROXY+p.accountId))?.version!==proxy.version)throw Error("Version conflict");
  const value={accountId:p.accountId,nonce,siteVersion:site.version,proxyVersion:proxy.version,
   startedAt:p.at,status:"running",code:null,finishedAt:null,claimed:false};
  await tx.put(PREFIX+p.accountId,value);return value;
 });
 let outcome={ok:false,reason:"executor_unavailable"};
 try{outcome=await dispatch({accountId:p.accountId,nonce,siteHost:new URL(site.siteUrl).hostname});}
 catch{outcome={ok:false,reason:"github_network_error"};}
 if(outcome===true||outcome?.ok===true)return safe(run);
 const allowed=new Set(["github_token_missing","callback_token_missing","callback_url_missing",
 "github_unauthorized","github_forbidden","workflow_not_found","github_validation_failed","github_rate_limited",
 "github_dispatch_rejected","github_network_error"]);
 const code=allowed.has(outcome?.reason)?outcome.reason:"executor_unavailable";
 await storage.transaction(async tx=>{
  const cur=await tx.get(PREFIX+p.accountId);
  if(cur?.nonce===nonce)await tx.put(PREFIX+p.accountId,{...cur,status:"dispatch_failed",code,finishedAt:Date.now()});
 });
 return {ok:false,accountId:p.accountId,reason:code,siteIdentityVerified:false,canPublish:false};
}
export async function claimSiteLoginCheck(storage,env,{accountId,nonce,at}){
 account(accountId);
 if(!/^[a-f0-9]{32}$/.test(nonce)||!Number.isSafeInteger(at))throw Error("Forbidden");
 const result=await storage.transaction(async tx=>{
  const run=await tx.get(PREFIX+accountId),site=await tx.get(SITE+accountId),proxy=await tx.get(PROXY+accountId);
  if(!run||run.nonce!==nonce||run.status!=="running"||run.claimed||
    at<run.startedAt||at-run.startedAt>EXPIRY||run.siteVersion!==site?.version||
    run.proxyVersion!==proxy?.version||site.boundProxyVersion!==proxy.version||
    site.accountId!==accountId||proxy.accountId!==accountId||
    !proxy.proxyVerified||!proxy.ipVerified)throw Error("Unavailable");
  await tx.put(PREFIX+accountId,{...run,claimed:true});return {site,proxy};
 });
 const {site,proxy}=result;
 const credentials=await decrypt(env.MAN_SITE_ENCRYPTION_KEY,site.iv,site.sealed,
  accountId+":intimcity:"+proxy.version);
 const p=await decrypt(env.MAN_PROXY_ENCRYPTION_KEY,proxy.iv,proxy.sealed,accountId);
 // The credential grant is unusable unless this account's *own* sealed HTTP
 // proxy matches the pinned record and was verified for this exact version.
 if(p.protocol!=="http"||p.expectedIp!==proxy.expectedIp||
    credentials.siteUrl!==site.siteUrl||!proxy.proxyVerified||!proxy.ipVerified||
    site.boundProxyVersion!==proxy.version)throw Error("Proxy binding unavailable");
 return {ok:true,accountId,nonce,siteUrl:site.siteUrl,siteLogin:credentials.login,
  sitePassword:credentials.password,expectedIp:p.expectedIp,proxyHost:p.host,proxyPort:p.port,
  proxyUsername:p.username,proxyPassword:p.password};
}
export async function completeSiteLoginCheck(storage,{accountId,nonce,at,code},env=null){
 account(accountId);
 const allowed=new Set(["login_form_unavailable","login_attempted_unconfirmed","login_authenticated_identity_unconfirmed","login_authenticated_identity_verified","login_identity_mismatch","login_rejected",
   "ip_mismatch","proxy_error","site_error","executor_error"]);
 if(!/^[a-f0-9]{32}$/.test(nonce)||!Number.isSafeInteger(at)||!allowed.has(code))throw Error("Invalid result");
 return storage.transaction(async tx=>{
  const run=await tx.get(PREFIX+accountId),site=await tx.get(SITE+accountId),proxy=await tx.get(PROXY+accountId);
  if(!run||run.nonce!==nonce||run.status!=="running"||!run.claimed||
   at<run.startedAt||at-run.startedAt>EXPIRY||run.siteVersion!==site?.version||
   run.proxyVersion!==proxy?.version)throw Error("Stale result");
  if(code==="login_authenticated_identity_verified"){
   // The runner checked the authenticated account header against its pinned
   // saved login. Re-derive the reference ONLY from encrypted site credentials;
   // never take an identity from an unauthenticated callback field.
   if(!env?.MAN_SITE_ENCRYPTION_KEY||!site?.sealed||!site?.iv||
      site.accountId!==accountId||proxy.accountId!==accountId||
      site.boundProxyVersion!==proxy.version||!proxy.proxyVerified||!proxy.ipVerified)
    throw Error("Identity evidence unavailable");
   const credential=await decrypt(env.MAN_SITE_ENCRYPTION_KEY,site.iv,site.sealed,
    accountId+":intimcity:"+proxy.version);
   const observed=String(credential.login||"").trim().toLowerCase();
   if(!/^[a-z0-9][a-z0-9_.+-]{0,63}@[a-z0-9.-]{1,120}\.[a-z]{2,24}$/.test(observed))
    throw Error("Identity evidence unavailable");
   await tx.put("secondary-site-identity-v1:"+accountId,{
    accountId,siteAccountId:observed,proxyVersion:proxy.version,
    siteVersion:site.version,verifiedAt:at});
  }
  const saved={...run,status:"completed",code,finishedAt:at};
  await tx.put(PREFIX+accountId,saved);
  // Never enable proxy/site publication from login evidence alone.
  return safe(saved);
 });
}

/** Read expected login ONLY inside trusted account's Durable Object; no client output. */
export async function expectedVerifiedSiteAccountId(storage,env,accountId){
 account(accountId);
 const [site,proxy]=await Promise.all([
  storage.get(SITE+accountId),storage.get(PROXY+accountId)
 ]);
 if(site?.accountId!==accountId||proxy?.accountId!==accountId||
    site.boundProxyVersion!==proxy.version||
    proxy.proxyVerified!==true||proxy.ipVerified!==true)
  throw Error("Stale account configuration");
 const decrypted=await decrypt(env.MAN_SITE_ENCRYPTION_KEY,site.iv,site.sealed,
  accountId+":intimcity:"+proxy.version);
 if(typeof decrypted.login!=="string"||decrypted.login.length<4)
  throw Error("Expected account identity missing");
 return {expectedSiteAccountId:decrypted.login,
  proxyVersion:proxy.version,siteVersion:site.version};
}

/**
 * Repair the private identity record from an ALREADY COMPLETED authenticated
 * account-page verification. Never manufacture identity from mere credentials.
 * Does not contact Intimcity, touch ratings, publish, or reserve credits.
 */
export async function restoreVerifiedSiteIdentity(storage,env,accountId,ownerId){
 account(accountId);
 if(typeof storage?.transaction!=="function")throw Error("Atomic storage unavailable");
 const params={actorId:ownerId,cabinetId:ownerId,ownerId,accountId};
 // A completed browser preflight must match the current proxy version.
 const browser=await browserCheckStatus(storage,params);
 return storage.transaction(async tx=>{
  const [run,site,proxy,approval,previous]=await Promise.all([
   tx.get(PREFIX+accountId),tx.get(SITE+accountId),tx.get(PROXY+accountId),
   tx.get("man-owner-approval-v1:"+accountId),
   tx.get("secondary-site-identity-v1:"+accountId)
  ]);
  if(previous?.accountId===accountId&&previous.proxyVersion===proxy?.version&&
     previous.siteVersion===site?.version&&previous.siteAccountId)
   return {ok:true,restored:false,verified:true};
  if(run?.status!=="completed"||run.code!=="login_authenticated_identity_verified"||
     run.accountId!==accountId||run.proxyVersion!==proxy?.version||
     run.siteVersion!==site?.version||run.claimed!==true||
     !Number.isSafeInteger(run.finishedAt)||run.finishedAt<run.startedAt||
     site?.accountId!==accountId||proxy?.accountId!==accountId||
     site.boundProxyVersion!==proxy.version||proxy.proxyVerified!==true||
     proxy.ipVerified!==true||browser.status!=="verified"||
     browser.version!==proxy.version||browser.ipVerified!==true||
     browser.siteReachable!==true||
     !approvalMatchesConfiguration(approval,accountId,proxy.version,site.version))
   return {ok:false,restored:false,verified:false,reason:"fresh_site_login_check_required"};
  const saved=await decrypt(env.MAN_SITE_ENCRYPTION_KEY,site.iv,site.sealed,
   accountId+":intimcity:"+proxy.version);
  const siteAccountId=String(saved.login||"").trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_.+-]{0,63}@[a-z0-9.-]{1,120}\.[a-z]{2,24}$/.test(siteAccountId))
   throw Error("Trusted login identity unavailable");
  await tx.put("secondary-site-identity-v1:"+accountId,{
   accountId,siteAccountId,proxyVersion:proxy.version,
   siteVersion:site.version,verifiedAt:run.finishedAt
  });
  return {ok:true,restored:true,verified:true};
 });
}
