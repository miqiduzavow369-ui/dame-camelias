// Owner-only encrypted planning data. NEVER includes proxy or website passwords.
// Separate from live proxy vault; does not configure connections or activate men.
import {requireManId} from "./man_account_isolation.js";
const PREFIX="man-private-draft-v1:";
const te=new TextEncoder();
function authorize(actorId,cabinetId,ownerId,accountId){
 requireManId(accountId);
 if(!ownerId||actorId!==ownerId||cabinetId!==ownerId)throw Error("Forbidden");
}
function validIP(ip){
 if(typeof ip!=="string"||!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip))return false;
 const octets=ip.split(".").map(Number);
 return octets.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&
  octets[0]>=1&&octets[0]<224&&!([10,127].includes(octets[0]))&&
  !(octets[0]===172&&octets[1]>=16&&octets[1]<=31)&&
  !(octets[0]===192&&octets[1]===168)&&
  !(octets[0]===169&&octets[1]===254)&&
  !(octets[0]===100&&octets[1]>=64&&octets[1]<=127)&&
  !(octets[0]===192&&octets[1]===0)&&
  !(octets[0]===198&&[18,19,51].includes(octets[1]))&&
  !(octets[0]===203&&octets[1]===0&&octets[2]===113);
}
function validPort(v){return Number.isInteger(v)&&v>0&&v<=65535}
export function validatePrivateDraft(accountId,settings){
 requireManId(accountId);
 if(!settings||typeof settings!=="object"||Array.isArray(settings))throw Error("Invalid draft");
 const {technicalName,host,httpPort,socksPort,username}=settings;
 if(typeof technicalName!=="string"||!/^[-\w.+]+@[-\w.]+\.[A-Za-z]{2,}$/u.test(technicalName)||
    technicalName.length>254)throw Error("Invalid technical name");
 if(accountId==="yan_first"){
  if(host||httpPort||socksPort||username)throw Error("Legacy proxy immutable");
  return {technicalName};
 }
 if(!validIP(host)||!validPort(httpPort)||!validPort(socksPort)||
    typeof username!=="string"||username.length>256||
    !/^[\w.@-]+$/.test(username))throw Error("Invalid proxy draft");
 return {technicalName,host,httpPort,socksPort,username};
}
async function getKey(env){
 const hex=env?.MAN_PROXY_ENCRYPTION_KEY;
 if(typeof hex!=="string"||!/^[a-fA-F0-9]{64}$/.test(hex))throw Error("Vault key missing");
 return crypto.subtle.importKey("raw",new Uint8Array(hex.match(/../g).map(x=>parseInt(x,16))),
  {name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function encrypt(key,accountId,data){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const sealed=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:te.encode("draft:"+accountId)},
  key,te.encode(JSON.stringify(data)));
 return {iv:Array.from(iv),sealed:Array.from(new Uint8Array(sealed))};
}
async function decrypt(key,accountId,record){
 const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(record.iv),
  additionalData:te.encode("draft:"+accountId)},key,new Uint8Array(record.sealed));
 return JSON.parse(new TextDecoder().decode(bytes));
}
export async function privateDraftStatus(storage,env,{actorId,cabinetId,ownerId,accountId}){
 authorize(actorId,cabinetId,ownerId,accountId);
 const record=await storage.get(PREFIX+accountId);
 if(!record)return {ok:true,accountId,configured:false,version:0,canPublish:false};
 const key=await getKey(env);
 const settings=validatePrivateDraft(accountId,await decrypt(key,accountId,record));
 return {ok:true,accountId,configured:true,version:record.version,settings,updatedAt:record.updatedAt,canPublish:false};
}
export async function savePrivateDraft(storage,env,{actorId,cabinetId,ownerId,accountId,expectedVersion,settings,at}){
 authorize(actorId,cabinetId,ownerId,accountId);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!Number.isSafeInteger(at)||at<0)
  throw Error("Invalid version");
 const clean=validatePrivateDraft(accountId,settings);
 const key=await getKey(env);
 const sealed=await encrypt(key,accountId,clean);
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async tx=>{
  const before=await tx.get(PREFIX+accountId);
  if((before?.version||0)!==expectedVersion)throw Error("Version conflict");
  const next={schema:1,accountId,version:expectedVersion+1,updatedAt:at,...sealed};
  await tx.put(PREFIX+accountId,next);
  return {ok:true,accountId,configured:true,version:next.version,settings:clean,canPublish:false};
 });
}
// Atomic all-or-nothing import. Only unused drafts allowed to avoid overwriting owner edits.
export async function importPrivateDrafts(storage,env,{actorId,cabinetId,ownerId,rows,at}){
 if(!Array.isArray(rows)||rows.length!==30||!Number.isSafeInteger(at))throw Error("Invalid import size");
 const ids=new Set();
 const clean=rows.map(row=>{
  authorize(actorId,cabinetId,ownerId,row?.accountId);
  if(ids.has(row.accountId))throw Error("Duplicate account");
  ids.add(row.accountId);
  return {accountId:row.accountId,settings:validatePrivateDraft(row.accountId,row.settings)};
 });
 const key=await getKey(env);
 const items=await Promise.all(clean.map(async ({accountId,settings})=>({accountId,settings,
  ciphertext:await encrypt(key,accountId,settings)})));
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async tx=>{
  for(const item of items)if(await tx.get(PREFIX+item.accountId))throw Error("Draft already exists");
  for(const item of items)await tx.put(PREFIX+item.accountId,{
   schema:1,accountId:item.accountId,version:1,updatedAt:at,...item.ciphertext
  });
  return {ok:true,imported:items.length,canPublish:false};
 });
}
