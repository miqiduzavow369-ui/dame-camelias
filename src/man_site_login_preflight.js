// Read-only, isolated credentialed login probe for accounts 02–30.
// A submitted login is NOT proof of account identity or publication permission.
import {requireManId} from "./man_account_isolation.js";
import {browserCheckStatus} from "./man_browser_preflight.js";
const PREFIX="man-site-login-check-v1:", PROXY="man-proxy-sealed-v1:", SITE="man-intimcity-sealed-v1:";
const EXPIRY=15*60*1000, te=new TextEncoder();
function account(id){requireManId(id);if(id==="yan_first")throw Error("Legacy account immutable");}
function auth(p){account(p.accountId);if(!p.ownerId||p.actorId!==p.ownerId||p.cabinetId!==p.ownerId)throw Error("Forbidden");}
function safe(row){return {ok:true,accountId:row?.accountId||null,status:row?.status||"not_started",
 code:row?.code||null,startedAt:row?.startedAt||null,finishedAt:row?.finishedAt||null,
 siteIdentityVerified:false,canPublish:false};}
async function decrypt(hex,iv,sealed,aad){
 if(typeof hex!=="string"||!/^[a-f0-9]{64}$/i.test(hex))throw Error("Vault unavailable");
 const k=await crypto.subtle.importKey("raw",Uint8Array.from(hex.match(/../g).map(v=>parseInt(v,16))),{name:"AES-GCM"},false,["decrypt"]);
 const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(iv),additionalData:te.encode(aad)},k,new Uint8Array(sealed));
 return JSON.parse(new TextDecoder().decode(bytes));
}
export async function siteLoginStatus(storage,p){
 auth(p);
 const [run,site,proxy]=await Promise.all([storage.get(PREFIX+p.accountId),storage.get(SITE+p.accountId),storage.get(PROXY+p.accountId)]);
 if(!run||run.siteVersion!==site?.version||run.proxyVersion!==proxy?.version)return safe({accountId:p.accountId});
 return safe(run);
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
  if(old?.status==="running"&&p.at-old.startedAt<EXPIRY)throw Error("Already running");
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
export async function completeSiteLoginCheck(storage,{accountId,nonce,at,code}){
 account(accountId);
 const allowed=new Set(["login_form_unavailable","login_attempted_unconfirmed","login_authenticated_identity_unconfirmed","login_rejected",
   "ip_mismatch","proxy_error","site_error","executor_error"]);
 if(!/^[a-f0-9]{32}$/.test(nonce)||!Number.isSafeInteger(at)||!allowed.has(code))throw Error("Invalid result");
 return storage.transaction(async tx=>{
  const run=await tx.get(PREFIX+accountId),site=await tx.get(SITE+accountId),proxy=await tx.get(PROXY+accountId);
  if(!run||run.nonce!==nonce||run.status!=="running"||!run.claimed||
   at<run.startedAt||at-run.startedAt>EXPIRY||run.siteVersion!==site?.version||
   run.proxyVersion!==proxy?.version)throw Error("Stale result");
  const saved={...run,status:"completed",code,finishedAt:at};
  await tx.put(PREFIX+accountId,saved);
  // Intentionally DO NOT modify site.identityVerified, proxy.enabled or publication gates.
  return safe(saved);
 });
}
