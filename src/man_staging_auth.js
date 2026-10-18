// Shared staging-only Telegram owner authentication for the outer Worker
// and internal Durable Object. Never imported into production request paths.
import {validWebApp} from "./telegram_auth.js";
const OWNER_ID="5866034656";
const MAX_AGE_SECONDS=900;
const FUTURE_SKEW_SECONDS=30;
export async function authenticatedStagingOwner(initData,token,nowSeconds=Math.floor(Date.now()/1000)){
 if(typeof initData!=="string"||typeof token!=="string"||!token||
    !Number.isSafeInteger(nowSeconds))return false;
 let p;
 try{p=new URLSearchParams(initData)}catch{return false}
 for(const field of ["hash","auth_date","user"]){
  if(p.getAll(field).length!==1)return false;
 }
 const rawDate=p.get("auth_date");
 if(!/^[0-9]{10,11}$/.test(rawDate||""))return false;
 const date=Number(rawDate);
 if(!Number.isSafeInteger(date)||date>nowSeconds+FUTURE_SKEW_SECONDS||
    date<nowSeconds-MAX_AGE_SECONDS)return false;
 let user;
 try{user=JSON.parse(p.get("user"))}catch{return false}
 if(!user||typeof user!=="object"||
    String(user.id)!==OWNER_ID)return false;
 // Validate the entire signed payload with Telegram's WebAppData HMAC.
 // The shared verifier is unchanged; staging adds strict duplicate/date checks.
 return validWebApp(initData,token,MAX_AGE_SECONDS);
}
