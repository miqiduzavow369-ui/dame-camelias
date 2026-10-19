// Individual encrypted proxy credentials for men 02–30. No network requests,
// activation, legacy reads, credentials in GitHub, or plaintext storage.
import {requireManId} from "./man_account_isolation.js";
const PREFIX="man-proxy-sealed-v1:";
const IP=/^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOST=/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
const encoder=new TextEncoder();
function account(id){requireManId(id);if(id==="yan_first")throw Error("Legacy account immutable");return id;}
function ipv4(ip){if(typeof ip!=="string"||!IP.test(ip))return false;
 const x=ip.split(".").map(Number);
 return x.every((n,i)=>n>=0&&n<=255&&String(n)===ip.split(".")[i]) &&
 x[0]!==0&&x[0]!==10&&x[0]!==127&&x[0]!==169&&x[0]<224 &&
 !(x[0]===100&&x[1]>=64&&x[1]<=127)&&!(x[0]===198&&[18,19].includes(x[1])) &&
 !(x[0]===172&&x[1]>=16&&x[1]<=31)&&!(x[0]===192&&x[1]===168)&&!(x[0]===192&&x[1]===0) &&
 !(x[0]===198&&x[1]===51&&x[2]===100)&&!(x[0]===203&&x[1]===0&&x[2]===113) &&
 !(x[0]===192&&x[1]===0&&x[2]===2)&&!(x[0]===255);
}
export function validateProxyInput(raw){
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Invalid proxy settings");
 const {protocol,host,port,username,password,expectedIp}=raw;
 if(!["http","https","socks5"].includes(protocol)||
    typeof host!=="string"||!HOST.test(host)||host.includes("..")||
    (IP.test(host)&&!ipv4(host))||
    typeof port!=="number"||!Number.isInteger(port)||port<1||port>65535||
    typeof username!=="string"||username.length>256||
    typeof password!=="string"||password.length<1||password.length>512||
    !ipv4(expectedIp))throw Error("Invalid proxy settings");
 return {protocol,host:host.toLowerCase(),port,username,password,expectedIp};
}
async function keyFrom(env){
 const secret=env?.MAN_PROXY_ENCRYPTION_KEY;
 if(typeof secret!=="string"||!/^[0-9a-f]{64}$/i.test(secret))throw Error("Proxy vault key not configured");
 const bytes=Uint8Array.from(secret.match(/../g).map(x=>parseInt(x,16)));
 return crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
function authorize(actorId,cabinetId,ownerId,accountId){
 if(actorId!==ownerId||cabinetId!==ownerId)throw Error("Forbidden");
 account(accountId);
}
export async function proxyStatus(storage,{actorId,cabinetId,ownerId,accountId}){
 authorize(actorId,cabinetId,ownerId,accountId);
 const record=await storage.get(PREFIX+accountId);
 return {ok:true,accountId,configured:!!record,version:record?.version||0,
  proxyVerified:record?.proxyVerified===true,ipVerified:record?.ipVerified===true,siteIdentityVerified:false,
  expectedIp:record?.expectedIp||null,protocol:record?.protocol||null,
  updatedAt:record?.updatedAt||null,canPublish:false,
  encryptionConfigured:false};
}
export async function saveProxy(storage,env,{actorId,cabinetId,ownerId,accountId,expectedVersion,settings,at}){
 authorize(actorId,cabinetId,ownerId,accountId);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!Number.isSafeInteger(at)||at<0)throw Error("Invalid version");
 const clean=validateProxyInput(settings);
 // Fail before storage writes when no Cloudflare secret exists.
 const key=await keyFrom(env);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encoder.encode(accountId)},key,encoder.encode(JSON.stringify(clean)));
 const sealed=Array.from(new Uint8Array(ciphertext));
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async tx=>{
  const before=await tx.get(PREFIX+accountId);
  if((before?.version||0)!==expectedVersion)throw Error("Version conflict");
  const record={schema:1,accountId,version:expectedVersion+1,iv:Array.from(iv),sealed,
   protocol:clean.protocol,expectedIp:clean.expectedIp,updatedAt:at,
   enabled:false,proxyVerified:false,ipVerified:false,siteIdentityVerified:false};
  await tx.put(PREFIX+accountId,record);
  return {ok:true,accountId,configured:true,version:record.version,
   expectedIp:record.expectedIp,protocol:record.protocol,updatedAt:at,
   proxyVerified:false,ipVerified:false,siteIdentityVerified:false,canPublish:false};
 });
}
// For the future executor only: always reject unverified IP or configuration
// version. This is not a proxy client. No direct-network fallback is permitted.
export function requirePinnedEgress(accountId,record,observedIp,version){
 account(accountId);
 if(!record||record.accountId!==accountId||record.version!==version||
  record.enabled!==true||record.proxyVerified!==true||
  record.ipVerified!==true||record.siteIdentityVerified!==true||
  !ipv4(record.expectedIp)||observedIp!==record.expectedIp)
  throw Error("Proxy egress not authorized");
 return Object.freeze({accountId,expectedIp:observedIp,version});
}
