import test from "node:test";
import assert from "node:assert/strict";
import {createHmac,webcrypto} from "node:crypto";
import {authenticatedStagingOwner} from "../src/man_staging_auth.js";
const TOKEN="not-a-real-staging-token",OWNER="5866034656",OTHER="5866034657";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
function sign(uid,authDate,extra=[]){
 const pairs=[["auth_date",String(authDate)],["user",JSON.stringify({id:Number(uid),first_name:"Fixture"})],...extra];
 const check=[...pairs].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const key=createHmac("sha256","WebAppData").update(TOKEN).digest();
 const hash=createHmac("sha256",key).update(check).digest("hex");
 return new URLSearchParams([...pairs,["hash",hash]]).toString();
}
test("strict staging owner verifier accepts only authentic current owner",async()=>{
 const now=Math.floor(Date.now()/1000);
 assert.equal(await authenticatedStagingOwner(sign(OWNER,now),TOKEN,now),true);
 assert.equal(await authenticatedStagingOwner(sign(OTHER,now),TOKEN,now),false);
 assert.equal(await authenticatedStagingOwner(sign(OWNER,now),TOKEN+"modified",now),false);
});
test("staging denies future-dated and expired signatures despite valid HMAC",async()=>{
 const now=Math.floor(Date.now()/1000);
 assert.equal(await authenticatedStagingOwner(sign(OWNER,now+31),TOKEN,now),false);
 assert.equal(await authenticatedStagingOwner(sign(OWNER,now-901),TOKEN,now),false);
 assert.equal(await authenticatedStagingOwner(sign(OWNER,now-899),TOKEN,now),true);
});
test("duplicate signed identity, date and hash fields are rejected",async()=>{
 const now=Math.floor(Date.now()/1000);
 for(const extra of [
  [["user",JSON.stringify({id:Number(OWNER)})]],
  [["auth_date",String(now)]],
  [["hash","a".repeat(64)]]
 ]){
  assert.equal(await authenticatedStagingOwner(sign(OWNER,now,extra),TOKEN,now),false);
 }
});
test("tampered, missing and malformed payloads are rejected",async()=>{
 const now=Math.floor(Date.now()/1000),valid=sign(OWNER,now);
 for(const invalid of [
  "",valid.replace("Fixture","Changed"),"auth_date=not-a-date",
  new URLSearchParams({auth_date:String(now)}).toString(),
  new URLSearchParams({auth_date:String(now),user:"not-json",hash:"a".repeat(64)}).toString()
 ]){
  assert.equal(await authenticatedStagingOwner(invalid,TOKEN,now),false);
 }
});
