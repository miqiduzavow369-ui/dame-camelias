import test from "node:test";
import assert from "node:assert/strict";
import {cabinetEvent,cabinetEndpoint} from "../../src/cabinet_runtime.js";
import {OWNER_ID} from "../../src/client_registry.js";
import {MAN_ACCOUNTS} from "../../src/man_accounts.js";
import {manStorageKey,createAccountOperation} from "../../src/man_account_isolation.js";
import {readSecondaryConnection,installSecondaryConnection} from "../../src/secondary_man_connection.js";
import {startSecondaryRatingDryfill,requireFreshSecondaryRatingDryfill} from "../../src/secondary_man_rating_dryfill.js";
import {createHmac} from "node:crypto";
import {handleAdminApi} from "../../src/admin_app_api.js";

// All credentials, clients and records below are synthetic. No network is used.
const PROXY_KEY="11".repeat(32),SITE_KEY="22".repeat(32);
const CLIENT="123456789",OTHER="987654321",PROFILE="690230";
class Memory {
 map=new Map();
 async get(k){return structuredClone(this.map.get(k));}
 async put(k,v){this.map.set(k,structuredClone(v));}
 async delete(k){this.map.delete(k);}
 async transaction(fn){return fn(this);}
 async setAlarm(){}
 async list({prefix=""}={}){return new Map([...this.map].filter(([k])=>k.startsWith(prefix)));}
}
async function encrypt(secret,value,aad){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await crypto.subtle.importKey("raw",Uint8Array.from(secret.match(/../g),x=>parseInt(x,16)),"AES-GCM",false,["encrypt"]);
 const sealed=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(aad)},key,new TextEncoder().encode(JSON.stringify(value)));
 return {iv:[...iv],sealed:[...new Uint8Array(sealed)]};
}
async function seed(storage,id){
 const login=id+"@example.test",now=Date.now();
 await storage.put("man-proxy-sealed-v1:"+id,{accountId:id,version:2,protocol:"http",
  proxyVerified:true,ipVerified:true,expectedIp:"8.8.8.8",
  ...await encrypt(PROXY_KEY,{protocol:"http",host:id+".proxy.example.test",port:8080,
   username:id,password:"synthetic-proxy-"+id,expectedIp:"8.8.8.8"},id)});
 await storage.put("man-intimcity-sealed-v1:"+id,{accountId:id,version:3,boundProxyVersion:2,
  siteUrl:"https://c.intimcity.rip/",...await encrypt(SITE_KEY,{siteUrl:"https://c.intimcity.rip/",
   login,password:"synthetic-site-"+id},id+":intimcity:2")});
 await storage.put("man-browser-check-v1:"+id,{accountId:id,proxyVersion:2,status:"verified",siteReachable:true});
 await storage.put("man-site-login-check-v1:"+id,{accountId:id,proxyVersion:2,siteVersion:3,
  status:"completed",code:"login_authenticated_identity_verified",claimed:true,startedAt:now-100,finishedAt:now});
 await storage.put("secondary-site-identity-v1:"+id,{accountId:id,proxyVersion:2,siteVersion:3,siteAccountId:login});
 await storage.put("man-owner-approval-v1:"+id,{accountId:id,version:1,approved:true,proxyVersion:2,siteVersion:3});
}
function fixture(){
 const stores=new Map([[OWNER_ID,new Memory()],[CLIENT,new Memory()],[OTHER,new Memory()]]),shared=new Map(),rpc=[];
 const env={DC_ACTIONS_TOKEN:"synthetic",ANKETA_CALLBACK_TOKEN:"synthetic",SECONDARY_CALLBACK_HMAC_KEY:"33".repeat(32),
  MAN_PROXY_ENCRYPTION_KEY:PROXY_KEY,MAN_SITE_ENCRYPTION_KEY:SITE_KEY,
  VISITORS_KV:{get:async(k,format)=>{const v=shared.get(k)??null;return format==="json"&&v!==null?JSON.parse(v):v;},put:async(k,v)=>shared.set(k,v)},
  ORDER_REMINDERS:{idFromName:x=>x,get:name=>({fetch:async(url,options)=>{
   const input=JSON.parse(options.body);rpc.push({name,input});
   if(name==="client-registry:v1")return Response.json({client:{id:input.userId,active:true}});
   if(name.startsWith("agreement:v1:"))return Response.json({status:"accepted"});
   if(name.startsWith("cabinet-events:v1:")){
    const uid=name.slice("cabinet-events:v1:".length);
    return Response.json(await cabinetEvent(stores.get(uid),env,input));
   }
   throw Error("Unexpected RPC: "+name);
  }})}};
 const event=(userId,event)=>cabinetEvent(stores.get(userId),env,{userId,event});
 return {stores,shared,env,rpc,event};
}
async function savePrivateProfile(storage,uid){
 const catalog=[{label:"Общая оценка",options:["5"]}];
 await storage.put("private:owner_anketa_library:"+uid,{value:JSON.stringify([PROFILE]),expires:0});
 await storage.put("private:owner_anketa_saved:"+uid+":"+PROFILE,{value:JSON.stringify({confirmed:true,
  host:"c.intimcity.rip",profile:{id:PROFILE,name:"Synthetic profile"},catalog}),expires:0});
}


export {Memory,seed,fixture,savePrivateProfile,CLIENT,PROFILE,OWNER_ID};
